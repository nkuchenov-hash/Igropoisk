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

const significantGenres = new Set(['Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Fighting']);
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
  events: [{ precision: 'exact', date: '2026-08-06' }],
  sources: [{ id: 'steam:1', family: 'official_store', status: 'success' }],
  editorial: { status: 'ready', readiness: 90, needs_review: false, has_page: false }
};

const junk = evaluateHomeReleaseQuality(base, { significantGenres, popularIdentities, minimumQuality: 7 });
assert.equal(junk.homepage_eligible, false);
assert(junk.reasons.includes('no_homepage_relevance_signal'));

const published = evaluateHomeReleaseQuality({
  ...base,
  slug: 'published-release',
  title: 'Published Release',
  editorial: { ...base.editorial, status: 'published', has_page: true }
}, { significantGenres, popularIdentities, minimumQuality: 7 });
assert.equal(published.homepage_eligible, true);
assert(published.signals.includes('published_page'));

const popular = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk',
  title: 'Big Walk'
}, { significantGenres, popularIdentities, minimumQuality: 7 });
assert.equal(popular.homepage_eligible, true);
assert(popular.signals.includes('current_popular'));

const corroborated = evaluateHomeReleaseQuality({
  ...base,
  slug: 'corroborated-release',
  title: 'Corroborated Release',
  sources: [
    ...base.sources,
    { id: 'publisher:1', family: 'official_site', status: 'success' }
  ]
}, { significantGenres, popularIdentities, minimumQuality: 7 });
assert.equal(corroborated.homepage_eligible, true);
assert(corroborated.signals.includes('independent_source'));

const reviewBlocked = evaluateHomeReleaseQuality({
  ...base,
  slug: 'big-walk-review',
  title: 'Big Walk',
  editorial: { ...base.editorial, status: 'needs_review', needs_review: true }
}, { significantGenres, popularIdentities, minimumQuality: 7 });
assert.equal(reviewBlocked.homepage_eligible, false);
assert(reviewBlocked.reasons.includes('needs_review'));

console.log('Home feed identity and release quality regression tests passed.');
