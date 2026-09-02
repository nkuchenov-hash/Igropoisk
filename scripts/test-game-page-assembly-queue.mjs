#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  gamePageAssemblyObjectKey,
  normalizeGamePageAssemblyRequest,
  queueRequestToRegistryCandidate,
  safeQueuedGameKind
} from './lib/game-page-assembly-queue.mjs';

assert.equal(safeQueuedGameKind('Super Smash Bros. Ultimate'), 'game');
assert.equal(safeQueuedGameKind('Control Ultimate Edition'), 'edition');
assert.equal(safeQueuedGameKind('Resident Evil 4 Remake'), 'remake');

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
assert.throws(() => normalizeGamePageAssemblyRequest({game_id:'game_x',title:'X',slug:'x',identity_verified:false}), /identity-verified/);

const root = process.cwd();
const newsWorkflow = fs.readFileSync(path.join(root, '.github/workflows/news-pipeline.yml'), 'utf8');
const contentWorkflow = fs.readFileSync(path.join(root, '.github/workflows/content-pipeline.yml'), 'utf8');
assert.match(newsWorkflow, /publish-game-page-assembly-queue\.mjs/);
assert.doesNotMatch(newsWorkflow, /gh workflow run news-game-page-fast\.yml/);
assert.match(newsWorkflow, /continue-on-error:\s*true[\s\S]*publish-game-page-assembly-queue\.mjs/);
assert.match(contentWorkflow, /hydrate-game-page-assembly-queue\.mjs/);
assert.match(contentWorkflow, /ack-game-page-assembly-queue\.mjs/);

console.log('Game-page assembly queue boundary test passed.');
