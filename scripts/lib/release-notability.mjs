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
function newsMediaCount(item = {}) {
  const declared = Number(item.mediaSourceCount || item.media_source_count || 0);
  const sources = (item.sources || []).filter(source => {
    if (typeof source === 'string') return true;
    return source && source.official !== true && !['official','platform','publisher','developer'].includes(String(source.kind || '').toLowerCase());
  });
  return Math.max(declared, new Set(sources.map(source => typeof source === 'string' ? source : source.name || source.organization || source.url).filter(Boolean)).size);
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

export function measureGlobalNotability(candidate, {newsEvents = [], popularRanking = [], policy = {}} = {}) {
  const cfg = policy.global_notability || {};
  const news = linkedNews(candidate, newsEvents);
  const popular = linkedPopular(candidate, popularRanking);
  const quality = candidate?.editorial_quality || {};
  const anticipation = candidate?.anticipation || {};
  const anticipationCoverage = Number(quality.independent_source_count || anticipation.independent_publication_count || 0);
  const newsCoverage = Math.max(0, ...news.items.map(newsMediaCount));
  const popularCoverage = Number(popular.item?.news_sources || 0);
  const independentPublications = Math.max(anticipationCoverage, newsCoverage, popularCoverage);
  const historicalFranchisePublications = Number(anticipation.franchise_independent_publication_count || quality.franchise_independent_source_count || 0);
  const globalScore = Math.max(0, ...news.items.map(item => Number(item.globalScore || item.global_score || 0)));
  const trendScore = Math.max(0, ...news.items.map(item => Number(item.trendScore || item.trend_score || 0)));
  const discussionMentions = Math.max(0, ...news.items.map(item => Number(item.discussionMentions || item.discussion_mentions || 0)));
  const globalEligibleEvent = news.items.some(item => item.globalEligible === true || item.global_eligible === true);
  const popularScore = Number(popular.item?.score || anticipation.popular_index || 0);
  const popularConfidence = Number(popular.item?.confidence || anticipation.popular_confidence || 0);
  const popularFamilies = uniq([...(popular.item?.families || []), ...(anticipation.independent_evidence_families || [])]);
  const steamSignals = (candidate?.significance?.signals || []).filter(signal => /^steam_popular_/.test(String(signal)));

  const broadMinimum = Number(cfg.broad_press_minimum || 4);
  const corroboratedMinimum = Number(cfg.corroborated_press_minimum || 3);
  const intenseMinimum = Number(cfg.intense_cross_site_press_minimum || 2);
  const popularStrong = popularScore >= Number(cfg.popular_minimum_score || 10)
    && popularConfidence >= Number(cfg.popular_minimum_confidence || 0.5)
    && popularFamilies.length >= Number(cfg.popular_minimum_families || 2);
  const globalMomentum = globalEligibleEvent && (
    globalScore >= Number(cfg.global_score_minimum || 450)
    || trendScore >= Number(cfg.trend_score_minimum || 450)
    || discussionMentions >= Number(cfg.discussion_minimum || 3)
  );
  const nicheEstablished = historicalFranchisePublications >= Number(cfg.niche_historical_franchise_press_minimum || 4);
  const nicheCurrentCoverage = independentPublications >= Number(cfg.niche_current_press_minimum || 1);
  const nicheCrossSite = popularFamilies.length >= Number(cfg.niche_cross_site_families_minimum || 2) || anticipation.cross_site_coverage === true;
  const nicheEligible = nicheEstablished && (nicheCurrentCoverage || popularStrong) && (nicheCrossSite || nicheCurrentCoverage);

  const broadReasons = [];
  if (independentPublications >= broadMinimum) broadReasons.push('broad-independent-gaming-coverage');
  if (independentPublications >= corroboratedMinimum && (popularStrong || globalMomentum)) broadReasons.push('independent-coverage-plus-global-momentum');
  if (independentPublications >= intenseMinimum && popularStrong && globalMomentum) broadReasons.push('cross-site-popularity-plus-independent-coverage');
  const reasons = [...broadReasons];
  if (nicheEligible) reasons.push('established-franchise-niche-attention');
  const broadEligible = broadReasons.length > 0;
  const eligible = broadEligible || nicheEligible;

  return {
    model: 'release-notability-v3',
    eligible,
    qualification: broadEligible ? 'broad-global' : nicheEligible ? 'niche-global' : 'none',
    reasons,
    linkage: {game_id: candidate?.game_id || null, news: news.mode, popular: popular.mode},
    metrics: {
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
      steam_signals: steamSignals,
    },
    rule: 'A release may qualify through broad global attention or established niche/franchise attention. Steam/store rank, an official announcement or a local page never qualifies by itself. Strong regional audience attention is evaluated separately for personalized admission.'
  };
}

export function applyGlobalNotabilityGate(candidates = [], {newsEvents = [], popularRanking = [], policy = {}} = {}) {
  return (candidates || []).map(source => {
    const candidate = clone(source);
    const notability = measureGlobalNotability(candidate, {newsEvents, popularRanking, policy});
    candidate.global_notability = notability;
    candidate.moderation ||= {};
    candidate.moderation.automatic_reasons = uniq(candidate.moderation.automatic_reasons || []);
    if (candidate.moderation.rejection_reason || candidate.moderation.publication_forbidden || candidate.moderation.status === 'rejected') return candidate;
    const hasConfirmedEvent = (candidate.events || []).some(event => confirmedEvent(event, candidate));
    if (!notability.eligible) {
      candidate.moderation.status = 'review';
      candidate.moderation.automatic_reasons = uniq([...candidate.moderation.automatic_reasons, 'global_or_niche_notability_required']);
      return candidate;
    }
    candidate.moderation.automatic_reasons = candidate.moderation.automatic_reasons.filter(reason => !['global_notability_required','global_or_niche_notability_required'].includes(reason));
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
    const steamOnly = (metrics.steam_signals || []).length && Number(metrics.independent_publications || 0) === 0 && Number(metrics.historical_franchise_publications || 0) === 0;
    if (steamOnly) errors.push(`Steam-only release published: ${release.id}`);
  }
  return uniq(errors);
}
