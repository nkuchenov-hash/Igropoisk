import assert from 'node:assert/strict';
import { createRegistry } from './lib/game-registry.mjs';
import { decodeNewsGameRequests, registerNewsGameCandidates } from './lib/news-game-registry-discovery.mjs';

const request = {
  news_id: 'news-1',
  game_id: 'news_game_external_1',
  title: 'Crimson Moon',
  slug: 'crimson-moon',
  confidence: 0.93,
  verified_external: true,
  source_url: 'https://example.invalid/news/crimson-moon'
};
const encoded = Buffer.from(JSON.stringify([request]), 'utf8').toString('base64');
assert.deepEqual(decodeNewsGameRequests(encoded), [request]);

const first = registerNewsGameCandidates(createRegistry(), [request]);
assert.equal(first.created, 1);
assert.equal(first.matched, 0);
assert.equal(first.issues.length, 0);
assert.equal(first.resolved.length, 1);
assert.match(first.resolved[0].game_id, /^game_/);
assert.notEqual(first.resolved[0].game_id, request.game_id);
assert.equal(first.resolved[0].slug, 'crimson-moon');

const second = registerNewsGameCandidates(first.registry, [{ ...request, news_id: 'news-2', game_id: 'news_game_external_2' }]);
assert.equal(second.created, 0);
assert.equal(second.matched, 1);
assert.equal(second.resolved[0].game_id, first.resolved[0].game_id, 'The same news-discovered game must reuse its canonical Game Registry identity.');

console.log('News Game Registry discovery tests passed.');
