const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set((values || []).filter(Boolean))];

const STOP_WORDS = new Set([
  'the','a','an','and','or','for','to','of','in','on','with','from','at','by','is','are','was','were','will',
  'game','games','gaming','release','released','launch','launches','launching','series','simulator',
  'игра','игры','игровой','игровая','релиз','релиза','вышла','вышел','выходит','серия','состоялся','глобальный'
]);

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/(\p{L}{2,})[-–—](\p{N})/gu, '$1$2').replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(value = '') { return normalize(value).split(' ').filter(token => token.length >= 2 && !STOP_WORDS.has(token)); }
function itemGameIds(item = {}) {
  const raw = [...(item.gameIds || []), ...(item.game_ids || []), ...(item.games || []).map(game => typeof game === 'object' ? (game?.gameId || game?.game_id) : null)];
  return uniq(raw.filter(Boolean).map(String));
}
function titleMatch(candidate, item) {
  const ids = itemGameIds(item);
  if (candidate?.game_id && ids.includes(String(candidate.game_id))) return {score: 1, basis: 'canonical-game-id'};
  if (ids.length) return {score: 0, basis: 'different-canonical-game-id'};
  const candidateTitle = normalize(candidate?.title);
  const releaseTokens = tokens(candidate?.title);
  if (!candidateTitle || !releaseTokens.length) return {score: 0, basis: 'none'};
  let best = 0;
  for (const value of [item?.game, item?.titleEn, item?.titleRu, item?.title]) {
    const title = normalize(value);
    if (!title) continue;
    if (title === candidateTitle || (candidateTitle.length >= 6 && title.includes(candidateTitle))) best = Math.max(best, 1);
    const articleTokens = new Set(tokens(value));
    const common = releaseTokens.filter(token => articleTokens.has(token)).length;
    if (common >= 2) best = Math.max(best, common / releaseTokens.length);
  }
  return {score: best, basis: best >= 0.55 ? 'legacy-title-fallback' : 'none'};
}
function sourceNames(item = {}) {
  return uniq([
    item.primarySource, item.source,
    ...(item.sources || []).flatMap(source => typeof source === 'string' ? [source] : [source?.name, source?.organization]),
  ].map(value => String(value || '').trim()));
}
function configuredRegions(item, policy = {}) {
  const explicit = uniq([...(item.audienceRegions || []), ...(item.audience_regions || [])]);
  if (explicit.length) return {regions: explicit, basis: 'explicit-audience-region'};
  const mapping = policy.audience_source_regions || {};
  const byName = new Map(Object.entries(mapping).map(([name, regions]) => [normalize(name), Array.isArray(regions) ? regions : [regions]]));
  const regions = uniq(sourceNames(item).flatMap(name => byName.get(normalize(name)) || []));
  return {regions, basis: regions.length ? 'source-audience' : 'none'};
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
function regionalQualification(affinity = {}, policy = {}, mediaIntersection = null) {
  const cfg = policy.regional_notability || {};
  const mediaMinimum = Number(cfg.media_intersection_minimum || 3);
  const strongScore = Number(cfg.strong_score_minimum || 220);
  const strongEvents = Number(cfg.strong_event_minimum || 2);
  const strongSources = Number(cfg.strong_source_minimum || 1);
  const corroboratedScore = Number(cfg.corroborated_score_minimum || 170);
  const corroboratedSources = Number(cfg.corroborated_source_minimum || 2);
  const mediaCounts = mediaIntersection?.region_counts || {};
  const regions = uniq([...Object.keys(affinity.regions || {}), ...Object.keys(mediaCounts)]);
  const qualifying = [];
  for (const region of regions) {
    const score = Number(affinity.regions?.[region] || 0);
    const eventCount = Number(affinity.region_event_counts?.[region] || 0);
    const sourceCount = Number(affinity.region_source_counts?.[region] || 0);
    const mediaCount = Number(mediaCounts?.[region] || 0);
    const mediaIntersectionQualified = mediaCount >= mediaMinimum;
    const strongRepeatedAttention = score >= strongScore && eventCount >= strongEvents && sourceCount >= strongSources;
    const independentlyCorroborated = score >= corroboratedScore && sourceCount >= corroboratedSources;
    if (mediaIntersectionQualified || strongRepeatedAttention || independentlyCorroborated) {
      qualifying.push({
        region,
        score,
        event_count: eventCount,
        source_count: Math.max(sourceCount, mediaCount),
        media_intersection_count: mediaCount,
        reason: mediaIntersectionQualified ? 'regional-editorial-media-intersection' : strongRepeatedAttention ? 'strong-repeated-regional-attention' : 'multi-source-regional-attention'
      });
    }
  }
  return {
    eligible: qualifying.length > 0,
    qualifying_regions: qualifying,
    rule: 'Regional admission may be earned by at least the configured number of independent editorial publisher families from that audience region, or by repeated/corroborated regional attention. Developer origin, game origin and language support never qualify a release.'
  };
}
function publicShape(candidate, visibility = 'personalized') {
  const events = (candidate.events || []).filter(event => confirmedEvent(event, candidate)).map(clone);
  const release = {
    id: candidate.id,
    slug: candidate.slug,
    title: candidate.title,
    aliases: candidate.aliases || [],
    release_type: candidate.release_type,
    genres: candidate.genres || [],
    developer: candidate.developer,
    publisher: candidate.publisher,
    external_ids: candidate.external_ids || {},
    image: candidate.image || null,
    page_url: candidate.page_url || null,
    events,
    sources: candidate.sources || [],
    editorial: {status: visibility, has_page: Boolean(candidate.editorial?.has_page || candidate.page_url)},
    significance: candidate.significance,
    global_notability: candidate.global_notability || null,
    media_intersection: candidate.media_intersection || null,
    audience_affinity: candidate.audience_affinity || null,
    regional_notability: candidate.regional_notability || null,
    visibility
  };
  if (candidate.game_id && candidate.game_resolution?.status === 'matched') release.game_id = candidate.game_id;
  return release;
}

export function attachAudienceAffinity(candidates = [], newsEvents = [], policy = {}) {
  return (candidates || []).map(candidate => {
    const regionScores = new Map();
    const regionEvents = new Map();
    const regionSources = new Map();
    const evidence = [];
    for (const item of newsEvents || []) {
      if (item?.regionalEligible !== true || Number(item?.regionalScore || 0) <= 0) continue;
      const audience = configuredRegions(item, policy);
      if (!audience.regions.length) continue;
      const match = titleMatch(candidate, item);
      if (match.score < 0.55) continue;
      const baseScore = Number(item.regionalScore || 0);
      const weighted = Math.round(baseScore * match.score);
      if (weighted <= 0) continue;
      const names = sourceNames(item);
      for (const region of audience.regions) {
        regionScores.set(region, Math.max(regionScores.get(region) || 0, weighted));
        if (!regionEvents.has(region)) regionEvents.set(region, new Set());
        if (!regionSources.has(region)) regionSources.set(region, new Set());
        regionEvents.get(region).add(item.id || item.primaryUrl || item.url || `${region}:${evidence.length}`);
        names.forEach(name => regionSources.get(region).add(name));
      }
      evidence.push({
        id: item.id || item.primaryUrl || item.url || '',
        match: Number(match.score.toFixed(3)),
        match_basis: match.basis,
        audience_basis: audience.basis,
        regional_score: baseScore,
        regions: audience.regions,
        sources: names.slice(0, 6),
      });
    }
    const mediaRegionCounts = candidate.media_intersection?.region_counts || {};
    for (const [region, countValue] of Object.entries(mediaRegionCounts)) {
      const count = Number(countValue || 0);
      if (count <= 0) continue;
      regionScores.set(region, Math.max(regionScores.get(region) || 0, count * 100));
    }
    const regions = Object.fromEntries([...regionScores.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const regionEventCounts = Object.fromEntries([...regionEvents.entries()].map(([region, ids]) => [region, ids.size]));
    const regionSourceCounts = {};
    for (const region of uniq([...Object.keys(regions), ...Object.keys(mediaRegionCounts)])) {
      regionSourceCounts[region] = Math.max(regionSources.get(region)?.size || 0, Number(mediaRegionCounts?.[region] || 0));
    }
    const audienceAffinity = {
      score: Math.max(0, ...Object.values(regions)),
      regions,
      evidence_count: evidence.length,
      evidence: evidence.slice(0, 12),
      region_event_counts: regionEventCounts,
      region_source_counts: regionSourceCounts,
      media_region_counts: mediaRegionCounts,
      role: 'personalized-admission-or-ranking'
    };
    return {...candidate, audience_affinity: audienceAffinity, regional_notability: regionalQualification(audienceAffinity, policy, candidate.media_intersection)};
  });
}

export function buildPersonalizedReleases(candidates = [], policy = {}) {
  const maxPool = Math.max(1, Number(policy.max_personalized_pool || 80));
  const dailyCap = Math.max(1, Number(policy.max_personalized_releases_per_day || 6));
  const ranked = (candidates || []).filter(candidate =>
    candidate.moderation?.status === 'review'
    && !candidate.moderation?.publication_forbidden
    && !candidate.moderation?.rejection_reason
    && candidate.regional_notability?.eligible === true
    && (candidate.events || []).some(event => confirmedEvent(event, candidate))
  ).sort((a, b) =>
    Number(b.audience_affinity?.score || 0) - Number(a.audience_affinity?.score || 0)
    || Number(b.media_intersection?.overall_count || 0) - Number(a.media_intersection?.overall_count || 0)
    || Number(b.global_notability?.metrics?.historical_franchise_publications || 0) - Number(a.global_notability?.metrics?.historical_franchise_publications || 0)
    || String(a.title || '').localeCompare(String(b.title || ''), 'en')
  );
  const dateCounts = new Map();
  const selected = [];
  for (const candidate of ranked) {
    const exactDates = uniq((candidate.events || []).filter(event => confirmedEvent(event, candidate) && event.precision === 'exact' && event.date).map(event => event.date));
    if (exactDates.some(date => (dateCounts.get(date) || 0) >= dailyCap)) continue;
    selected.push(candidate);
    exactDates.forEach(date => dateCounts.set(date, (dateCounts.get(date) || 0) + 1));
    if (selected.length >= maxPool) break;
  }
  return selected.map(candidate => publicShape(candidate));
}

export function validatePersonalizedReleases({candidates = [], publicCalendar = {}} = {}) {
  const errors = [];
  const byId = new Map((candidates || []).map(candidate => [candidate.id, candidate]));
  const globalIds = new Set((publicCalendar.releases || []).map(item => item.id));
  for (const release of publicCalendar.personalized_releases || []) {
    const candidate = byId.get(release.id);
    if (!candidate) { errors.push(`Personalized release ${release.id} has no candidate`); continue; }
    if (globalIds.has(release.id)) errors.push(`Personalized release duplicates global release: ${release.id}`);
    if (candidate.moderation?.status !== 'review') errors.push(`Personalized release is not review-gated: ${release.id}`);
    if (candidate.moderation?.publication_forbidden || candidate.moderation?.rejection_reason) errors.push(`Forbidden personalized release: ${release.id}`);
    if (candidate.regional_notability?.eligible !== true) errors.push(`Personalized release lacks strong measured regional attention: ${release.id}`);
    if (!(release.events || []).length || !(release.events || []).every(event => confirmedEvent(event, candidate))) errors.push(`Personalized release lacks confirmed platform event: ${release.id}`);
  }
  return uniq(errors);
}
