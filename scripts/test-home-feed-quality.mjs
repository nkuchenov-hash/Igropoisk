import assert from 'node:assert/strict';
import { duplicateIdentityMap, normalizeGameIdentity } from './lib/home-feed-identity.mjs';
import { evaluateHomeReleaseQuality } from './lib/home-release-quality.mjs';

const suffixPatterns = ['\\s*[™®]$'];
assert.equal(normalizeGameIdentity('Apex Legends™', suffixPatterns), 'apex legends');
assert.equal(normalizeGameIdentity('Apex Legends', suffixPatterns), 'apex legends');
assert.deepEqual(
  [...duplicateIdentityMap([
    { slug: 'apex-legends', title: 'Apex Legends' },
    { slug: 'apex-legendstm', title: 'Apex Legends™' }
  ], { suffixPatterns }).entries()],
  [['apex-legendstm', 'apex-legends']]
);

const popularIdentities = new Set(['big walk']);
const base = {
  slug: 'small-steam-release',
  title: 'Small Steam Release',
  release_type: 'full',
  genres: ['Simulation'],
  developer: 'Small Studio',
  publisher: 'Small Studio',
  image: {
    local_url: 'assets/covers/releases/small-steam-release.jpg',
    verified: true,
    status: 'downloaded_verified'
  },
  events: [{ precision: 'exact', date: '2026-08-20' }],
  sources: [{ id: 'steam:1', family: 'official_store', status: 'success' }],
  editorial: { status: 'ready', readiness: 90, needs_review: false, has_page: false }
};
const options = { popularIdentities, minimumQuality: 7, minimumIndependentCoverage: 2, maximumSteamWishlistPosition: 10, now: Date.parse('2026-08-11T00:00:00Z') };

const junk = evaluateHomeReleaseQuality(base, options);
assert.equal(junk.homepage_eligible, false);
assert(junk.reasons.includes('no_global_anticipation_signal'));

const published = evaluateHomeReleaseQuality({
  ...base,
  slug: 'published-release',
  title: 'Published Release',
  editorial: { ...base.editorial, status: 'published', has_page: true }
}, options);
assert.equal(published.homepage_eligible, false, 'A published page alone is not evidence of anticipation');
assert(!published.signals.includes('published_page'));

const popularWithoutCoverage = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk',
  title: 'Big Walk'
}, options);
assert.equal(popularWithoutCoverage.homepage_eligible, false, 'Popularity identity alone needs independent corroboration');
assert(popularWithoutCoverage.signals.includes('current_popular'));

const steamOnly = evaluateHomeReleaseQuality({
  ...base,
  slug: 'wishlisted-release',
  title: 'Wishlisted Release',
  anticipation: { steam_popular_upcoming_position: 5 }
}, options);
assert.equal(steamOnly.homepage_eligible, false, 'Steam Popular Upcoming alone is not global anticipation');
assert(steamOnly.signals.includes('steam_popular_upcoming'));

const corroborated = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk',
  title: 'Big Walk',
  anticipation: { independent_publication_count: 3, evidence_families: ['news', 'youtube'], popular_index: 15, popular_confidence: 0.7 }
}, options);
assert.equal(corroborated.homepage_eligible, true);
assert(corroborated.signals.includes('cross_site_coverage'));
assert(corroborated.signals.includes('current_popular'));

const corroboratedSteam = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk',
  title: 'Big Walk',
  anticipation: { steam_popular_upcoming_position: 4, independent_publication_count: 2, evidence_families: ['news', 'youtube'], popular_index: 12, popular_confidence: 0.62 }
}, options);
assert.equal(corroboratedSteam.homepage_eligible, true);
assert(corroboratedSteam.signals.includes('steam_popular_upcoming'));
assert(corroboratedSteam.signals.includes('cross_site_coverage'));

const reviewBlocked = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk-review',
  title: 'Big Walk',
  anticipation: { independent_publication_count: 3, evidence_families: ['news', 'youtube'], popular_index: 15, popular_confidence: 0.7 },
  editorial: { ...base.editorial, status: 'needs_review', needs_review: true }
}, options);
assert.equal(reviewBlocked.homepage_eligible, false);
assert(reviewBlocked.reasons.includes('needs_review'));

console.log('Home feed identity and release anticipation regression tests passed.');
