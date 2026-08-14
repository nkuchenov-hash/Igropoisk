import fs from 'node:fs';
import path from 'node:path';
import { buildMediaIntersection } from './release-media-panel.mjs';
import { loadPublicationSourceRegistry, releaseMediaPanelConfig } from './publication-source-registry.mjs';

let defaultMediaSourceConfig = {sources:[]};
try {
  const policy=JSON.parse(fs.readFileSync(path.join(process.cwd(),'config/release-media-sources.json'),'utf8'));
  if(policy.source_registry){
    const registry=loadPublicationSourceRegistry(policy.source_registry);
    defaultMediaSourceConfig=releaseMediaPanelConfig(registry,policy);
  }else defaultMediaSourceConfig=policy;
} catch {}

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set((values || []).filter(Boolean))];

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function itemGameIds(item = {}) {
  const raw = [
    ...(item.gameIds || []),
    ...(item.game_ids || []),
    ...(item.games || []).map(game => typeof game === 'object' ? (game?.gameId || game?.game_id) : null),
  ];
  return uniq(raw.filter(Boolean).map(String));
}
function titleMatches(candidate, item) {
  const wanted = normalize(candidate?.title);
  if (!wanted || wanted.length < 4) return false;
  const explicit = normalize(item?.game);
  if (explicit && explicit === wanted) return true;
  for (const value of [item?.title, item?.titleEn, item?.titleRu]) {
    const title = normalize(value);
    if (title && (title === wanted || title.includes(wanted))) return true;
  }
  return false;
}
function linkedNews(candidate, items = []) {
  const gameId = String(candidate?.game_id || '');
  const canonical = [];
  const fallback = [];
  for (const item of items || []) {
    const ids = itemGameIds(item);
    if (gameId && ids.includes(gameId)) canonical.push(item);
    else if (!ids.length && titleMatches(candidate, item)) fallback.push(item);
  }
  return canonical.length ? {items: canonical, mode: 'canonical-game-id'} : {items: fallback, mode: fallback.length ? 'legacy-title-fallback' : 'none'};
}
function linkedPopular(candidate, ranking = []) {
  const gameId = String(candidate?.game_id || '');
  if (gameId) {
    const exact = (ranking || []).find(item => String(item?.game_id || item?.gameId || '') === gameId);
    if (exact) return {item: exact, mode: 'canonical-game-id'};
  }
  const slug = String(candidate?.slug || '');
  const fallback = (ranking || []).find(item => String(item?.canonical_slug || item?.slug || '') === slug || normalize(item?.title) === normalize(candidate?.title));
  return {item: fallback || null, mode: fallback ? 'canonical-slug-fallback' : 'none'};
}
function newsMediaNames(item = {}) {
  return uniq([
    item.primarySource,
    item.source,
    ...(item.sources || []).flatMap(source => {
      if (typeof source === 'string') return [source];
      if (!source || source.official === true || ['official','platform','publisher','developer','store'].includes(String(source.kind || '').toLowerCase())) return [];
      return [source.name, source.organization];
    }),
  ].map(value => String(value || '').trim()));
}
function confirmedEvent(event = {}, candidate = {}) {
  const platforms = event.platforms || [];
  if (!platforms.length) return false;
  if (platforms.every(platform => (event.platform_confirmations?.[platform] || []).length > 0)) return true;
  if (platforms.length !== 1 || platforms[0] !== 'PC') return false;
  const byId = new Map((candidate.sources || []).map(source => [source.id, source]));
  return (event.source_ids || []).some(sourceId => {
    const source = byId.get(sourceId);
    return String(sourceId || '').startsWith('steam:') || /store\.steampowered\.com/i.test(String(source?.url || ''));
  });
}
function measuredIntersection(candidate, news, popular, mediaSourceConfig = defaultMediaSourceConfig) {
  const anticipation = candidate?.anticipation || {};
  const publisherNames = [
    ...(candidate?.media_intersection?.publishers || []),
    ...(anticipation.independent_publishers || []),
    ...(anticipation.independent_publisher_families || []),
    ...news.items.flatMap(newsMediaNames),
    ...(popular?.item?.news_publishers || []),
  ];
  const measured = buildMediaIntersection({publisherNames, config:mediaSourceConfig});
  return candidate?.media_intersection?.model === 'fixed-editorial-media-panel-v1'
    ? buildMediaIntersection({publisherNames:[...publisherNames, ...(candidate.media_intersection.publishers || [])], evidence:candidate.media_intersection.evidence || [], config:mediaSourceConfig, generatedAt:candidate.media_intersection.generated_at})
    : measured;
}

export function measureGlobalNotability(candidate, {newsEvents = [], popularRanking = [], policy = {}, mediaSourceConfig = defaultMediaSourceConfig} = {}) {
  const cfg = policy.global_notability || {};
  const news = linkedNews(candidate, newsEvents);
  const popular = linkedPopular(candidate, popularRanking);
  const quality = candidate?.editorial_quality || {};
  const anticipation = candidate?.anticipation || {};
  const mediaIntersection = measuredIntersection(candidate, news, popular, mediaSourceConfig);
  const mediaCount = Number(mediaIntersection.overall_count || 0);
  const legacyCoverage = Number(quality.independent_source_count || anticipation.independent_publication_count || 0);
  const independentPublications = mediaCount || legacyCoverage;
  const historicalFranchisePublications = Number(anticipation.franchise_independent_publication_count || quality.franchise_independent_source_count || 0);
  const globalScore = Math.max(0, ...news.items.map(item => Number(item.globalScore || item.global_score || 0)));
  const trendScore = Math.max(0, ...news.items.map(item => Number(item.trendScore || item.trend_score || 0)));
  const discussionMentions = Math.max(0, ...news.items.map(item => Number(item.discussionMentions || item.discussion_mentions || 0)));
  const globalEligibleEvent = news.items.some(item => item.globalEligible === true || item.global_eligible === true);
  const popularScore = Number(popular.item?.score || anticipation.popular_index || 0);
  const popularConfidence = Number(popular.item?.confidence || anticipation.popular_confidence || 0);
  const popularFamilies = uniq([...(popular.item?.families || []), ...(anticipation.independent_evidence_families || [])]);
  const steamSignals = (candidate?.significance?.signals || []).filter(signal => /^steam_popular_/.test(String(signal)));

  const directMinimum = Number(cfg.media_intersection_publish_minimum || 5);
  const corroboratedMinimum = Number(cfg.media_intersection_corroborated_minimum || 3);
  const intenseMinimum = Number(cfg.media_intersection_intense_minimum || 2);
  const popularStrong = popularScore >= Number(cfg.popular_minimum_score || 10)
    && popularConfidence >= Number(cfg.popular_minimum_confidence || 0.5)
    && popularFamilies.length >= Number(cfg.popular_minimum_families || 2);
  const intenseCrossSite = popularScore >= Number(cfg.intense_cross_site_popular_score_minimum || 15)
    && popularConfidence >= Number(cfg.intense_cross_site_popular_confidence_minimum || 0.6)
    && popularFamilies.length >= Number(cfg.intense_cross_site_popular_families_minimum || 3);
  const globalMomentum = globalEligibleEvent && (
    globalScore >= Number(cfg.global_score_minimum || 450)
    || trendScore >= Number(cfg.trend_score_minimum || 450)
    || discussionMentions >= Number(cfg.discussion_minimum || 3)
  );
  const nicheEstablished = historicalFranchisePublications >= Number(cfg.niche_historical_franchise_press_minimum || 4);
  const nicheCurrentCoverage = mediaCount >= Number(cfg.niche_current_press_minimum || 1) || (!mediaCount && independentPublications >= Number(cfg.niche_current_press_minimum || 1));
  const nicheCrossSite = popularFamilies.length >= Number(cfg.niche_cross_site_families_minimum || 2) || anticipation.cross_site_coverage === true;
  const nicheEligible = nicheEstablished && (nicheCurrentCoverage || popularStrong) && (nicheCrossSite || nicheCurrentCoverage);

  const broadReasons = [];
  if (mediaCount >= directMinimum) broadReasons.push('fixed-media-intersection');
  if (mediaCount >= corroboratedMinimum && (popularStrong || globalMomentum)) broadReasons.push('media-intersection-plus-current-momentum');
  if (mediaCount >= intenseMinimum && intenseCrossSite) broadReasons.push('media-intersection-plus-strong-cross-site-attention');
  if (!mediaCount) {
    const legacyBroad = Number(cfg.broad_press_minimum || 4);
    const legacyCorroborated = Number(cfg.corroborated_press_minimum || 3);
    const legacyIntense = Number(cfg.intense_cross_site_press_minimum || 2);
    if (independentPublications >= legacyBroad) broadReasons.push('legacy-broad-independent-coverage');
    if (independentPublications >= legacyCorroborated && (popularStrong || globalMomentum)) broadReasons.push('legacy-coverage-plus-current-momentum');
    if (independentPublications >= legacyIntense && intenseCrossSite) broadReasons.push('legacy-strong-cross-site-attention');
  }
  const reasons = [...broadReasons];
  if (nicheEligible) reasons.push('established-franchise-niche-attention');
  const broadEligible = broadReasons.length > 0;
  const eligible = broadEligible || nicheEligible;

  return {
    model: 'release-notability-v5-media-intersection',
    eligible,
    qualification: broadEligible ? 'broad-global' : nicheEligible ? 'niche-global' : 'none',
    reasons,
    linkage: {game_id: candidate?.game_id || null, news: news.mode, popular: popular.mode},
    media_intersection: mediaIntersection,
    metrics: {
      fixed_media_panel: mediaIntersection.panel_size > 0,
      media_intersection_count: mediaCount,
      media_intersection_publishers: mediaIntersection.publishers || [],
      media_region_counts: mediaIntersection.region_counts || {},
      independent_publications: independentPublications,
      historical_franchise_publications: historicalFranchisePublications,
      franchise_query: anticipation.franchise_query || null,
      global_score: globalScore,
      trend_score: trendScore,
      discussion_mentions: discussionMentions,
      global_eligible_event: globalEligibleEvent,
      popular_score: popularScore,
      popular_confidence: popularConfidence,
      popular_families: popularFamilies,
      intense_cross_site: intenseCrossSite,
      steam_signals: steamSignals,
    },
    rule: 'The primary signal is the uncapped intersection of the Publication Registry editorial panel: each independent publisher family counts once, including RU/CIS outlets. Stores and official sources are excluded. Steam/store rank never qualifies a release by itself. Niche/franchise and strong regional paths remain.'
  };
}

function applyMediaRegionalEvidence(candidate, policy = {}) {
  const mediaCounts = candidate?.media_intersection?.region_counts || {};
  const mediaMinimum = Number(policy?.regional_notability?.media_intersection_minimum || 3);
  const affinity = clone(candidate.audience_affinity || {score:0,regions:{},region_source_counts:{},region_event_counts:{},evidence:[],evidence_count:0,role:'personalized-admission-or-ranking'});
  affinity.regions ||= {};
  affinity.region_source_counts ||= {};
  affinity.media_region_counts = {...(affinity.media_region_counts || {}), ...mediaCounts};
  const mediaQualified = [];
  for (const [region, countValue] of Object.entries(mediaCounts)) {
    const count = Number(countValue || 0);
    if (count <= 0) continue;
    affinity.regions[region] = Math.max(Number(affinity.regions[region] || 0), count * 100);
    affinity.region_source_counts[region] = Math.max(Number(affinity.region_source_counts[region] || 0), count);
    if (count >= mediaMinimum) mediaQualified.push({region,score:affinity.regions[region],event_count:Number(affinity.region_event_counts?.[region] || 0),source_count:affinity.region_source_counts[region],media_intersection_count:count,reason:'regional-editorial-media-intersection'});
  }
  affinity.score = Math.max(Number(affinity.score || 0), ...Object.values(affinity.regions).map(Number));
  candidate.audience_affinity = affinity;
  const regional = clone(candidate.regional_notability || {eligible:false,qualifying_regions:[]});
  const byRegion = new Map((regional.qualifying_regions || []).map(item => [item.region,item]));
  for (const item of mediaQualified) byRegion.set(item.region,item);
  regional.qualifying_regions = [...byRegion.values()];
  regional.eligible = regional.qualifying_regions.length > 0;
  regional.rule = 'Regional admission may come from repeated/corroborated audience evidence or from the configured minimum number of independent editorial publisher families in that region. Origin and language support do not qualify a release.';
  candidate.regional_notability = regional;
  return candidate;
}

export function applyGlobalNotabilityGate(candidates = [], {newsEvents = [], popularRanking = [], policy = {}, mediaSourceConfig = defaultMediaSourceConfig} = {}) {
  return (candidates || []).map(source => {
    const candidate = clone(source);
    const notability = measureGlobalNotability(candidate, {newsEvents, popularRanking, policy, mediaSourceConfig});
    candidate.global_notability = notability;
    candidate.media_intersection = notability.media_intersection;
    applyMediaRegionalEvidence(candidate, policy);
    candidate.moderation ||= {};
    candidate.moderation.automatic_reasons = uniq(candidate.moderation.automatic_reasons || []);
    if (candidate.moderation.rejection_reason || candidate.moderation.publication_forbidden || candidate.moderation.status === 'rejected') return candidate;
    const hasConfirmedEvent = (candidate.events || []).some(event => confirmedEvent(event, candidate));
    if (!notability.eligible) {
      candidate.moderation.status = 'review';
      candidate.moderation.automatic_reasons = uniq([...candidate.moderation.automatic_reasons, 'media_or_niche_notability_required']);
      return candidate;
    }
    candidate.moderation.automatic_reasons = candidate.moderation.automatic_reasons.filter(reason => !['global_notability_required','global_or_niche_notability_required','media_or_niche_notability_required'].includes(reason));
    if (!hasConfirmedEvent) {
      candidate.moderation.status = 'review';
      candidate.moderation.automatic_reasons = uniq([...candidate.moderation.automatic_reasons, 'no_confirmed_platform_event']);
      return candidate;
    }
    if (candidate.moderation.automatic_reasons.includes('daily_cap')) return candidate;
    if (candidate.moderation.manual_decision !== 'review') candidate.moderation.status = 'published';
    return candidate;
  });
}

export function validateGlobalNotability({candidates = [], publicCalendar = {}} = {}) {
  const errors = [];
  const byId = new Map((candidates || []).map(candidate => [candidate.id, candidate]));
  for (const release of publicCalendar.releases || []) {
    const candidate = byId.get(release.id);
    if (!candidate?.global_notability?.eligible) errors.push(`Global/niche notability gate bypassed: ${release.id}`);
    const metrics = candidate?.global_notability?.metrics || {};
    const steamOnly = (metrics.steam_signals || []).length && Number(metrics.media_intersection_count || 0) === 0 && Number(metrics.independent_publications || 0) === 0 && Number(metrics.historical_franchise_publications || 0) === 0;
    if (steamOnly) errors.push(`Steam-only release published: ${release.id}`);
  }
  return uniq(errors);
}
