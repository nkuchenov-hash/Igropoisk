import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const homeReleaseUi = fs.readFileSync('assets/home-releases/index.js', 'utf8');
const homeReleaseCss = fs.readFileSync('assets/home-releases/index.css', 'utf8');
const homeReleaseRules = JSON.parse(fs.readFileSync('features/home-releases/rules.json', 'utf8'));
for (const forbiddenCopy of [
  'Ожидаемость:',
  'Ожидаемость подтверждена',
  'независимых игровых изданий',
  'Steam Popular Upcoming #'
]) {
  assert.equal(homeReleaseUi.includes(forbiddenCopy), false, `Release cards must not expose evidence copy: ${forbiddenCopy}`);
}
assert(homeReleaseUi.includes('`Ожидание ${overall}`'), 'Release cards must expose compact overall anticipation rating');
assert(homeReleaseUi.includes('`Игроки ${players}`'), 'Release cards may expose compact player anticipation rating');
assert(homeReleaseUi.includes("calendarLink.textContent='Открыть календарь'"), 'Release calendar CTA must not include a decorative arrow');
assert(homeReleaseUi.includes("loadFeed('data/releases/public.json')"), 'Homepage releases must consume the public calendar feed');
assert.equal(homeReleaseUi.includes('.filter(crossSiteEligible)'), false, 'Homepage must not apply a second anticipation gate after the public calendar gate');
assert(homeReleaseUi.includes("addEventListener('wheel'"), 'Desktop release rail must support mouse-wheel/trackpad scrolling');
assert(homeReleaseUi.includes('data-release-rail="-1"') && homeReleaseUi.includes('data-release-rail="1"'), 'Release rail must expose previous/next controls');
assert(homeReleaseUi.includes("controls.className='ig-control-group home-releases__controls'"), 'Release controls must use the central control group in the heading');
assert(homeReleaseCss.includes('.home-showcase-heading__actions'), 'Release carousel controls must be positioned in the heading, not on the rail sides');
assert.equal(homeReleaseRules.source, 'data/releases/public.json', 'Home release rules must point to the public calendar feed');
assert.equal(homeReleaseRules.eligibility?.do_not_apply_second_homepage_gate, true, 'Rules must prohibit the duplicate homepage eligibility gate');
assert.equal(homeReleaseRules.interaction?.arrow_buttons, 'heading', 'Release arrows belong in the heading, not at the rail edges');

assert.equal(homeReleaseRules.eligibility?.require_homepage_quality_cover, true, 'Homepage release cards must require a quality cover');
assert.equal(homeReleaseRules.cover_quality?.required, true, 'Homepage cover quality gate must be mandatory');
assert(Number(homeReleaseRules.cover_quality?.minimum_width) >= 600, 'Homepage cover minimum width must be at least 600px');
assert(Number(homeReleaseRules.cover_quality?.minimum_height) >= 900, 'Homepage cover minimum height must be at least 900px');
assert(Number(homeReleaseRules.cover_quality?.minimum_bytes) >= 40000, 'Homepage cover minimum file size must be at least 40 KB');
assert(Number(homeReleaseRules.cover_quality?.minimum_aspect_ratio) >= 0.6, 'Homepage cover minimum aspect ratio is too permissive');
assert(Number(homeReleaseRules.cover_quality?.maximum_aspect_ratio) <= 0.75, 'Homepage cover maximum aspect ratio is too permissive');
assert.equal(homeReleaseRules.cover_quality?.remove_card_if_all_candidates_fail, true, 'A release with no acceptable cover must be removed from the homepage');
assert(homeReleaseUi.includes('primaryCoverApproved'), 'Homepage runtime must validate primary cover metadata');
assert(homeReleaseUi.includes('hasHomepageCoverCandidate'), 'Homepage runtime must filter out releases without an acceptable cover candidate');
assert(homeReleaseUi.includes('image.naturalWidth') && homeReleaseUi.includes('image.naturalHeight'), 'Homepage runtime must verify actual loaded image dimensions');
assert(homeReleaseUi.includes("media.classList.add('is-cover-ready')"), 'A cover must stay hidden until runtime quality verification succeeds');
assert(homeReleaseUi.includes('rejectCard(cardElement)'), 'A card with no acceptable cover must be removed instead of showing a bad image');
assert.equal(homeReleaseUi.includes("game.image?.source_url,\n    ...(game.image_candidates||[])"), false, 'Unverified generic image candidates must not be preferred on the homepage');
assert(homeReleaseCss.includes('aspect-ratio:2/3'), 'Homepage release media must use standard portrait 2:3 geometry');
assert(homeReleaseCss.includes('object-fit:contain'), 'Homepage release covers must not be cropped to fill a mismatched slot');
assert(homeReleaseCss.includes('grid-auto-columns:clamp(218px,16vw,238px)'), 'Desktop release cards must use a stable portrait-card width instead of narrow percentage columns');

console.log('Home feed identity, release anticipation and cover-quality regression tests passed.');
