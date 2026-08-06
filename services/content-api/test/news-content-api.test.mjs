import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareSnapshot } from '../src/compare-snapshot.mjs';
import { createPool } from '../src/database.mjs';
import { importSnapshot } from '../src/import-snapshot.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { recordRuntimeState } from '../src/runtime-state.mjs';
import { normalizeNewsEvent } from '../src/news-record.mjs';
import { createNewsServer } from '../src/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures/news-events.json');
const pool = createPool({ applicationName: 'igropoisk-news-content-api-test' });
let server;
let baseUrl;

before(async () => {
  await runMigrations(pool);
  await pool.query(`
    TRUNCATE shadow_sync_runs, parser_errors, parser_runs, publications, news_event_sources,
      news_events, media_assets, sources, content_revisions
    RESTART IDENTITY CASCADE
  `);
  await importSnapshot({
    pool,
    file: fixture,
    snapshotVersion: 'fixture-2026-08-05',
    manifestUrl: 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json'
  });
  await compareSnapshot({ pool, file: fixture });
  server = createNewsServer({
    pool,
    allowedOrigins: new Set(['https://nkuchenov-hash.github.io']),
    runtime: { mode: 'shadow', readSource: 'object_storage', version: 'test' }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('normalization rejects an event without a public URL', () => {
  assert.throws(() => normalizeNewsEvent({ id: 'broken', titleRu: 'Нет URL', publishedAt: new Date() }));
});

test('liveness is independent while readiness checks PostgreSQL', async () => {
  const live = await fetch(`${baseUrl}/live`).then(response => response.json());
  assert.equal(live.status, 'alive');
  assert.equal(live.version, 'test');

  const ready = await fetch(`${baseUrl}/ready`).then(response => response.json());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.runtimeMode, 'shadow');
  assert.equal(ready.readSource, 'object_storage');
});

test('read-only API exposes health and current publication', async () => {
  const health = await fetch(`${baseUrl}/health`).then(response => response.json());
  assert.equal(health.status, 'ready');
  assert.equal(health.publishedCount, 2);

  const publication = await fetch(`${baseUrl}/v1/publications/current`).then(response => response.json());
  assert.equal(publication.snapshotVersion, 'fixture-2026-08-05');
  assert.equal(publication.itemCount, 2);
});

test('news list and detail preserve source relationships', async () => {
  const list = await fetch(`${baseUrl}/v1/news?limit=1`).then(response => response.json());
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, 'fixture-official-1');

  const item = await fetch(`${baseUrl}/v1/news/fixture-media-2`).then(response => response.json());
  assert.equal(item.sources.length, 2);
  assert.equal(item.primarySource, 'Media Example');
});

test('the service rejects write methods', async () => {
  const response = await fetch(`${baseUrl}/v1/news`, { method: 'POST' });
  assert.equal(response.status, 405);
});

test('reimporting the same snapshot does not duplicate revisions', async () => {
  await importSnapshot({ pool, file: fixture, snapshotVersion: 'fixture-repeat' });
  const result = await pool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM content_revisions
    WHERE entity_type = 'news_event'
  `);
  assert.equal(result.rows[0].count, 2);
});

test('shadow comparison proves independent per-item parity', async () => {
  const report = await compareSnapshot({ pool, file: fixture });
  assert.equal(report.status, 'exact');
  assert.equal(report.sourceCount, 2);
  assert.equal(report.ledgerCount, 2);
  assert.equal(report.sourceDigest, report.ledgerDigest);
  const stored = await pool.query('SELECT status FROM shadow_sync_runs ORDER BY id DESC LIMIT 1');
  assert.equal(stored.rows[0].status, 'exact');
});


test('cutover guard accepts only a fresh exact synchronization', async () => {
  const config = {
    runtimeMode: 'canary',
    readSource: 'content_api',
    shadowWriteEnabled: true,
    maxSyncAgeMs: 60_000,
    serviceVersion: 'test'
  };
  const latest = await recordRuntimeState(pool, config);
  assert.equal(latest.status, 'exact');

  await pool.query(`
    INSERT INTO shadow_sync_runs(
      channel, source_digest, ledger_digest, source_item_count,
      ledger_item_count, status, drift, finished_at
    ) VALUES ('news', $1, $2, 2, 1, 'drift', '{}'::JSONB, NOW())
  `, ['a'.repeat(64), 'b'.repeat(64)]);
  await assert.rejects(() => recordRuntimeState(pool, config), /not exact/);
});
