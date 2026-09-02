#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGameEntity, createRegistry } from './lib/game-registry.mjs';
import { registerNewsGameCandidates } from './lib/news-game-registry-discovery.mjs';

const read = file => fs.readFileSync(file, 'utf8');

const fast = read('scripts/run-news-game-page-fast.mjs');
const creator = read('scripts/ensure-game-page.mjs');
const adapter = read('scripts/materialize-news-game-pages-fast.mjs');
const workflow = read('.github/workflows/news-game-page-fast.yml');

// News may resolve/register a canonical identity, but page construction must stay
// delegated to the shared Game Creator rather than becoming a second page builder.
assert.match(fast, /scripts\/ensure-game-page\.mjs/,
  'news fast path must delegate base-page construction to the shared Game Creator');
assert.match(fast, /registerNewsGameCandidates/,
  'news fast path must resolve/register canonical game identities before page creation');

// Store/parser enrichment is optional. A verified console-exclusive, unreleased,
// delisted, or otherwise non-Steam game must still be able to receive a base page.
assert.match(fast, /optional parser unavailable; continuing with universal Game Creator/,
  'parser failure must remain non-blocking for base-page creation');
assert.doesNotMatch(fast, /if\s*\(\s*!appId\s*\)[\s\S]{0,180}(?:failed\.push|continue)/,
  'missing Steam app id must not reject a verified game');

// A database result explicitly verified as an exact video game is a standalone game
// even when its proper title contains commercial-looking words such as “Ultimate”.
const smashRequest = {
  game_id: 'news_game_smash_test',
  news_id: 'news_smash_test',
  title: 'Super Smash Bros. Ultimate',
  slug: 'super-smash-bros-ultimate',
  confidence: 0.95,
  identity_verified: true,
  verified_external: true,
  source_url: 'https://example.test/smash',
  verification_sources: [{ matchedBy: 'wikidata-video-game-exact', url: 'https://www.wikidata.org/wiki/Q54093632' }]
};
const freshRegistration = registerNewsGameCandidates(createRegistry(), [smashRequest]);
const freshSmash = Object.values(freshRegistration.registry.games)[0];
assert.equal(freshSmash?.identity?.kind?.value, 'game',
  'verified Super Smash Bros. Ultimate must be registered as a standalone game');
assert.equal(freshSmash?.presentation?.standalonePage, true,
  'verified Super Smash Bros. Ultimate must be allowed to receive a standalone page');

// Repair entities created by the previous bare-word heuristic instead of leaving the
// publication chain permanently blocked on an already-poisoned registry record.
const poisonedSmash = createGameEntity({
  title: 'Super Smash Bros. Ultimate',
  slug: 'super-smash-bros-ultimate',
  kind: 'edition',
  confidence: 0.95,
  source: { type: 'automated_inference', name: 'news-game-web-identity-verified', url: 'https://example.test/smash' }
});
const repairedRegistration = registerNewsGameCandidates(createRegistry({ games: { [poisonedSmash.id]: poisonedSmash } }), [smashRequest]);
const repairedSmash = repairedRegistration.registry.games[poisonedSmash.id];
assert.equal(repairedSmash?.identity?.kind?.value, 'game',
  'previously misclassified verified standalone games must be repaired');
assert.equal(repairedSmash?.presentation?.standalonePage, true,
  'repaired verified standalone games must receive standalone pages');

// The shared creator must materialize the canonical draft and public game route.
assert.match(creator, /write\(`data\/drafts\/\$\{slug\}\.json`,\s*game\)/,
  'shared Game Creator must write the canonical draft');
assert.match(creator, /path\.join\(root,\s*'game',\s*slug,\s*'index\.html'\)/,
  'shared Game Creator must materialize the public game page');
assert.match(creator, /page_available:\s*true/,
  'base-page publication state must explicitly expose page availability');

// Expensive/secondary modules may be queued, but may not gate base-page existence.
assert.match(creator, /Optional modules are observed, but never gate the existence of the base game page/,
  'review/DNA/similarity/guides must remain outside the base-page gate');
assert.match(creator, /review:\s*reviewReady\s*\?\s*'ready'\s*:\s*'pending'/,
  'review readiness must be represented as an independent module state');
assert.match(creator, /game_dna:\s*gameDnaReady\s*\?\s*'ready'\s*:\s*'pending'/,
  'Game DNA readiness must be represented as an independent module state');
assert.match(creator, /similarity:\s*similarityReady\s*\?\s*'ready'\s*:\s*'pending'/,
  'similarity readiness must be represented as an independent module state');

// Production publication must use the shared materializer, not a news-only copy.
assert.match(adapter, /materialize-game-creator-pages\.mjs/,
  'news production adapter must delegate to the shared Game Creator materializer');
assert.match(workflow, /node scripts\/test-game-creator-boundary\.mjs/,
  'Fast Game Creator workflow must keep this boundary contract in preflight');

console.log('Shared Game Creator boundary contract passed.');
