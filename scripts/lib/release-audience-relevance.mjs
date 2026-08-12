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

export function attachAudienceAffinity(candidates = [], newsEvents = [], policy = {}) {
  return (candidates || []).map(candidate => {
    const regionScores = new Map();
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
      for (const region of audience.regions) regionScores.set(region, Math.max(regionScores.get(region) || 0, weighted));
      evidence.push({
        id: item.id || item.primaryUrl || item.url || '',
        match: Number(match.score.toFixed(3)),
        match_basis: match.basis,
        audience_basis: audience.basis,
        regional_score: baseScore,
        regions: audience.regions,
        sources: sourceNames(item).slice(0, 6),
      });
    }
    const regions = Object.fromEntries([...regionScores.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return {
      ...candidate,
      audience_affinity: {
        score: Math.max(0, ...Object.values(regions)),
        regions,
        evidence_count: evidence.length,
        evidence: evidence.slice(0, 8),
        role: 'ranking-bonus-only',
      },
    };
  });
}

export function buildPersonalizedReleases() {
  return [];
}

export function validatePersonalizedReleases({publicCalendar = {}} = {}) {
  return (publicCalendar.personalized_releases || []).length
    ? ['Regional relevance must not add releases that failed the global notability gate']
    : [];
}
