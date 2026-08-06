import fs from 'node:fs';
import path from 'node:path';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const freshIndex = args.indexOf('--fresh-hours');
const freshHours = freshIndex >= 0 ? Number(args[freshIndex + 1]) : null;
const errors = [];

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return null;
  }
}

function readOptionalJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  } catch {
    return null;
  }
}

function ageHours(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? (Date.now() - timestamp) / 3_600_000 : Infinity;
}

function requireFresh(label, value) {
  if (!Number.isFinite(freshHours)) return;
  const age = ageHours(value);
  if (!Number.isFinite(age) || age > freshHours) {
    errors.push(`${label} is stale: ${Number.isFinite(age) ? age.toFixed(1) : 'unknown'} hours old; limit is ${freshHours}.`);
  }
}

function eventStart(event = {}) {
  return event.date || event.date_start || null;
}

function eventEnd(event = {}) {
  return event.date_end || event.date || event.date_start || null;
}

function dateTime(value, end = false) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T${end ? '23:59:59' : '00:00:00'}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

const popular = readJson('data/popular/current.json');
const popularRun = readJson('data/parser-runs/popular.json');
const releases = readJson('data/releases/current.json');
const releasesRun = readJson('data/parser-runs/releases.json');
const quality = readOptionalJson('data/home-feeds-quality.json');
const qualityRules = readJson('config/home-feeds-quality.json');
const rules = readJson('features/home-releases/rules.json');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const popularRuntime = fs.readFileSync(path.join(root, 'assets/popular-home.js'), 'utf8');
const releasesRuntime = fs.readFileSync(path.join(root, 'assets/home-releases/index.js'), 'utf8');
const duplicateSuffixPatterns = qualityRules?.releases?.duplicate_suffix_patterns || [];
const minimumReleaseQuality = Math.max(1, Number(qualityRules?.releases?.minimum_homepage_quality || 7));

if (popular) {
  const ranking = Array.isArray(popular.ranking) ? popular.ranking : [];
  if (!ranking.length) errors.push('Popular feed is empty.');
  if (ranking.length > 20) errors.push(`Popular feed contains ${ranking.length} cards; homepage maximum is 20.`);
  const slugs = new Set();
  const identities = new Map();
  let previousTier = -1;
  const tierOrder = new Map([
    ['confirmed', 0],
    ['community_dominant', 1],
    ['platform_corroborated', 2],
    ['platform_chart', 3],
    ['carryover', 4]
  ]);
  for (const [index, item] of ranking.entries()) {
    if (!item?.slug || !item?.title) errors.push(`Popular item ${index + 1} has no slug or title.`);
    if (slugs.has(item?.slug)) errors.push(`Popular feed contains duplicate slug: ${item.slug}.`);
    slugs.add(item?.slug);

    const identity = normalizeGameIdentity(item?.title, duplicateSuffixPatterns);
    const existingIdentity = identity ? identities.get(identity) : null;
    if (existingIdentity) {
      errors.push(`Popular feed contains duplicate game identity: ${item.title} (${item.slug}) duplicates ${existingIdentity.title} (${existingIdentity.slug}).`);
    } else if (identity) {
      identities.set(identity, { slug: item.slug, title: item.title });
    }

    const score = Number(item?.score);
    if (!Number.isFinite(score)) errors.push(`Popular item ${item?.slug || index + 1} has an invalid score.`);
    if (quality || item?.editorial_tier) {
      const tier = tierOrder.get(item?.editorial_tier);
      if (!Number.isFinite(tier)) errors.push(`Popular item ${item?.slug || index + 1} has no valid editorial tier.`);
      if (Number.isFinite(tier) && tier < previousTier) errors.push(`Popular editorial tiers are out of order at ${item?.slug || index + 1}.`);
      if (Number.isFinite(tier)) previousTier = tier;
    }
    const images = [item?.image, ...(item?.image_candidates || [])].filter(Boolean);
    if (!images.length) errors.push(`Popular item ${item?.slug || index + 1} has no cover candidate.`);
    if (!Array.isArray(item?.evidence) || !item.evidence.length) errors.push(`Popular item ${item?.slug || index + 1} has no evidence.`);
  }
  requireFresh('Popular feed', popular.generated_at || popular.generatedAt);
}
if (!popularRun || !['success', 'partial'].includes(popularRun.status)) {
  errors.push(`Popular parser status is ${popularRun?.status || 'missing'}.`);
}
if (quality && !['complete', 'partial'].includes(quality.status)) {
  errors.push(`Home-feed quality status is ${quality.status || 'missing'}.`);
}
if (!indexHtml.includes('id="popular"') || !indexHtml.includes('assets/popular-home.js')) {
  errors.push('Homepage is not wired to the popular feed runtime.');
}
if (!/MAXIMUM_COUNT\s*=\s*20/.test(popularRuntime)) {
  errors.push('Popular runtime does not enforce the 20-card maximum.');
}
if (popularRuntime.includes('ranking.length<MAXIMUM_COUNT') || popularRuntime.includes('Expected ${MAXIMUM_COUNT}')) {
  errors.push('Popular runtime still blocks partial valid rankings.');
}

if (releases) {
  const rows = Array.isArray(releases.releases) ? releases.releases : [];
  if (rows.length < 6) errors.push(`Release feed contains ${rows.length} games; at least 6 are required.`);
  const slugs = new Set();
  const identities = new Map();
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let upcoming = 0;
  let tbd = 0;
  let homepageEligible = 0;

  for (const [index, game] of rows.entries()) {
    if (!game?.slug || !game?.title) errors.push(`Release item ${index + 1} has no slug or title.`);
    if (slugs.has(game?.slug)) errors.push(`Release feed contains duplicate slug: ${game.slug}.`);
    slugs.add(game?.slug);

    const identity = normalizeGameIdentity(game?.title, duplicateSuffixPatterns);
    const existingIdentity = identity ? identities.get(identity) : null;
    if (existingIdentity) {
      const expectedReason = `duplicate_of:${existingIdentity.slug}`;
      const editorialReasons = game?.editorial_quality?.reasons || [];
      if (game?.editorial_quality?.homepage_eligible !== false || !editorialReasons.includes(expectedReason)) {
        errors.push(`Release identity duplicate is not safely excluded: ${game.title} (${game.slug}) duplicates ${existingIdentity.title} (${existingIdentity.slug}).`);
      }
    } else if (identity) {
      identities.set(identity, { slug: game.slug, title: game.title });
    }

    const event = Array.isArray(game?.events) ? game.events[0] : null;
    if (!event) {
      errors.push(`Release item ${game?.slug || index + 1} has no event.`);
      continue;
    }
    if (!['exact', 'month', 'quarter', 'year', 'tbd'].includes(event.precision)) {
      errors.push(`Release item ${game.slug} has invalid precision: ${event.precision}.`);
    }
    if (!Array.isArray(game?.sources) || !game.sources.length) errors.push(`Release item ${game.slug} has no source.`);
    const images = [game?.image?.local_url, game?.image?.source_url, ...(game?.image_candidates || [])].filter(Boolean);
    if (!images.length) errors.push(`Release item ${game.slug} has no cover candidate.`);

    const editorialQuality = game?.editorial_quality || {};
    if (editorialQuality.homepage_eligible === true) {
      homepageEligible += 1;
      if (Number(editorialQuality.quality_score || 0) < minimumReleaseQuality) {
        errors.push(`Homepage release ${game.slug} is below quality threshold ${minimumReleaseQuality}.`);
      }
      if ((editorialQuality.reasons || []).length) {
        errors.push(`Homepage release ${game.slug} has blocking reasons: ${editorialQuality.reasons.join(', ')}.`);
      }
      if (!(editorialQuality.signals || []).length) {
        errors.push(`Homepage release ${game.slug} has no relevance signal.`);
      }
      if (game?.editorial?.needs_review || game?.editorial?.status === 'needs_review') {
        errors.push(`Homepage release ${game.slug} still requires editorial review.`);
      }
    }

    const start = dateTime(eventStart(event));
    const end = dateTime(eventEnd(event), true);
    if (!start && !end) tbd += 1;
    else if ((start !== null && start >= todayStart) || (end !== null && end >= todayStart)) upcoming += 1;
  }

  if (upcoming + tbd < 1) errors.push('Release feed has no expected releases.');
  if (homepageEligible < 1) errors.push('Release feed has no editorially eligible homepage release.');
  if (Number(releases?.editorial_quality?.homepage_eligible_count) !== homepageEligible) {
    errors.push(`Release editorial summary mismatch: expected ${homepageEligible}, found ${releases?.editorial_quality?.homepage_eligible_count}.`);
  }
  const selectedQualitySlugs = new Set((quality?.releases?.selected || []).map(item => item.slug));
  for (const game of rows.filter(item => item?.editorial_quality?.homepage_eligible === true).slice(0, Number(qualityRules?.releases?.homepage_limit || 24))) {
    if (!selectedQualitySlugs.has(game.slug) && selectedQualitySlugs.size) {
      errors.push(`Eligible homepage release ${game.slug} is absent from the quality snapshot selection.`);
    }
  }
  requireFresh('Release feed', releases.generated_at || releases.generatedAt);
}
if (!releasesRun || !['success', 'partial'].includes(releasesRun.status)) {
  errors.push(`Release parser status is ${releasesRun?.status || 'missing'}.`);
}
if (!rules || rules.schema_version < 3 || !rules.eligibility?.include_recent || !rules.eligibility?.include_upcoming || rules.eligibility?.require_editorial_quality !== true) {
  errors.push('Home release rules do not require editorial quality for both recent and upcoming releases.');
}
if (!indexHtml.includes('id="releaseHomeGrid"') || !indexHtml.includes('assets/home-releases/index.js')) {
  errors.push('Homepage is not wired to the release feed runtime.');
}
for (const token of ['recent_release_days', "kind==='recent'", "kind==='upcoming'", 'homepage_eligible===true']) {
  if (!releasesRuntime.includes(token)) errors.push(`Home release runtime is missing required logic: ${token}.`);
}

if (errors.length) {
  throw new Error(`Popular and release feed validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}

console.log(JSON.stringify({
  popular: {
    generated_at: popular?.generated_at || popular?.generatedAt || null,
    cards: popular?.ranking?.length || 0,
    parser_status: popularRun?.status || null,
    quality_status: quality?.status || 'legacy'
  },
  releases: {
    generated_at: releases?.generated_at || releases?.generatedAt || null,
    games: releases?.releases?.length || 0,
    homepage_eligible: Number(releases?.editorial_quality?.homepage_eligible_count || 0),
    parser_status: releasesRun?.status || null,
    recent_window_days: Number(rules?.recent_release_days || 7),
    maximum_cards: Number(rules?.maximum_cards || 12),
    minimum_quality: minimumReleaseQuality
  }
}, null, 2));
