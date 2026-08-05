const DAY_MS = 86_400_000;

export const canonicalText = value => String(value || '')
  .normalize('NFKD')
  .replace(/[™®©]/g, ' ')
  .toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const compilePatterns = patterns => (patterns || []).map(pattern => new RegExp(pattern, 'i'));
const evidenceFamilyCount = (item, family) => (item.evidence || []).filter(row => row.family === family).length;
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function popularCanonicalKey(item, rules = {}) {
  let title = canonicalText(item.title || item.slug);
  for (const pattern of compilePatterns(rules.edition_suffix_patterns)) title = title.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  return title.replace(/\s+/g, '') || canonicalText(item.slug).replace(/\s+/g, '');
}

export function evaluatePopularItem(item, rules = {}) {
  const families = [...new Set((item.families || []).filter(Boolean))];
  const weakFamilies = new Set(rules.weak_families || ['steam_chart']);
  const strongFamilies = new Set(rules.single_strong_families || ['news', 'reddit', 'youtube', 'twitch']);
  const communityFamilies = families.filter(family => !weakFamilies.has(family));
  const newsSources = number(item.news_sources);
  const evidenceCount = (item.evidence || []).length;
  const multiFamily = communityFamilies.length >= number(rules.minimum_community_families || 2);
  const independentNews = newsSources >= number(rules.minimum_independent_news_sources || 2);
  const repeatedSingleFamily = communityFamilies.length === 1
    && evidenceFamilyCount(item, communityFamilies[0]) >= number(rules.minimum_single_family_evidence || 2);
  const singleStrongFamily = rules.allow_single_strong_family !== false
    && communityFamilies.length === 1
    && strongFamilies.has(communityFamilies[0])
    && evidenceFamilyCount(item, communityFamilies[0]) >= 1;
  const weakOnly = communityFamilies.length === 0;
  const currentSpike = !weakOnly && (multiFamily || independentNews || repeatedSingleFamily || singleStrongFamily);
  const tier = multiFamily || independentNews || repeatedSingleFamily
    ? 'confirmed'
    : singleStrongFamily ? 'corroborated' : 'rejected';
  const warnings = [];
  if (weakOnly) warnings.push('Только слабый коммерческий сигнал без обсуждения.');
  if (!weakOnly && !currentSpike) warnings.push('Недостаточно свежих подтверждений текущего всплеска.');
  if (singleStrongFamily && tier === 'corroborated') warnings.push('Один сильный свежий сигнал; позиция допускается ниже подтверждённых несколькими источниками.');

  let reason = 'Недостаточно подтверждений.';
  if (multiFamily) reason = `Одновременный всплеск в ${communityFamilies.length} независимых группах сигналов.`;
  else if (independentNews) reason = `Материалы минимум ${newsSources} независимых изданий.`;
  else if (repeatedSingleFamily) reason = `Несколько свежих подтверждений в группе «${communityFamilies[0]}».`;
  else if (singleStrongFamily) reason = `Свежий сильный сигнал в группе «${communityFamilies[0]}»; коммерческий спрос не является единственным основанием.`;
  if (currentSpike && families.includes('steam_chart')) reason += ' Дополнительно подтверждено текущим спросом Steam.';

  return {
    eligible: currentSpike,
    tier,
    canonical_key: popularCanonicalKey(item, rules),
    current_spike: currentSpike,
    evidence_families: families,
    community_families: communityFamilies,
    independent_news_sources: newsSources,
    evidence_count: evidenceCount,
    reason,
    warnings
  };
}

export function filterPopularRanking(ranking, rules = {}) {
  const seen = new Set();
  const accepted = [];
  const rejected = [];
  for (const item of ranking || []) {
    const quality = evaluatePopularItem(item, rules);
    const enriched = { ...item, quality };
    if (!quality.eligible) {
      rejected.push({ slug: item.slug, title: item.title, reason: quality.reason, warnings: quality.warnings });
      continue;
    }
    if (seen.has(quality.canonical_key)) {
      rejected.push({ slug: item.slug, title: item.title, reason: 'Дубликат или другое издание уже выбранной игры.', duplicate_key: quality.canonical_key });
      continue;
    }
    seen.add(quality.canonical_key);
    accepted.push(enriched);
  }
  accepted.sort((left, right) => {
    const tierWeight = { confirmed: 0, corroborated: 1 };
    const tierDelta = (tierWeight[left.quality?.tier] ?? 9) - (tierWeight[right.quality?.tier] ?? 9);
    return tierDelta || number(right.score) - number(left.score) || String(left.title).localeCompare(String(right.title), 'ru');
  });
  return { accepted, rejected };
}

export function releaseCanonicalKey(game, rules = {}) {
  const aliases = rules.aliases || {};
  const slug = aliases[game.slug] || game.slug;
  let title = canonicalText(game.title || slug);
  for (const pattern of compilePatterns(rules.edition_suffix_patterns)) title = title.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  return (aliases[slug] || title).replace(/\s+/g, '') || canonicalText(slug).replace(/\s+/g, '');
}

export function releaseCategory(game, rules = {}, now = Date.now()) {
  const event = (game.events || [])[0] || {};
  const startValue = event.date || event.date_start;
  const endValue = event.date_end || event.date || event.date_start;
  const start = startValue ? Date.parse(`${startValue}T00:00:00Z`) : NaN;
  const end = endValue ? Date.parse(`${endValue}T23:59:59Z`) : NaN;
  const today = new Date(now);
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const recentDays = Math.max(1, number(rules.recent_days || 7));
  const soonDays = Math.max(recentDays, number(rules.soon_days || 120));
  if (!Number.isFinite(start) && !Number.isFinite(end)) return 'tbd';
  if (Number.isFinite(end) && end < todayStart) return end >= todayStart - recentDays * DAY_MS ? 'recent' : 'expired';
  if (Number.isFinite(start) && start <= todayStart + soonDays * DAY_MS) return 'soon';
  return 'upcoming';
}

export function evaluateRelease(game, context = {}, rules = {}, now = Date.now()) {
  const title = String(game.title || '').trim();
  const blockedPattern = compilePatterns(rules.excluded_title_patterns).find(pattern => pattern.test(title));
  const category = releaseCategory(game, rules, now);
  const popularRank = context.popularRanks?.get(game.slug) || null;
  const catalog = context.catalogSlugs?.has(game.slug) || false;
  const editorial = game.editorial || {};
  const event = (game.events || [])[0] || {};
  const sourceCount = (game.sources || []).length;
  const localCover = Boolean(game.image?.local_url);
  const remoteCover = Boolean(game.image?.verified || game.image?.source_url);
  let score = 0;
  const reasons = [];

  if (editorial.status === 'published' || editorial.has_page) { score += 35; reasons.push('есть опубликованная страница'); }
  else if (number(editorial.readiness) >= 70) { score += 25; reasons.push('высокая редакционная готовность'); }
  else if (number(editorial.readiness) >= 50) { score += 10; reasons.push('частичная редакционная готовность'); }
  if (popularRank && popularRank <= 20) { score += 35; reasons.push(`входит в топ-${popularRank} популярного`); }
  else if (popularRank && popularRank <= 30) { score += 20; reasons.push('есть текущий всплеск интереса'); }
  if (catalog) { score += 25; reasons.push('есть в каталоге Игропоиска'); }
  if (sourceCount >= 2) { score += 15; reasons.push('дата подтверждена несколькими источниками'); }
  if (event.precision === 'exact') { score += 10; reasons.push('известна точная дата'); }
  else if (event.precision && event.precision !== 'tbd') { score += 5; reasons.push('известно окно релиза'); }
  if (localCover) { score += 10; reasons.push('проверенная локальная обложка'); }
  else if (remoteCover) { score += 5; reasons.push('проверенная обложка источника'); }
  if (game.developer && game.publisher) score += 5;
  if (category === 'recent' || category === 'soon') score += 10;

  const excluded = Boolean(blockedPattern) || category === 'expired';
  const exclusionReason = blockedPattern
    ? `Служебный или неполный продукт: ${blockedPattern.source}`
    : category === 'expired' ? 'Релиз находится вне окна недавних выпусков.' : null;

  return {
    eligible: !excluded,
    selected: false,
    score,
    category,
    canonical_key: releaseCanonicalKey(game, rules),
    popular_rank: popularRank,
    catalog,
    reason: reasons.length ? reasons.join(', ') : 'Базовая запись официального магазина.',
    exclusion_reason: exclusionReason,
    duplicate_of: null
  };
}

export function selectHomeReleases(releases, context = {}, rules = {}, now = Date.now()) {
  const evaluated = (releases || []).map(game => ({ game, home: evaluateRelease(game, context, rules, now) }));
  const bestByKey = new Map();
  for (const row of evaluated) {
    if (!row.home.eligible) continue;
    const existing = bestByKey.get(row.home.canonical_key);
    if (!existing || row.home.score > existing.home.score) bestByKey.set(row.home.canonical_key, row);
  }
  for (const row of evaluated) {
    const winner = bestByKey.get(row.home.canonical_key);
    if (row.home.eligible && winner && winner !== row) {
      row.home.eligible = false;
      row.home.duplicate_of = winner.game.slug;
      row.home.exclusion_reason = `Дубликат или другое издание ${winner.game.title}.`;
    }
  }

  const dated = evaluated.filter(row => row.home.eligible).sort((left, right) => {
    const categoryWeight = { recent: 0, soon: 1, upcoming: 2, tbd: 3 };
    const categoryDelta = (categoryWeight[left.home.category] ?? 9) - (categoryWeight[right.home.category] ?? 9);
    if (categoryDelta) return categoryDelta;
    if (right.home.score !== left.home.score) return right.home.score - left.home.score;
    const leftDate = (left.game.events || [])[0]?.date || (left.game.events || [])[0]?.date_start || '9999-12-31';
    const rightDate = (right.game.events || [])[0]?.date || (right.game.events || [])[0]?.date_start || '9999-12-31';
    return leftDate.localeCompare(rightDate) || String(left.game.title).localeCompare(String(right.game.title), 'ru');
  });

  const maximum = Math.max(1, number(rules.maximum_home_cards || 12));
  const selected = dated.slice(0, maximum);
  const selectedSlugs = new Set(selected.map(row => row.game.slug));
  for (const row of evaluated) row.home.selected = selectedSlugs.has(row.game.slug);
  return {
    releases: evaluated.map(row => ({ ...row.game, home: row.home })),
    selected: selected.map(row => ({ slug: row.game.slug, title: row.game.title, ...row.home })),
    excluded: evaluated.filter(row => !row.home.eligible).map(row => ({ slug: row.game.slug, title: row.game.title, ...row.home }))
  };
}

export function ageHours(value, now = Date.now()) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 3_600_000) : Infinity;
}
