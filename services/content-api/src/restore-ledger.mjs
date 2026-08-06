import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './database.mjs';
import { collectInventory, databaseIdentity, inspectArchive, inventoryMatches, validateBackupManifest } from './backup-contract.mjs';
import { runPostgresTool } from './postgres-tools.mjs';

function argumentsFrom(argv) {
  const result = { backup: '', manifest: '', report: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]; const value = argv[index + 1];
    if (name === '--backup' && value) result.backup = path.resolve(value);
    if (name === '--manifest' && value) result.manifest = path.resolve(value);
    if (name === '--report' && value) result.report = path.resolve(value);
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  if (!result.backup || !result.manifest) throw new Error('--backup and --manifest are required.');
  return result;
}

async function atomicJson(file, value) {
  if (!file) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
}

export async function restoreLedger({ databaseUrl, backup, manifest, report = '', pgRestore = runPostgresTool } = {}) {
  const targetUrl = databaseUrl || process.env.DATABASE_URL;
  if (!targetUrl) throw new Error('DATABASE_URL is required.');
  const parsedManifest = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const archive = await inspectArchive(backup);
  validateBackupManifest(parsedManifest, archive);
  const targetIdentity = databaseIdentity(targetUrl);
  if (targetIdentity.display === parsedManifest.sourceDatabase.display) throw new Error('Restore target must differ from the backup source database.');

  const pool = createPool({ connectionString: targetUrl, applicationName: 'igropoisk-ledger-restore', max: 1 });
  try {
    const existing = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM pg_tables WHERE schemaname = 'public'");
    if (Number(existing.rows[0].count) !== 0) throw new Error('Restore target database must be empty.');
  } finally { await pool.end(); }

  await pgRestore('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', `--dbname=${targetIdentity.database}`, backup], { databaseUrl: targetUrl });
  const restoredPool = createPool({ connectionString: targetUrl, applicationName: 'igropoisk-ledger-restore-verify', max: 1 });
  try {
    const inventory = await collectInventory(restoredPool);
    if (!inventoryMatches(parsedManifest.inventory, inventory)) throw new Error('Restored ledger inventory does not match the backup manifest.');
    const result = { schemaVersion: 1, status: 'verified', verifiedAt: new Date().toISOString(), targetDatabase: targetIdentity, archive, inventory };
    await atomicJson(report, result);
    return result;
  } finally { await restoredPool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  const result = await restoreLedger({ databaseUrl: process.env.DATABASE_URL, ...options });
  console.log(JSON.stringify(result, null, 2));
}
