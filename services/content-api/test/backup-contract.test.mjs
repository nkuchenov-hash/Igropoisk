import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseIdentity, inventoryMatches, LEDGER_TABLES, pgEnvironment, validateBackupManifest } from '../src/backup-contract.mjs';

test('database identity and pg environment never put credentials in display metadata', () => {
  const url = 'postgresql://user:p%40ss@db.example:5433/igropoisk?sslmode=require';
  assert.deepEqual(databaseIdentity(url), { host: 'db.example', port: 5433, database: 'igropoisk', display: 'db.example:5433/igropoisk' });
  const env = pgEnvironment(url, {});
  assert.equal(env.PGUSER, 'user'); assert.equal(env.PGPASSWORD, 'p@ss'); assert.equal(env.PGSSLMODE, 'require');
});

test('verify-full backup tooling requires a CA file', () => {
  assert.throws(() => pgEnvironment('postgresql://u:p@db.example/db', { PGSSL_MODE: 'verify-full' }), /PGSSL_CA_FILE/);
});

test('backup manifest enforces archive digest, bytes and complete inventory', () => {
  const counts = Object.fromEntries(LEDGER_TABLES.map(table => [table, 0]));
  const manifest = { schemaVersion: 1, format: 'postgresql-custom', createdAt: new Date().toISOString(),
    sourceDatabase: { display: 'db:5432/source' }, archive: { bytes: 10, sha256: 'a'.repeat(64) }, inventory: { counts, migrations: [] } };
  assert.equal(validateBackupManifest(manifest, manifest.archive), manifest);
  assert.throws(() => validateBackupManifest(manifest, { bytes: 11, sha256: 'a'.repeat(64) }), /do not match/);
});

test('inventory comparison covers every ledger table and migration', () => {
  const counts = Object.fromEntries(LEDGER_TABLES.map(table => [table, 1]));
  assert.equal(inventoryMatches({ counts, migrations: ['001'] }, { counts: { ...counts }, migrations: ['001'] }), true);
  assert.equal(inventoryMatches({ counts, migrations: ['001'] }, { counts: { ...counts, news_events: 2 }, migrations: ['001'] }), false);
});
