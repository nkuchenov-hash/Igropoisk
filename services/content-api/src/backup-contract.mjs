import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export const LEDGER_TABLES = Object.freeze([
  'schema_migrations',
  'content_revisions',
  'sources',
  'media_assets',
  'news_events',
  'news_event_sources',
  'publications',
  'parser_runs',
  'parser_errors',
  'automation_rules',
  'shadow_sync_runs',
  'content_runtime_state'
]);

export function databaseIdentity(connectionString) {
  let url;
  try { url = new URL(String(connectionString || '')); }
  catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgres or postgresql.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) throw new Error('DATABASE_URL must include host and database.');
  return Object.freeze({
    host: url.hostname,
    port: Number(url.port || 5432),
    database,
    display: `${url.hostname}:${url.port || 5432}/${database}`
  });
}

export function pgEnvironment(connectionString, env = process.env) {
  const url = new URL(String(connectionString));
  const identity = databaseIdentity(connectionString);
  const sslMode = String(env.PGSSL_MODE || url.searchParams.get('sslmode') || 'disable').toLowerCase();
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('Unsupported PostgreSQL SSL mode for backup tooling.');
  }
  if (sslMode === 'verify-full' && !env.PGSSL_CA_FILE) {
    throw new Error('PGSSL_MODE=verify-full requires PGSSL_CA_FILE for pg_dump/pg_restore.');
  }
  return {
    ...env,
    PGHOST: identity.host,
    PGPORT: String(identity.port),
    PGDATABASE: identity.database,
    PGUSER: decodeURIComponent(url.username || ''),
    PGPASSWORD: decodeURIComponent(url.password || ''),
    PGSSLMODE: sslMode,
    ...(env.PGSSL_CA_FILE ? { PGSSLROOTCERT: env.PGSSL_CA_FILE } : {})
  };
}

export async function collectInventory(client) {
  const counts = {};
  for (const table of LEDGER_TABLES) {
    const result = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM ${table}`);
    counts[table] = Number(result.rows[0].count);
  }
  const migrations = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return Object.freeze({ counts: Object.freeze(counts), migrations: Object.freeze(migrations.rows.map(row => row.version)) });
}

export function inventoryMatches(expected, actual) {
  if (JSON.stringify(expected.migrations) !== JSON.stringify(actual.migrations)) return false;
  return LEDGER_TABLES.every(table => Number(expected.counts?.[table]) === Number(actual.counts?.[table]));
}

export async function sha256File(file) {
  const buffer = await fs.readFile(file);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function inspectArchive(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Backup archive is empty or not a regular file.');
  return { bytes: stat.size, sha256: await sha256File(file) };
}

export function validateBackupManifest(manifest, archive) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Backup manifest must be an object.');
  if (manifest.schemaVersion !== 1 || manifest.format !== 'postgresql-custom') throw new Error('Unsupported backup manifest contract.');
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Backup manifest createdAt is invalid.');
  if (!manifest.sourceDatabase || typeof manifest.sourceDatabase.display !== 'string') throw new Error('Backup source database identity is missing.');
  if (/@/.test(manifest.sourceDatabase.display)) throw new Error('Backup manifest must not expose database credentials.');
  if (!/^[a-f0-9]{64}$/.test(String(manifest.archive?.sha256 || ''))) throw new Error('Backup archive SHA-256 is invalid.');
  if (!Number.isSafeInteger(manifest.archive?.bytes) || manifest.archive.bytes <= 0) throw new Error('Backup archive byte count is invalid.');
  if (archive && (archive.bytes !== manifest.archive.bytes || archive.sha256 !== manifest.archive.sha256)) {
    throw new Error('Backup archive bytes or SHA-256 do not match the manifest.');
  }
  if (!manifest.inventory || !manifest.inventory.counts || !Array.isArray(manifest.inventory.migrations)) throw new Error('Backup inventory is missing.');
  for (const table of LEDGER_TABLES) {
    if (!Number.isSafeInteger(manifest.inventory.counts[table]) || manifest.inventory.counts[table] < 0) {
      throw new Error(`Backup inventory count is invalid for ${table}.`);
    }
  }
  return manifest;
}
