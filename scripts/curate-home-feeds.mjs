import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const config = read('config/home-feeds-quality.json');
const popular = read('data/popular/current.json');
const releases = read('data/releases/current.json');
const now = Date.now();
const checkedAt = new Date(now).toISOString();

const primaryRules = config.popular.primary || {};
const secondaryRules = config.popular.secondary || {};
const secondaryFamilies = new Set(secondaryRules.allowed_independent_families || ['news', 'youtube', 'reddit', 'twitch']);
const liveFamilies = new Set(['youtube', 'reddit', 'twitch']);
const freshWindowMs = Number(secondaryRules.fresh_signal_hours || popular.window_hours || 96) * 3_600_000;

const independentEvidence = item => (item.evidence || []).filter(evidence => evidence.family !== 'steam_chart');
const steamPosition = item => {
  const positions = (item.evidence || [])
    .filter(evidence => evidence.family === 'steam_chart')
    .map(evidence => Number(evidence.position))
    .filter(Number.isFinite);
  return positions.length ? Math.min(...positions) : null;
};
const isFreshIndependentEvidence = evidence => {
  if (!secondaryFamilies.has(evidence.family)) return false;
  const observedAt = Date.parse(evidence.observed_at || evidence.published_at || evidence.date || '');
  if (Number.isFinite(observedAt)) return observedAt <= now + 300_000 && now - observedAt <= freshWindowMs;
  return liveFamilies.has(evidence.family);
};
const unique = values => [...new Set(values.filter(Boolean))];

const popularAudit = [];
const popularSelected = [];
for (const [rankIndex, item] of (popular.ranking || []).entries()) {
  const confidence = Number(item.confidence || 0);
  const score = Number(item.score || 0);
  const freshEvidence = independentEvidence(item).filter(isFreshIndependentEvidence);
  const freshFamilies = new Set(freshEvidence.map(evidence => evidence.family));
  const position = steamPosition(item);
  const hasSteam = Number.isFinite(position);
  const evergreenBlocked = Boolean(
    config.popular.evergreen_requires_fresh_non_steam_signal &&
    item.in_catalog &&
    freshEvidence.length === 0
  );

  const primaryReasons = [];
  if (confidence < Number(primaryRules.minimum_confidence || 0)) primaryReasons.push('primary_low_confidence');
  if (score < Number(primaryRules.minimum_score || 0)) primaryReasons.push('primary_low_score');
  if (freshFamilies.size < Number(primaryRules.minimum_independent_families || 2)) primaryReasons.push('primary_insufficient_independent_families');

  const secondaryReasons = [];
  if (!secondaryRules.enabled) secondaryReasons.push('secondary_disabled');
  if (!hasSteam) secondaryReasons.push('secondary_not_in_steam_top_sellers');
  if (hasSteam && position > Number(secondaryRules.maximum_steam_position || 40)) secondaryReasons.push('secondary_steam_position_too_low');
  if (freshEvidence.length < Number(secondaryRules.minimum_independent_evidence || 1)) secondaryReasons.push('secondary_no_fresh_independent_signal');
  if (confidence < Number(secondaryRules.minimum_confidence || 0)) secondaryReasons.push('secondary_low_confidence');
  if (score < Number(secondaryRules.minimum_score || 0)) secondaryReasons.push('secondary_low_score');

  const primaryEligible = !evergreenBlocked && primaryReasons.length === 0;
  const secondaryEligible = !evergreenBlocked && secondaryReasons.length === 0;
  const tier = primaryEligible ? 'primary' : secondaryEligible ? 'steam_corroborated' : null;
  const eligible = Boolean(tier);
  const reasons = eligible
    ? []
    : unique([
        evergreenBlocked ? 'evergreen_without_fresh_signal' : null,
        ...primaryReasons,
        ...secondaryReasons
      ]);
  const selectionReason = tier === 'primary'
    ? `Несколько свежих независимых сигналов: ${[...freshFamilies].join(', ')}`
    : tier === 'steam_corroborated'
      ? `Steam Top ${position} + свежий независимый сигнал: ${[...freshFamilies].join(', ')}`
      : null;

  popularAudit.push({
    rank: rankIndex + 1,
    slug: item.slug,
    title: item.title,
    eligible,
    tier,
    reasons,
    score,
    confidence,
    families: item.families || [],
    fresh_independent_families: [...freshFamilies],
    fresh_independent_evidence_count: freshEvidence.length,
    steam_position: position,
    evidence: (item.evidence || []).slice(0, 12).map(evidence => ({
      family: evidence.family,
      source: evidence.source,
      title: evidence.title,
      observed_at: evidence.observed_at || null,
      position: Number.isFinite(Number(evidence.position)) ? Number(evidence.position) : null,
      value: Number.isFinite(Number(evidence.value)) ? Number(evidence.value) : null,
      url: evidence.url || null
    }))
  });

  if (eligible) {
    popularSelected.push({
      ...item,
      editorial_tier: tier,
      editorial_reason: selectionReason,
      editorial_checked_at: checkedAt
    });
  }
}

const titleKey = title => {
  let value = String(title || '').normalize('NFKC').toLowerCase();
  for (const pattern of config.releases.duplicate_suffix_patterns || []) value = value.replace(new RegExp(pattern, 'i'), '');
  return value.replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
};
const excludedPatterns = (config.releases.exclude_title_patterns || []).map(pattern => new RegExp(pattern, 'i'));
const significantGenres = new Set(config.releases.significant_genres || []);
const seen = new Map();
const releaseAudit = [];

for (const game of releases.releases || []) {
  const reasons = [];
  const title = String(game.title || '');
  if (excludedPatterns.some(pattern => pattern.test(title))) reasons.push('non_full_release');
  const key = titleKey(title);
  if (seen.has(key)) reasons.push(`duplicate_of:${seen.get(key)}`);
  else if (key) seen.set(key, game.slug);

  const event = (game.events || [])[0] || {};
  let quality = 0;
  if (event.precision === 'exact') quality += 2;
  else if (event.precision && event.precision !== 'tbd') quality += 1;
  if ((game.genres || []).some(genre => significantGenres.has(genre))) quality += 1;
  if (game.developer) quality += 1;
  if (game.publisher) quality += 1;
  if (game.editorial?.has_page || game.editorial?.status === 'published') quality += 3;
  if (game.editorial?.needs_review) quality -= 2;
  if (reasons.length) quality -= 4;

  const homepageEligible = reasons.length === 0 && quality >= config.releases.minimum_homepage_quality;
  game.editorial_quality = {
    homepage_eligible: homepageEligible,
    quality_score: quality,
    reasons,
    checked_at: checkedAt
  };
  releaseAudit.push({
    slug: game.slug,
    title,
    homepage_eligible: homepageEligible,
    quality_score: quality,
    reasons,
    precision: event.precision || 'tbd',
    date: event.date || event.date_start || null,
    source_ids: event.source_ids || []
  });
}

const selectedPopularAudit = popularAudit.filter(item => item.eligible).slice(0, config.popular.minimum_cards);
const selectedReleaseAudit = releaseAudit.filter(item => item.homepage_eligible).slice(0, config.releases.homepage_limit);
const qualitySnapshot = {
  schema_version: 2,
  generated_at: checkedAt,
  gate: {
    status: selectedPopularAudit.length >= config.popular.minimum_cards && selectedReleaseAudit.length > 0 ? 'pass' : 'blocked',
    popular_required: config.popular.minimum_cards,
    popular_eligible: popularSelected.length,
    releases_eligible: releaseAudit.filter(item => item.homepage_eligible).length
  },
  popular: {
    snapshot_generated_at: popular.generated_at,
    stale: now - Date.parse(popular.generated_at) > config.popular.maximum_snapshot_age_hours * 3_600_000,
    selected: selectedPopularAudit.map(item => ({
      slug: item.slug,
      title: item.title,
      tier: item.tier,
      score: item.score,
      confidence: item.confidence,
      families: item.families,
      fresh_independent_families: item.fresh_independent_families,
      steam_position: item.steam_position
    })),
    audit: popularAudit
  },
  releases: {
    snapshot_generated_at: releases.generated_at,
    homepage_limit: config.releases.homepage_limit,
    selected: selectedReleaseAudit,
    audit: releaseAudit
  }
};

// The audit snapshot is always written, including when the publication gate blocks the feed.
write('data/home-feeds-quality.json', qualitySnapshot);

const gateErrors = [];
if (popularSelected.length < config.popular.minimum_cards) {
  gateErrors.push(`Popular editorial gate failed: ${popularSelected.length}/${config.popular.minimum_cards} eligible cards.`);
}
if (selectedReleaseAudit.length === 0) gateErrors.push('Release editorial gate failed: no homepage-eligible releases.');
if (gateErrors.length) throw new Error(gateErrors.join(' '));

popular.ranking = popularSelected.slice(0, Math.max(30, config.popular.minimum_cards));
popular.editorial_quality = {
  checked_at: checkedAt,
  eligible_count: popularSelected.length,
  primary_count: popularAudit.filter(item => item.tier === 'primary').length,
  steam_corroborated_count: popularAudit.filter(item => item.tier === 'steam_corroborated').length,
  rejected_count: popularAudit.filter(item => !item.eligible).length,
  rules: 'primary-multi-signal-or-steam-top-sellers-plus-fresh-independent-signal'
};
write('data/popular/current.json', popular);

releases.editorial_quality = {
  checked_at: checkedAt,
  homepage_eligible_count: releaseAudit.filter(item => item.homepage_eligible).length,
  excluded_count: releaseAudit.filter(item => !item.homepage_eligible).length,
  duplicate_groups: [...seen.entries()].length
};
write('data/releases/current.json', releases);

console.log(JSON.stringify({
  popular_eligible: popularSelected.length,
  popular_primary: popularAudit.filter(item => item.tier === 'primary').length,
  popular_steam_corroborated: popularAudit.filter(item => item.tier === 'steam_corroborated').length,
  releases_homepage_eligible: releaseAudit.filter(item => item.homepage_eligible).length
}, null, 2));
