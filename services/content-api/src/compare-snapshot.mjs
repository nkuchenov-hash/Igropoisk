import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { closePool, getPool } from './database.mjs';
import { runMigrations } from './migrate.mjs';
import { contentHash, parseSnapshot, revisionDocument } from './news-record.mjs';

function argumentsFrom(argv) {
  const result = {
    file: path.resolve(process.cwd(), '../../data/news-events.json'),
    channel: 'news',
    record: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--file' && value) result.file = path.resolve(process.cwd(), value);
    if (name === '--channel' && value) result.channel = value;
    if (name === '--no-record') result.record = false;
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  return result;
}

function mapDigest(entries) {
  const canonical = [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, hash]) => `${id}:${hash}`)
    .join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function compareSnapshot({
  pool = getPool(),
  file,
  channel = 'news',
  record = true
}) {
  await runMigrations(pool);
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  const snapshot = parseSnapshot(payload);
  const expected = new Map(snapshot.items.map(event => [event.id, contentHash(revisionDocument(event))]));

  const result = await pool.query(`
    SELECT event.id, revision.content_hash
    FROM news_events event
    LEFT JOIN content_revisions revision ON revision.id = event.current_revision_id
    WHERE event.status <> 'archived'
    ORDER BY event.id
  `);
  const actual = new Map(result.rows.map(row => [row.id, String(row.content_hash || '')]));

  const missing = [...expected.keys()].filter(id => !actual.has(id)).sort();
  const extra = [...actual.keys()].filter(id => !expected.has(id)).sort();
  const mismatched = [...expected.keys()]
    .filter(id => actual.has(id) && actual.get(id) !== expected.get(id))
    .sort();
  const exact = missing.length === 0 && extra.length === 0 && mismatched.length === 0;

  const report = {
    status: exact ? 'exact' : 'drift',
    channel,
    sourceGeneratedAt: snapshot.generatedAt,
    sourceCount: expected.size,
    ledgerCount: actual.size,
    sourceDigest: mapDigest(expected),
    ledgerDigest: mapDigest(actual),
    missing,
    extra,
    mismatched
  };

  if (record) {
    await pool.query(`
      INSERT INTO shadow_sync_runs(
        channel, source_generated_at, source_digest, ledger_digest,
        source_item_count, ledger_item_count, status, drift, finished_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, NOW())
    `, [
      channel,
      snapshot.generatedAt,
      report.sourceDigest,
      report.ledgerDigest,
      report.sourceCount,
      report.ledgerCount,
      exact ? 'exact' : 'drift',
      JSON.stringify({ missing, extra, mismatched })
    ]);
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  try {
    const report = await compareSnapshot(options);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'exact') process.exitCode = 2;
  } finally {
    await closePool();
  }
}
