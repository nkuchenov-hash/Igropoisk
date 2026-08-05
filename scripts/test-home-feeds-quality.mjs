import assert from 'node:assert/strict';
import {
  evaluatePopularItem,
  filterPopularRanking,
  releaseCategory,
  selectHomeReleases
} from './home-feeds-quality-lib.mjs';

const rules = {
  weak_families: ['steam_chart'],
  minimum_community_families: 2,
  minimum_independent_news_sources: 2,
  minimum_single_family_evidence: 2,
  edition_suffix_patterns: ['\\bdeluxe edition\\b.*$']
};

const weak = evaluatePopularItem({ families: ['steam_chart'], evidence: [{ family: 'steam_chart' }], news_sources: 0 }, rules);
assert.equal(weak.eligible, false, 'Steam-only evergreen demand must not be enough.');

const newsSpike = evaluatePopularItem({ families: ['news', 'steam_chart'], evidence: [{ family: 'news' }, { family: 'news' }], news_sources: 2 }, rules);
assert.equal(newsSpike.eligible, true, 'Independent news coverage must qualify as a current spike.');

const deduped = filterPopularRanking([
  { slug: 'game', title: 'Game', score: 10, families: ['news'], news_sources: 2, evidence: [{ family: 'news' }, { family: 'news' }] },
  { slug: 'game-deluxe', title: 'Game Deluxe Edition', score: 9, families: ['news'], news_sources: 2, evidence: [{ family: 'news' }, { family: 'news' }] }
], rules);
assert.equal(deduped.accepted.length, 1, 'Editions must collapse to one popular card.');
assert.equal(deduped.rejected.length, 1);

const now = Date.parse('2026-08-05T12:00:00Z');
assert.equal(releaseCategory({ events: [{ date: '2026-08-04', precision: 'exact' }] }, { recent_days: 7, soon_days: 120 }, now), 'recent');
assert.equal(releaseCategory({ events: [{ date: '2026-08-06', precision: 'exact' }] }, { recent_days: 7, soon_days: 120 }, now), 'soon');
assert.equal(releaseCategory({ events: [{ precision: 'tbd' }] }, { recent_days: 7, soon_days: 120 }, now), 'tbd');

const releaseRules = {
  minimum_home_cards: 1,
  maximum_home_cards: 2,
  recent_days: 7,
  soon_days: 120,
  excluded_title_patterns: ['\\bprologue\\b'],
  edition_suffix_patterns: ['\\bdeluxe edition\\b.*$'],
  aliases: {}
};
const releases = [
  { slug: 'known', title: 'Known Game', developer: 'A', publisher: 'B', events: [{ date: '2026-08-06', precision: 'exact' }], sources: [{ id: 'official' }], image: { local_url: 'cover.jpg' }, editorial: { readiness: 80 } },
  { slug: 'known-deluxe', title: 'Known Game Deluxe Edition', developer: 'A', publisher: 'B', events: [{ date: '2026-08-06', precision: 'exact' }], sources: [{ id: 'official' }], image: { local_url: 'cover.jpg' }, editorial: { readiness: 40 } },
  { slug: 'noise', title: 'Unknown Game Prologue', developer: 'A', publisher: 'B', events: [{ date: '2026-08-06', precision: 'exact' }], sources: [{ id: 'official' }], image: { local_url: 'cover.jpg' }, editorial: { readiness: 80 } }
];
const selected = selectHomeReleases(releases, { popularRanks: new Map([['known', 3]]), catalogSlugs: new Set() }, releaseRules, now);
assert.equal(selected.selected.length, 1);
assert.equal(selected.selected[0].slug, 'known');
assert.equal(selected.excluded.some(item => item.slug === 'noise' && item.exclusion_reason), true);
assert.equal(selected.excluded.some(item => item.slug === 'known-deluxe' && item.duplicate_of === 'known'), true);

console.log('Home feeds quality contract verified.');
