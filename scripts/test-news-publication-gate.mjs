import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableGameId } from './lib/game-registry.mjs';
import { collectMissingGamePageRequests, hasMissingGamePage } from './lib/news-publication-gate.mjs';

const ready = { id: 'ready', games: [{ gameId: 'game_ready', title: 'Ready Game', slug: 'ready-game', pageExists: true, pageReady: true, pageUrl: 'game/ready-game/', identityVerified: true }], gameReviewReasons: [] };
const missingByReason = { id: 'reason', games: [{ slug: 'future-game' }], gameReviewReasons: ['missing-game-page'] };
const missingCanonical = {
  id: 'canonical', publishedAt: '2026-08-12T10:00:00Z', primaryUrl: 'https://example.invalid/canonical',
  games: [{ gameId: 'game_future', title: 'Future Game', slug: 'future-game', pageExists: true, pageReady: false, assemblyRequired: true, pageUrl: 'game/pending/?slug=future-game&title=Future+Game', identityVerified: true, verifiedExternal: true }], gameReviewReasons: []
};
const missingExternal = {
  id: 'external', publishedAt: '2026-08-12T11:00:00Z', primaryUrl: 'https://example.invalid/external',
  games: [{ gameId: 'news_game_abc', title: 'Crimson Moon', slug: 'crimson-moon', pageExists: true, pageReady: false, assemblyRequired: true, pageUrl: 'game/pending/?slug=crimson-moon&title=Crimson+Moon', identityVerified: true, verifiedExternal: true, verificationSources: [{ type: 'official', url: 'https://example.invalid/game' }, { type: 'database', url: 'https://db.example.invalid/game' }], resolutionConfidence: 0.93, matchedBy: 'web-identity-verifier-new-game' }], gameReviewReasons: []
};
const unverifiedFalsePositive = {
  id: 'false-positive', publishedAt: '2026-08-12T12:00:00Z', primaryUrl: 'https://example.invalid/hardware',
  games: [{ gameId: 'news_game_bad', title: 'AOC', slug: 'aoc', pageExists: true, pageReady: false, assemblyRequired: true, pageUrl: 'game/pending/?slug=aoc&title=AOC', verifiedExternal: false, identityVerified: false }], gameReviewReasons: ['missing-game-page']
};
const poisonedGenericIdentity = {
  id: 'poisoned-generic', publishedAt: '2026-08-12T13:00:00Z', primaryUrl: 'https://example.invalid/industry-story',
  games: [{ gameId: 'game_52651675bf5dda52d41b', title: 'the', slug: 'the', pageExists: true, pageReady: false, assemblyRequired: true, pageUrl: 'game/pending/?slug=the&title=the', verifiedExternal: true, identityVerified: true }], gameReviewReasons: ['missing-game-page']
};
const ambiguousOnly = { id: 'ambiguous', games: [], gameReviewReasons: ['ambiguous-primary-game-verification'] };

assert.equal(hasMissingGamePage(ready), false);
assert.equal(hasMissingGamePage(missingByReason), true);
assert.equal(hasMissingGamePage(missingCanonical), true);
assert.equal(hasMissingGamePage(missingExternal), true);
assert.equal(hasMissingGamePage(ambiguousOnly), false, 'Ambiguous unresolved names expose no game hashtag and do not trigger a wrong page.');

const sourceItems = [ready, missingCanonical, missingExternal, unverifiedFalsePositive, poisonedGenericIdentity, ambiguousOnly];
const requests = collectMissingGamePageRequests(sourceItems);
assert.equal(requests.length, 2, 'Only safe verified game identities may create page requests.');
assert.equal(requests.find(item => item.game_id === 'game_future')?.slug, 'future-game');
const externalCanonicalId = stableGameId({ canonicalTitle: 'Crimson Moon', title: 'Crimson Moon', slug: 'crimson-moon' });
assert.equal(requests.find(item => item.game_id === externalCanonicalId)?.verified_external, true);
assert.equal(requests.find(item => item.game_id === externalCanonicalId)?.identity_verified, true);
assert.equal(requests.find(item => item.game_id === externalCanonicalId)?.confidence, 0.93);
assert.equal(requests.some(item => String(item.game_id).startsWith('news_game_')), false, 'Temporary news IDs must be converted to canonical game IDs before page assembly.');
assert.equal(requests.some(item => item.slug === 'the'), false, 'Generic poisoned identities must never enter page assembly.');
assert.equal(requests.some(item => item.game_id === 'news_game_bad'), false, 'A non-verified entity must never trigger a game page.');
assert.deepEqual(sourceItems.map(item => item.id), ['ready', 'canonical', 'external', 'false-positive', 'poisoned-generic', 'ambiguous'], 'Request extraction must not remove or mutate news stories.');

const newsCss = fs.readFileSync('features/news/styles/index.css', 'utf8');
assert.doesNotMatch(newsCss, /\.ig-news-game-unlinked\s*\{[^}]*display\s*:\s*none/i, 'A verified game hashtag must stay visible even while its page is being created.');

const hashtagAudit = fs.readFileSync('scripts/audit-news-game-hashtags.mjs', 'utf8');
assert.match(hashtagAudit, /blockingIntegrityFindings/, 'Hashtag audit must keep integrity findings observable.');
assert.match(hashtagAudit, /deferred_context_findings/, 'Ambiguous context must remain observable in diagnostics.');
assert.match(hashtagAudit, /publication_policy:\s*'advisory-only-never-block-feed'/, 'Hashtag audit must explicitly declare advisory-only behavior.');
assert.match(hashtagAudit, /publication_blocked:\s*false/, 'Hashtag audit must never mark the whole feed as blocked.');
assert.doesNotMatch(hashtagAudit, /process\.exit\(1\)/, 'No hashtag/page integrity finding may stop publication of the whole news feed.');

console.log('News page queue, pending-route hashtags, poisoned identity isolation and fail-open publication tests passed.');
