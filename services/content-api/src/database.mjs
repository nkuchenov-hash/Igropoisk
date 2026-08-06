import fs from 'node:fs';
import { Pool } from 'pg';

let sharedPool;

function sslConfiguration(env = process.env) {
  const mode = String(env.PGSSL_MODE || 'disable').toLowerCase();
  if (mode === 'disable') return undefined;

  const ca = env.PGSSL_CA_FILE
    ? fs.readFileSync(env.PGSSL_CA_FILE, 'utf8')
    : (env.PGSSL_CA || undefined);

  if (mode === 'verify-full' && !ca) {
    throw new Error('PGSSL_MODE=verify-full requires PGSSL_CA or PGSSL_CA_FILE.');
  }

  return {
    rejectUnauthorized: mode === 'verify-full',
    ...(ca ? { ca } : {})
  };
}

export function createPool(overrides = {}) {
  const connectionString = overrides.connectionString || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  return new Pool({
    connectionString,
    max: Number(overrides.max || process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: Number(overrides.idleTimeoutMillis || 10_000),
    connectionTimeoutMillis: Number(overrides.connectionTimeoutMillis || 10_000),
    ssl: overrides.ssl ?? sslConfiguration(),
    application_name: overrides.applicationName || 'igropoisk-news-content-api'
  });
}

export function getPool() {
  if (!sharedPool) sharedPool = createPool();
  return sharedPool;
}

export async function closePool() {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = undefined;
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
