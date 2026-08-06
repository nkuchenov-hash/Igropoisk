import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublishedNewsSnapshot } from '../src/remote-snapshot.mjs';
import { fixtureServer } from './helpers/remote-fixture.mjs';

async function withServer(mutator, work) {
  const fixture = await fixtureServer(mutator);
  try { return await work(fixture); } finally { await fixture.close(); }
}

const options = manifestUrl => ({ manifestUrl, allowedHosts: ['127.0.0.1'], allowHttpForTests: true });

test('canonical manifest verifies provenance, bytes, digest and content', async () => withServer(value => value, async fixture => {
  const result = await fetchPublishedNewsSnapshot(options(fixture.manifestUrl));
  assert.equal(result.manifest.sourceCommit, 'a'.repeat(40));
  assert.equal(result.snapshot.items.length, 1);
  assert.equal(result.entry.bytes, result.body.length);
}));

test('wrong SHA-256 is rejected', async () => withServer(manifest => ({ ...manifest,
  files: { 'data/news-events.json': { ...manifest.files['data/news-events.json'], sha256: 'b'.repeat(64) } } }),
async fixture => assert.rejects(fetchPublishedNewsSnapshot(options(fixture.manifestUrl)), /SHA-256/)));

test('redirects are rejected', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } });
  await assert.rejects(fetchPublishedNewsSnapshot({ manifestUrl: 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json', fetchImpl }), /redirects/);
});

test('bucket, key and byte drift are rejected', async () => withServer(manifest => ({ ...manifest,
  files: { 'data/news-events.json': { ...manifest.files['data/news-events.json'], key: 'news/snapshots/wrong/data/news-events.json' } } }),
async fixture => assert.rejects(fetchPublishedNewsSnapshot(options(fixture.manifestUrl)), /manifest version/)));

test('actual published manifest remains compatible', { skip: process.env.CI !== 'true' }, async () => {
  const result = await fetchPublishedNewsSnapshot();
  assert.ok(result.snapshot.items.length > 0);
  assert.match(result.manifest.sourceCommit, /^[a-f0-9]{40}$/i);
});
