import assert from 'node:assert/strict';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { createGameEntity, createRegistry, rebuildIndexes } from './lib/game-registry.mjs';

const steamSource = (id) => ({ id: `steam:${id}`, family: 'official_store', title: 'Steam', url: `https://store.steampowered.com/app/${id}/`, platforms: ['PC'] });
const event = (id, title, platforms = ['PC'], sourceIds = [`steam:${id}`], date = '2026-10-10') => ({
  id: `steam:${id}`, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, release_type: 'full',
  external_ids: {steam: id},
  sources: [steamSource(id)], events: [{ id: `e:${id}`, date, date_start: date, date_end: date, precision: 'exact', region: 'worldwide', platforms, confidence: 0.97, source_ids: sourceIds }],
  editorial_quality: { homepage_eligible: true, quality_score: 10, signals: ['current_popular'] },
});
const raw = [
  event(1, 'Important Game'),
  event(2, 'Important Game Demo'),
  event(3, 'Important Game Playtest'),
  event(4, 'Important Game Deluxe Edition'),
  event(5, 'Console Leak', ['PlayStation 5']),
  ...Array.from({ length: 20 }, (_, index) => event(100 + index, `Notable ${index}`)),
];
const editorial = { decisions: {
  'steam:1': { decision: 'rejected', rejection_reason: 'editorial ban', publication_forbidden: true, locked_fields: ['decision'] },
  'steam:100': { decision: 'published', event_overrides: [{ event_id: 'e:100', date: '2026-10-11', date_start: '2026-10-11', date_end: '2026-10-11', precision: 'exact', platforms: ['PC'], source_ids: ['steam:100'] }] },
}};
const claims = [{ slug: 'console-leak', platforms: ['PlayStation 5'], date: '2026-10-12', source: { id: 'ps-store:5', family: 'platform_store', title: 'PlayStation Store', url: 'https://store.playstation.com/example', platforms: ['PlayStation 5'] }, confidence: 0.98 }];
const policy = { minimum_significance_score: 1, max_public_releases_per_day: 12 };
const candidates = buildCandidates({ rawReleases: raw, editorial, officialClaims: claims, policy });
const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
assert.equal(byId.get('steam:1').moderation.status, 'rejected', 'manual rejection must survive');
assert.equal(byId.get('steam:2').moderation.rejection_reason, 'demo');
assert.equal(byId.get('steam:3').moderation.rejection_reason, 'playtest');
assert.equal(byId.get('steam:4').moderation.rejection_reason, 'duplicate_edition');
assert.equal(byId.get('steam:5').events.some((item) => item.platform_confirmations['PlayStation 5']?.includes('ps-store:5')), true);
assert.equal(byId.get('steam:100').events.some((item) => item.date === '2026-10-11'), true, 'manual date correction must survive');
const publicCalendar = buildPublicCalendar(candidates, '2026-08-06T00:00:00Z');
assert.ok(publicCalendar.statistics.max_exact_releases_in_one_day <= 12, 'daily cap must prevent raw flood');
assert.deepEqual(validateCalendar({ candidates, publicCalendar, policy }), []);

const registry = createRegistry({generatedAt: '2026-08-06T00:00:00Z'});
const exactGame = createGameEntity({
  title: 'Canonical Exact Game',
  steamAppId: 9001,
  releaseYear: 2026,
  kind: 'game',
}, {now: '2026-08-06T00:00:00Z'});
const conflictingGame = createGameEntity({
  title: 'Shared Identity',
  releaseYear: 2026,
  kind: 'game',
}, {now: '2026-08-06T00:00:00Z'});
registry.games[exactGame.id] = exactGame;
registry.games[conflictingGame.id] = conflictingGame;
rebuildIndexes(registry);

const adapterCandidates = [
  {...event(9001, 'Store Title Changed'), moderation: {status: 'published'}},
  {...event(9002, 'Shared Identity'), release_type: 'expansion', external_ids: {}, moderation: {status: 'review'}},
  {...event(9003, 'Completely Unknown'), external_ids: {}, moderation: {status: 'review'}},
];
const linked = linkReleaseCandidatesToRegistry(adapterCandidates, registry);
const linkedById = new Map(linked.candidates.map(candidate => [candidate.id, candidate]));
assert.equal(linkedById.get('steam:9001').game_resolution.status, 'matched', 'exact Steam ID must resolve to canonical game');
assert.equal(linkedById.get('steam:9001').game_id, exactGame.id);
assert.equal(linkedById.get('steam:9002').game_resolution.status, 'needs_review', 'kind conflict must never force a canonical link');
assert.equal(Object.hasOwn(linkedById.get('steam:9002'), 'game_id'), false);
assert.equal(linkedById.get('steam:9003').game_resolution.status, 'unresolved', 'unknown release must remain unresolved');
assert.equal(linkedById.get('steam:9002').moderation.status, 'review', 'registry linkage must not change release moderation');

const linkedPublic = attachCanonicalGameIdsToPublicCalendar({
  releases: adapterCandidates.map(candidate => ({id: candidate.id, title: candidate.title})),
}, linked.candidates);
assert.equal(linkedPublic.releases.find(item => item.id === 'steam:9001').game_id, exactGame.id);
assert.equal(Object.hasOwn(linkedPublic.releases.find(item => item.id === 'steam:9002'), 'game_id'), false, 'ambiguous release must not expose canonical game_id');
assert.deepEqual(linked.statistics, {matched: 1, needs_review: 1, unresolved: 1});

console.log('release-calendar-policy tests passed');
