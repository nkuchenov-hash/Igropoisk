#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  gamePageAssemblyObjectKey,
  isCredibleQueuedGameIdentity,
  normalizeGamePageAssemblyRequest,
  queueRequestToRegistryCandidate,
  reconcileQueuedCandidateWithRegistry,
  safeQueuedGameKind
} from './lib/game-page-assembly-queue.mjs';
import {isRetryableStorageError, withStorageRetry} from './lib/storage-retry.mjs';

assert.equal(safeQueuedGameKind('Super Smash Bros. Ultimate'), 'game');
assert.equal(safeQueuedGameKind('Control Ultimate Edition'), 'edition');
assert.equal(safeQueuedGameKind('Resident Evil 4 Remake'), 'remake');
assert.equal(isCredibleQueuedGameIdentity({title: 'Bodycam', slug: 'bodycam'}), true);
assert.equal(isCredibleQueuedGameIdentity({title: 'The', slug: 'the'}), false);

const request = normalizeGamePageAssemblyRequest({
  game_id: 'game_smash_ultimate',
  title: 'Super Smash Bros. Ultimate',
  slug: 'super-smash-bros-ultimate',
  identity_verified: true,
  verified_external: true,
  news_id: 'news-1',
  source_url: 'https://example.com/news'
}, {now: '2026-09-02T00:00:00.000Z'});
assert.equal(request.kind, 'game');
assert.equal(gamePageAssemblyObjectKey(request), 'queues/game-page-assembly/pending/game_smash_ultimate.json');
assert.equal(queueRequestToRegistryCandidate(request).kind, 'game');
assert.throws(() => normalizeGamePageAssemblyRequest({game_id:'news_game_tmp',title:'Tmp',slug:'tmp',identity_verified:true}), /canonical game_id/);
assert.throws(() => normalizeGamePageAssemblyRequest({game_id:'game_x',title:'X',slug:'x',identity_verified:false}), /non-credible game identity/);
assert.throws(() => normalizeGamePageAssemblyRequest({game_id:'game_the',title:'The',slug:'the',identity_verified:true}), /non-credible game identity/);

const falseEdition = {
  id: 'legacy_smash_id',
  identity: {
    canonicalTitle: {value: 'Super Smash Bros. Ultimate'},
    kind: {value: 'edition'}
  },
  presentation: {standalonePage: false, embeddedTab: 'editions'},
  workflow: {pageStatus: 'not_started'},
  auditLog: []
};
const fakeApi = {
  findById: id => id === falseEdition.id ? falseEdition : null,
  findBySlug: slug => slug === 'super-smash-bros-ultimate' ? falseEdition : null
};
const reconciled = reconcileQueuedCandidateWithRegistry(fakeApi, request, {now: '2026-09-02T01:00:00.000Z'});
assert.equal(reconciled.reconciled, true);
assert.equal(reconciled.candidate.game_id, 'legacy_smash_id');
assert.equal(falseEdition.identity.kind.value, 'game');
assert.equal(falseEdition.presentation.standalonePage, true);
assert.equal(falseEdition.presentation.embeddedTab, null);

assert.equal(isRetryableStorageError(new Error('fetch failed')), true);
assert.equal(isRetryableStorageError(new Error('GET x failed with 503: unavailable')), true);
assert.equal(isRetryableStorageError(new Error('GET x failed with 404: missing')), false);

let transientAttempts = 0;
const retriedValue = await withStorageRetry(async () => {
  transientAttempts += 1;
  if (transientAttempts < 3) throw new Error('fetch failed');
  return 'ok';
}, {attempts: 3, baseDelayMs: 0});
assert.equal(retriedValue, 'ok');
assert.equal(transientAttempts, 3);

let permanentAttempts = 0;
await assert.rejects(
  withStorageRetry(async () => {
    permanentAttempts += 1;
    throw new Error('GET x failed with 404: missing');
  }, {attempts: 3, baseDelayMs: 0}),
  /404/
);
assert.equal(permanentAttempts, 1);

const root = process.cwd();
const newsWorkflow = fs.readFileSync(path.join(root, '.github/workflows/news-pipeline.yml'), 'utf8');
const contentWorkflow = fs.readFileSync(path.join(root, '.github/workflows/content-pipeline.yml'), 'utf8');
const queuePublisher = fs.readFileSync(path.join(root, 'scripts/publish-game-page-assembly-queue.mjs'), 'utf8');
assert.match(newsWorkflow, /publish-game-page-assembly-queue\.mjs/);
assert.doesNotMatch(newsWorkflow, /gh workflow run news-game-page-fast\.yml/);
assert.match(newsWorkflow, /continue-on-error:\s*true[\s\S]*publish-game-page-assembly-queue\.mjs/);
assert.equal(fs.existsSync(path.join(root, '.github/workflows/news-game-page-fast.yml')), false);
assert.match(contentWorkflow, /hydrate-game-page-assembly-queue\.mjs/);
assert.match(contentWorkflow, /ack-game-page-assembly-queue\.mjs/);
assert.match(queuePublisher, /withStorageRetry/);
assert.match(queuePublisher, /attempts:\s*3/);

console.log('Game-page assembly queue boundary and transient-storage retry tests passed.');
