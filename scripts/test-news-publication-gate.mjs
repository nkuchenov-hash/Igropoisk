import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectMissingGamePageRequests, hasMissingGamePage } from './lib/news-publication-gate.mjs';

const ready = { id: 'ready', games: [{ gameId: 'game_ready', title: 'Ready Game', slug: 'ready-game', pageExists: true, pageUrl: 'game/ready-game/', identityVerified: true }], gameReviewReasons: [] };
const missingByReason = { id: 'reason', games: [{ slug: 'future-game' }], gameReviewReasons: ['missing-game-page'] };
const missingCanonical = {
  id: 'canonical', publishedAt: '2026-08-12T10:00:00Z', primaryUrl: 'https://example.invalid/canonical',
  games: [{ gameId: 'game_future', title: 'Future Game', slug: 'future-game', pageExists: false, pageUrl: '', identityVerified: true, verifiedExternal: true }], gameReviewReasons: []
};
const missingExternal = {
  id: 'external', publishedAt: '2026-08-12T11:00:00Z', primaryUrl: 'https://example.invalid/external',
  games: [{ gameId: 'news_game_abc', title: 'Crimson Moon', slug: 'crimson-moon', pageExists: false, pageUrl: '', identityVerified: true, verifiedExternal: true, verificationSources: [{ type: 'official', url: 'https://example.invalid/game' }, { type: 'database', url: 'https://db.example.invalid/game' }], resolutionConfidence: 0.93, matchedBy: 'web-identity-verifier-new-game' }], gameReviewReasons: []
};
const unverifiedFalsePositive = {
  id: 'false-positive', publishedAt: '2026-08-12T12:00:00Z', primaryUrl: 'https://example.invalid/hardware',
  games: [{ gameId: 'news_game_bad', title: 'AOC', slug: 'aoc', pageExists: false, pageUrl: '', verifiedExternal: false, identityVerified: false }], gameReviewReasons: ['missing-game-page']
};
const ambiguousOnly = { id: 'ambiguous', games: [], gameReviewReasons: ['ambiguous-primary-game-verification'] };

assert.equal(hasMissingGamePage(ready), false);
assert.equal(hasMissingGamePage(missingByReason), true);
assert.equal(hasMissingGamePage(missingCanonical), true);
assert.equal(hasMissingGamePage(missingExternal), true);
assert.equal(hasMissingGamePage(ambiguousOnly), false, 'Ambiguous unresolved names expose no game hashtag and do not trigger a wrong page.');

const sourceItems = [ready, missingCanonical, missingExternal, unverifiedFalsePositive, ambiguousOnly];
const requests = collectMissingGamePageRequests(sourceItems);
assert.equal(requests.length, 2, 'Only verified game identities may create page requests.');
assert.equal(requests.find(item => item.game_id === 'game_future')?.slug, 'future-game');
assert.equal(requests.find(item => item.game_id === 'news_game_abc')?.verified_external, true);
assert.equal(requests.find(item => item.game_id === 'news_game_abc')?.identity_verified, true);
assert.equal(requests.find(item => item.game_id === 'news_game_abc')?.confidence, 0.93);
assert.equal(requests.some(item => item.game_id === 'news_game_bad'), false, 'A non-verified entity must never trigger a game page.');
assert.deepEqual(sourceItems.map(item => item.id), ['ready', 'canonical', 'external', 'false-positive', 'ambiguous'], 'Request extraction must not remove or mutate news stories.');

const newsCss = fs.readFileSync('features/news/styles/index.css', 'utf8');
assert.doesNotMatch(newsCss, /\.ig-news-game-unlinked\s*\{[^}]*display\s*:\s*none/i, 'A verified game hashtag must stay visible even while its page is being created.');

console.log('News verified game-page request and visible hashtag tests passed.');
