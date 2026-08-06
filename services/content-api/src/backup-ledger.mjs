import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './database.mjs';
import { collectInventory, databaseIdentity, inspectArchive, validateBackupManifest } from './backup-contract.mjs';
import { runPostgresTool } from './postgres-tools.mjs';

function argumentsFrom(argv) {
  const result = { output: '', manifest: '', label: 'manual' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]; const value = argv[index + 1];
    if (name === '--output' && value) result.output = path.resolve(value);
    if (name === '--manifest' && value) result.manifest = path.resolve(value);
    if (name === '--label' && value) result.label = value;
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  if (!result.output || !result.manifest) throw new Error('--output and --manifest are required.');
  if (result.output === result.manifest) throw new Error('Backup archive and manifest paths must differ.');
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(result.label)) throw new Error('Backup label is invalid.');
  return result;
}

async function assertAbsent(file) {
  try { await fs.stat(file); throw new Error(`Refusing to overwrite existing file: ${file}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
}

export async function backupLedger({ databaseUrl, output, manifest, label = 'manual', pgDump = runPostgresTool } = {}) {
  const sourceUrl = databaseUrl || process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(path.dirname(manifest), { recursive: true });
  await assertAbsent(output); await assertAbsent(manifest);
  const temporaryArchive = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const pool = createPool({ connectionString: sourceUrl, applicationName: 'igropoisk-ledger-backup', max: 1 });
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    const snapshotResult = await client.query('SELECT pg_export_snapshot() AS snapshot');
    const snapshot = snapshotResult.rows[0].snapshot;
    const inventory = await collectInventory(client);
    await pgDump('pg_dump', [
      '--format=custom', '--compress=9', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, `--file=${temporaryArchive}`
    ], { databaseUrl: sourceUrl });
    await client.query('COMMIT'); transaction = false;
    await fs.chmod(temporaryArchive, 0o600);
    await fs.rename(temporaryArchive, output);
    const archive = await inspectArchive(output);
    const backupManifest = {
      schemaVersion: 1,
      format: 'postgresql-custom',
      label,
      createdAt: new Date().toISOString(),
      sourceDatabase: databaseIdentity(sourceUrl),
      archive,
      inventory
    };
    validateBackupManifest(backupManifest, archive);
    await atomicJson(manifest, backupManifest);
    return backupManifest;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    await fs.rm(temporaryArchive, { force: true });
    await fs.rm(output, { force: true });
    await fs.rm(manifest, { force: true });
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  const result = await backupLedger({ databaseUrl: process.env.DATABASE_URL, ...options });
  console.log(JSON.stringify(result, null, 2));
}
