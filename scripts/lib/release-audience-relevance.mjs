const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set((values || []).filter(Boolean))];

const STOP_WORDS = new Set([
  'the','a','an','and','or','for','to','of','in','on','with','from','at','by','is','are','was','were','will',
  'game','games','gaming','release','released','launch','launches','launching','series','simulator',
  'игра','игры','игровой','игровая','релиз','релиза','вышла','вышел','выходит','серия','состоялся','глобальный'
]);

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/(\p{L}{2,})[-–—](\p{N})/gu, '$1$2')
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return normalize(value).split(' ').filter(token =>
    token.length >= 2 && !STOP_WORDS.has(token)
  );
}

function gameSlugs(item = {}) {
  return uniq((item.games || []).map(game => typeof game === 'string' ? game : game?.slug));
}

function titleMatch(candidate, item) {
  const candidateSlug = String(candidate?.slug || '').toLowerCase();
  if (candidateSlug && gameSlugs(item).includes(candidateSlug)) return 1;

  const game = normalize(item?.game);
  const candidateTitle = normalize(candidate?.title);
  if (game && (game === candidateTitle || game === normalize(candidateSlug))) return 1;

  const releaseTokens = tokens(candidate?.title);
  if (!releaseTokens.length) return 0;

  let best = 0;
  for (const value of [item?.titleEn, item?.titleRu, item?.title]) {
    const title = normalize(value);
    if (!title) continue;
    if (candidateTitle.length >= 5 && (title.includes(candidateTitle) || candidateTitle.includes(title))) {
      best = Math.max(best, 1);
      continue;
    }
    const articleTokens = new Set(tokens(value));
    const common = releaseTokens.filter(token => articleTokens.has(token)).length;
    const ratio = common / releaseTokens.length;
    if (common >= 2 && ratio >= 0.55) best = Math.max(best, ratio);
  }
  return best;
}

function confirmedEvent(event = {}) {
  const platforms = event.platforms || [];
  return platforms.length > 0
    && platforms.every(platform => (event.platform_confirmations?.[platform] || []).length > 0);
}

function publicShape(candidate, visibility = 'personalized') {
  const events = (candidate.events || []).filter(confirmedEvent).map(clone);
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
    editorial: {
      status: visibility,
      has_page: Boolean(candidate.editorial?.has_page || candidate.page_url)
    },
    significance: candidate.significance,
    audience_affinity: candidate.audience_affinity,
    visibility
  };
  if (candidate.game_id && candidate.game_resolution?.status === 'matched') release.game_id = candidate.game_id;
  return release;
}

export function attachAudienceAffinity(candidates = [], newsEvents = []) {
  const regionalEvents = (newsEvents || []).filter(item =>
    item?.regionalEligible === true
    && Number(item?.regionalScore || 0) > 0
    && Array.isArray(item?.regions)
    && item.regions.length > 0
  );

  return (candidates || []).map(candidate => {
    const regionScores = new Map();
    const evidence = [];

    for (const item of regionalEvents) {
      const match = titleMatch(candidate, item);
      if (match < 0.55) continue;
      const baseScore = Number(item.regionalScore || 0);
      const weighted = Math.round(baseScore * match);
      if (weighted <= 0) continue;

      for (const region of item.regions || []) {
        regionScores.set(region, Math.max(regionScores.get(region) || 0, weighted));
      }
      evidence.push({
        id: item.id || item.primaryUrl || item.url || '',
        match: Number(match.toFixed(3)),
        regional_score: baseScore,
        regions: [...item.regions]
      });
    }

    const regions = Object.fromEntries([...regionScores.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const score = Math.max(0, ...Object.values(regions));
    return {
      ...candidate,
      audience_affinity: {
        score,
        regions,
        evidence_count: evidence.length,
        evidence: evidence.slice(0, 8)
      }
    };
  });
}

export function buildPersonalizedReleases(candidates = [], policy = {}) {
  const minimum = Number(policy.minimum_personalized_region_score || 160);
  const maxPool = Math.max(1, Number(policy.max_personalized_pool || 80));
  const dailyCap = Math.max(1, Number(policy.max_personalized_releases_per_day || 6));

  const ranked = (candidates || []).filter(candidate =>
    candidate.moderation?.status === 'review'
    && !candidate.moderation?.publication_forbidden
    && !candidate.moderation?.rejection_reason
    && Number(candidate.audience_affinity?.score || 0) >= minimum
    && (candidate.events || []).some(confirmedEvent)
  ).sort((a, b) =>
    Number(b.audience_affinity?.score || 0) - Number(a.audience_affinity?.score || 0)
    || Number(b.significance?.score || 0) - Number(a.significance?.score || 0)
    || String(a.title || '').localeCompare(String(b.title || ''), 'en')
  );

  const dateCounts = new Map();
  const selected = [];
  for (const candidate of ranked) {
    const exactDates = uniq((candidate.events || [])
      .filter(event => confirmedEvent(event) && event.precision === 'exact' && event.date)
      .map(event => event.date));
    if (exactDates.some(date => (dateCounts.get(date) || 0) >= dailyCap)) continue;
    selected.push(candidate);
    exactDates.forEach(date => dateCounts.set(date, (dateCounts.get(date) || 0) + 1));
    if (selected.length >= maxPool) break;
  }

  return selected.map(candidate => publicShape(candidate));
}

export function validatePersonalizedReleases({ candidates = [], publicCalendar = {}, policy = {} }) {
  const errors = [];
  const byId = new Map((candidates || []).map(candidate => [candidate.id, candidate]));
  const minimum = Number(policy.minimum_personalized_region_score || 160);
  const globalIds = new Set((publicCalendar.releases || []).map(item => item.id));

  for (const release of publicCalendar.personalized_releases || []) {
    const candidate = byId.get(release.id);
    if (!candidate) {
      errors.push(`Personalized release ${release.id} has no candidate`);
      continue;
    }
    if (globalIds.has(release.id)) errors.push(`Personalized release duplicates global release: ${release.id}`);
    if (candidate.moderation?.status !== 'review') errors.push(`Personalized release is not review-gated: ${release.id}`);
    if (candidate.moderation?.publication_forbidden || candidate.moderation?.rejection_reason) {
      errors.push(`Forbidden personalized release: ${release.id}`);
    }
    if (Number(candidate.audience_affinity?.score || 0) < minimum) {
      errors.push(`Personalized release below audience threshold: ${release.id}`);
    }
    if (!(release.events || []).length || !(release.events || []).every(confirmedEvent)) {
      errors.push(`Personalized release lacks confirmed platform event: ${release.id}`);
    }
  }

  return uniq(errors);
}
