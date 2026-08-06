import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, withTransaction } from './database.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(here, '../migrations');

export async function runMigrations(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(migrationDirectory))
    .filter(file => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file]
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
    await withTransaction(pool, async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runMigrations();
    console.log('News content ledger migrations are current.');
  } finally {
    await closePool();
  }
}
