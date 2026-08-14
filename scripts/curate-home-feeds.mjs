import fs from 'node:fs';
import path from 'node:path';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';
import { evaluateHomeReleaseQuality } from './lib/home-release-quality.mjs';

const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const readOptional = file => {
  try { return read(file); } catch { return null; }
};
const write = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const config = read('config/home-feeds-quality.json');
const popular = read('data/popular/current.json');
const previousPopular = readOptional('data/popular/published.json');
const releases = read('data/releases/current.json');
const now = Date.now();
const checkedAt = new Date(now).toISOString();
const popularRules = config.popular;
const confirmedRules = popularRules.confirmed || {};
const communityRules = popularRules.community_dominant || {};
const platformRules = popularRules.platform_corroborated || {};
const fallbackRules = popularRules.fallback || {};
const maximumCards = Math.max(1, Number(popularRules.maximum_cards || 20));
const freshWindowMs = Number(popularRules.fresh_signal_hours || popular.window_hours || 96) * 3_600_000;
const independentFamilies = new Set(platformRules.independent_families || ['news', 'youtube', 'reddit', 'twitch']);
const liveFamilies = new Set(['youtube', 'reddit', 'twitch']);
const duplicateSuffixPatterns = config.releases.duplicate_suffix_patterns || [];

const unique = values => [...new Set(values.filter(Boolean))];
const evidencePosition = (item, family) => {
  const positions = (item.evidence || [])
    .filter(evidence => evidence.family === family)
    .map(evidence => Number(evidence.position))
    .filter(Number.isFinite);
  return positions.length ? Math.min(...positions) : null;
};
const evidenceIsFresh = evidence => {
  if (!independentFamilies.has(evidence.family)) return false;
  const observedAt = Date.parse(evidence.observed_at || evidence.published_at || evidence.date || '');
  if (Number.isFinite(observedAt)) return observedAt <= now + 300_000 && now - observedAt <= freshWindowMs;
  return liveFamilies.has(evidence.family);
};
const tierOrder = new Map([
  ['confirmed', 0],
  ['community_dominant', 1],
  ['platform_corroborated', 2],
  ['platform_chart', 3],
  ['carryover', 4]
]);

const popularAudit = [];
const eligible = [];
for (const [rankIndex, item] of (popular.ranking || []).entries()) {
  const confidence = Number(item.confidence || 0);
  const score = Number(item.score || 0);
  const freshEvidence = (item.evidence || []).filter(evidenceIsFresh);
  const freshFamilies = new Set(freshEvidence.map(evidence => evidence.family));
  const newsPublishers = unique((item.news_publishers || []).map(value => String(value).trim()).filter(Boolean));
  const newsSources = Math.max(Number(item.news_sources || 0), newsPublishers.length);
  const steamPosition = evidencePosition(item, 'steam_chart');
  const twitchPosition = evidencePosition(item, 'twitch');
  const verifiedCover = Boolean(item.cover_verified && item.image);

  const youtubeEvidence = freshEvidence.filter(evidence => evidence.family === 'youtube');
  const youtubeUrls = new Set(youtubeEvidence.map(evidence => evidence.url).filter(Boolean));
  const youtubeChannels = new Set(youtubeEvidence.map(evidence => evidence.channel_id || evidence.channel).filter(Boolean));
  const youtubeUniqueVideos = Math.max(Number(item.youtube_community?.unique_videos || 0), youtubeUrls.size);
  const youtubeUniqueChannels = Math.max(Number(item.youtube_community?.unique_channels || 0), youtubeChannels.size);
  const youtubeTotalViews = Math.max(
    Number(item.youtube_community?.total_views || 0),
    youtubeEvidence.reduce((sum, evidence) => sum + Number(evidence.views || 0), 0)
  );

  const confirmedByNews = newsSources >= Number(confirmedRules.minimum_news_publishers || 3);
  const confirmedByBreadth = freshFamilies.size >= Number(confirmedRules.minimum_independent_families || 2);
  const confirmed = (
    (confirmedByNews || confirmedByBreadth) &&
    confidence >= Number(confirmedRules.minimum_confidence || 0) &&
    score >= Number(confirmedRules.minimum_score || 0)
  );

  const communityDominant = (
    youtubeUniqueVideos >= Number(communityRules.minimum_unique_videos || 5) &&
    youtubeUniqueChannels >= Number(communityRules.minimum_unique_channels || 3) &&
    youtubeTotalViews >= Number(communityRules.minimum_total_views || 250000) &&
    confidence >= Number(communityRules.minimum_confidence || 0) &&
    score >= Number(communityRules.minimum_score || 0)
  );

  const corroboratingForSteam = new Set([...freshFamilies].filter(family => family !== 'steam_chart'));
  const corroboratingForTwitch = new Set([...freshFamilies].filter(family => family !== 'twitch'));
  const steamCorroborated = Number.isFinite(steamPosition) && (
    (steamPosition <= Number(platformRules.steam_top_with_one_signal || 20) && corroboratingForSteam.size >= 1) ||
    (steamPosition <= Number(platformRules.steam_top_with_two_signals || 50) && corroboratingForSteam.size >= 2)
  );
  const twitchCorroborated = Number.isFinite(twitchPosition) && (
    (twitchPosition <= Number(platformRules.twitch_top_with_one_signal || 25) && corroboratingForTwitch.size >= 1) ||
    (twitchPosition <= Number(platformRules.twitch_top_with_two_signals || 60) && corroboratingForTwitch.size >= 2)
  );
  const platformCorroborated = (
    (steamCorroborated || twitchCorroborated) &&
    confidence >= Number(platformRules.minimum_confidence || 0) &&
    score >= Number(platformRules.minimum_score || 0)
  );
  const currentPlatformChart = Boolean(
    fallbackRules.allow_current_platform_charts &&
    (Number.isFinite(steamPosition) || Number.isFinite(twitchPosition))
  );

  const relevanceTier = confirmed
    ? 'confirmed'
    : communityDominant
      ? 'community_dominant'
      : platformCorroborated
        ? 'platform_corroborated'
        : currentPlatformChart
          ? 'platform_chart'
          : null;
  const presentationReady = Boolean(item.image || (item.image_candidates || []).length);
  const tier = relevanceTier && presentationReady ? relevanceTier : null;
  const selectionReason = relevanceTier === 'confirmed'
    ? confirmedByNews
      ? `Свежие материалы минимум в ${newsSources} независимых изданиях`
      : `Свежие сигналы в нескольких группах: ${[...freshFamilies].join(', ')}`
    : relevanceTier === 'community_dominant'
      ? `${youtubeUniqueVideos} свежих YouTube-видео от ${youtubeUniqueChannels} каналов, ${youtubeTotalViews.toLocaleString('en-US')} просмотров`
      : relevanceTier === 'platform_corroborated'
        ? `${Number.isFinite(steamPosition) ? `Steam Top ${steamPosition}` : `Twitch Top ${twitchPosition}`} + независимое подтверждение`
        : relevanceTier === 'platform_chart'
          ? `${Number.isFinite(steamPosition) ? `Steam Top ${steamPosition}` : `Twitch Top ${twitchPosition}`} сейчас`
          : null;

  const reasons = [];
  if (!verifiedCover) reasons.push('unverified_cover_fallback');
  if (!presentationReady) reasons.push('missing_cover_candidate');
  if (!relevanceTier) {
    if (!confirmedByNews) reasons.push(`news_publishers_below_${Number(confirmedRules.minimum_news_publishers || 3)}`);
    if (!confirmedByBreadth) reasons.push('insufficient_independent_families');
    if (!communityDominant) reasons.push('community_signal_below_threshold');
    if (!Number.isFinite(steamPosition) && !Number.isFinite(twitchPosition)) reasons.push('not_in_current_platform_chart');
    if (confidence < Number(platformRules.minimum_confidence || 0)) reasons.push('low_confidence');
    if (score < Number(platformRules.minimum_score || 0)) reasons.push('low_score');
  } else if (!presentationReady) {
    reasons.push('relevant_but_not_renderable');
  }

  const audited = {
    rank: rankIndex + 1,
    slug: item.slug,
    title: item.title,
    eligible: Boolean(relevanceTier),
    publishable: Boolean(tier),
    tier: relevanceTier,
    reasons: unique(reasons),
    selection_reason: selectionReason,
    score,
    confidence,
    verified_cover: verifiedCover,
    news_publishers: newsSources,
    fresh_independent_families: [...freshFamilies],
    youtube_unique_videos: youtubeUniqueVideos,
    youtube_unique_channels: youtubeUniqueChannels,
    youtube_total_views: youtubeTotalViews,
    steam_position: steamPosition,
    twitch_position: twitchPosition,
    evidence: (item.evidence || []).slice(0, 16).map(evidence => ({
      family: evidence.family,
      source: evidence.source,
      title: evidence.title,
      observed_at: evidence.observed_at || null,
      position: Number.isFinite(Number(evidence.position)) ? Number(evidence.position) : null,
      value: Number.isFinite(Number(evidence.value)) ? Number(evidence.value) : null,
      views: Number.isFinite(Number(evidence.views)) ? Number(evidence.views) : null,
      channel: evidence.channel || null,
      url: evidence.url || null
    }))
  };
  popularAudit.push(audited);
  if (tier) eligible.push({
    ...item,
    editorial_tier: tier,
    editorial_reason: selectionReason,
    editorial_checked_at: checkedAt
  });
}

// Tiers are admission gates. Once admitted, every game is ordered by the same public index.
eligible.sort((left, right) =>
  Number(right.score || 0) - Number(left.score || 0) ||
  Number(right.confidence || 0) - Number(left.confidence || 0) ||
  (tierOrder.get(left.editorial_tier) ?? 99) - (tierOrder.get(right.editorial_tier) ?? 99) ||
  String(left.title).localeCompare(String(right.title), 'ru')
);

const deduplicatedEligible = [];
const eligibleIdentities = new Map();
for (const item of eligible) {
  const identity = normalizeGameIdentity(item.title, duplicateSuffixPatterns);
  const existing = identity ? eligibleIdentities.get(identity) : null;
  if (existing) {
    const audit = popularAudit.find(row => row.slug === item.slug);
    if (audit) {
      audit.publishable = false;
      audit.reasons = unique([...(audit.reasons || []), `duplicate_of:${existing.slug}`]);
    }
    continue;
  }
  if (identity) eligibleIdentities.set(identity, item);
  deduplicatedEligible.push(item);
}

const selected = deduplicatedEligible.slice(0, maximumCards);
if (fallbackRules.enabled && selected.length < maximumCards && previousPopular?.ranking?.length) {
  const previousAgeMs = now - Date.parse(previousPopular.generated_at || '');
  const previousFreshEnough = Number.isFinite(previousAgeMs) && previousAgeMs <= Number(fallbackRules.maximum_previous_age_hours || 24) * 3_600_000;
  if (previousFreshEnough) {
    const selectedSlugs = new Set(selected.map(item => item.slug));
    const selectedIdentities = new Set(selected.map(item => normalizeGameIdentity(item.title, duplicateSuffixPatterns)).filter(Boolean));
    for (const item of previousPopular.ranking) {
      if (selected.length >= maximumCards) break;
      const identity = normalizeGameIdentity(item?.title, duplicateSuffixPatterns);
      if (!item?.slug || selectedSlugs.has(item.slug) || (identity && selectedIdentities.has(identity)) || !item.cover_verified || !item.image) continue;
      selectedSlugs.add(item.slug);
      if (identity) selectedIdentities.add(identity);
      selected.push({
        ...item,
        editorial_tier: 'carryover',
        editorial_reason: 'Сохранено из предыдущего свежего snapshot, пока новые источники обновляются',
        editorial_checked_at: checkedAt
      });
    }
  }
}

const titleKey = title => normalizeGameIdentity(title, duplicateSuffixPatterns);
const excludedPatterns = (config.releases.exclude_title_patterns || []).map(pattern => new RegExp(pattern, 'i'));
const significantGenres = new Set(config.releases.significant_genres || []);
const minimumReleaseQuality = Math.max(1, Number(config.releases.minimum_homepage_quality || 7));
const popularIdentities = new Set(selected.map(item => titleKey(item.title)).filter(Boolean));
const seen = new Map();
const releaseAudit = [];

for (const game of releases.releases || []) {
  const preflightReasons = [];
  const title = String(game.title || '');
  if (excludedPatterns.some(pattern => pattern.test(title))) preflightReasons.push('non_full_release');
  const key = titleKey(title);
  if (seen.has(key)) preflightReasons.push(`duplicate_of:${seen.get(key)}`);
  else if (key) seen.set(key, game.slug);

  const evaluated = evaluateHomeReleaseQuality(game, {
    popularIdentities,
    significantGenres,
    minimumQuality: minimumReleaseQuality,
    minimumIndependentCoverage: Number(config.releases.minimum_independent_coverage || 2),
    maximumSteamWishlistPosition: Number(config.releases.maximum_steam_popular_upcoming_position || 50),
    duplicateSuffixPatterns,
    checkedAt
  });
  const reasons = unique([...preflightReasons, ...(evaluated.reasons || [])]);
  const homepageEligible = evaluated.homepage_eligible && preflightReasons.length === 0;
  game.editorial_quality = {
    ...game.editorial_quality,
    ...evaluated,
    homepage_eligible: homepageEligible,
    reasons,
    checked_at: checkedAt
  };

  const event = (game.events || [])[0] || {};
  releaseAudit.push({
    slug: game.slug,
    title,
    homepage_eligible: homepageEligible,
    quality_score: evaluated.quality_score,
    reasons,
    signals: evaluated.signals,
    source_families: evaluated.source_families,
    independent_source_count: evaluated.independent_source_count,
    precision: event.precision || 'tbd',
    date: event.date || event.date_start || null,
    source_ids: event.source_ids || []
  });
}

const selectedReleaseAudit = releaseAudit
  .filter(item => item.homepage_eligible)
  .sort((left, right) =>
    Number(right.quality_score || 0) - Number(left.quality_score || 0) ||
    String(left.date || '9999').localeCompare(String(right.date || '9999')) ||
    String(left.title).localeCompare(String(right.title), 'ru')
  )
  .slice(0, config.releases.homepage_limit);
const qualitySnapshot = {
  schema_version: 7,
  generated_at: checkedAt,
  status: selected.length >= maximumCards && selectedReleaseAudit.length ? 'complete' : selected.length || selectedReleaseAudit.length ? 'partial' : 'empty',
  popular: {
    requested_cards: maximumCards,
    published_cards: selected.length,
    confirmed_count: selected.filter(item => item.editorial_tier === 'confirmed').length,
    community_dominant_count: selected.filter(item => item.editorial_tier === 'community_dominant').length,
    platform_corroborated_count: selected.filter(item => item.editorial_tier === 'platform_corroborated').length,
    platform_chart_count: selected.filter(item => item.editorial_tier === 'platform_chart').length,
    carryover_count: selected.filter(item => item.editorial_tier === 'carryover').length,
    snapshot_generated_at: popular.generated_at,
    selected: selected.map(item => ({
      slug: item.slug,
      title: item.title,
      tier: item.editorial_tier,
      reason: item.editorial_reason,
      score: item.score,
      confidence: item.confidence
    })),
    audit: popularAudit
  },
  releases: {
    snapshot_generated_at: releases.generated_at,
    homepage_limit: config.releases.homepage_limit,
    minimum_homepage_quality: minimumReleaseQuality,
    selected: selectedReleaseAudit,
    audit: releaseAudit
  }
};
write('data/home-feeds-quality.json', qualitySnapshot);

popular.ranking = selected;
popular.editorial_quality = {
  checked_at: checkedAt,
  requested_cards: maximumCards,
  published_cards: selected.length,
  blocking: false,
  rules: 'eligibility-tiers-as-gates-then-single-index-order-with-canonical-identity-deduplication'
};
write('data/popular/current.json', popular);
write('data/popular/published.json', popular);

releases.editorial_quality = {
  checked_at: checkedAt,
  homepage_eligible_count: releaseAudit.filter(item => item.homepage_eligible).length,
  excluded_count: releaseAudit.filter(item => !item.homepage_eligible).length,
  minimum_homepage_quality: minimumReleaseQuality,
  required_relevance_signals: config.releases.required_relevance_signals || []
};
write('data/releases/current.json', releases);

console.log(JSON.stringify({
  popular_published: selected.length,
  popular_confirmed: selected.filter(item => item.editorial_tier === 'confirmed').length,
  popular_community_dominant: selected.filter(item => item.editorial_tier === 'community_dominant').length,
  popular_platform_corroborated: selected.filter(item => item.editorial_tier === 'platform_corroborated').length,
  popular_platform_chart: selected.filter(item => item.editorial_tier === 'platform_chart').length,
  popular_carryover: selected.filter(item => item.editorial_tier === 'carryover').length,
  releases_homepage_eligible: selectedReleaseAudit.length,
  release_titles: selectedReleaseAudit.map(item => item.title),
  blocking: false
}, null, 2));