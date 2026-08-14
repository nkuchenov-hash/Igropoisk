export const POPULAR_SIGNAL_FAMILIES = ['news', 'reddit', 'youtube', 'twitch', 'steam_chart'];
export const POPULAR_COMMUNITY_FAMILIES = ['news', 'reddit', 'youtube', 'twitch'];
export const POPULAR_WEIGHTS = {
  news: 0.30,
  reddit: 0.15,
  youtube: 0.15,
  twitch: 0.20,
  steam_chart: 0.15,
  breadth: 0.05
};

export const canonicalPopularText = value => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const unique = values => [...new Set(values.filter(Boolean))];
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONTEXT_ONLY_PATTERNS = [
  /(?:from|by) (?:the )?(?:creators?|makers?|developers?|team) (?:behind|of) $/i,
  /(?:former|ex) [a-z0-9 ]{0,24}(?:developer|dev|designer|director|writer|producer)s? (?:from|of) $/i,
  /(?:inspired by|in the style of|similar to|like|compared (?:to|with)|versus|vs|for fans of) $/i,
  /(?:от|из) (?:создателей|разработчиков|авторов|команды) $/i,
  /(?:бывший|бывшая|экс) [а-яёa-z0-9 ]{0,24}(?:разработчик|дизайнер|директор|автор) (?:из|из команды) $/i,
  /(?:вдохновлен|вдохновлена|вдохновлено|в стиле|похож на|похожа на|сравнили с|сравнивают с|для фанатов) $/i
];

const COLLECTION_WORDS = new Set([
  'collection', 'bundle', 'anthology', 'trilogy', 'compilation', 'pack', 'complete',
  'коллекция', 'сборник', 'антология', 'трилогия', 'комплект'
]);

const ROOT_PROSE_LEADS = new Set([
  'is', 'was', 'will', 'has', 'had', 'gets', 'get', 'got', 'receives', 'received',
  'returns', 'return', 'returned', 'launches', 'launched', 'adds', 'added', 'hits', 'hit',
  'sells', 'sold', 'turns', 'turned', 'remains', 'remained', 'could', 'can', 'may', 'might',
  'получила', 'получил', 'получит', 'получает', 'вернулась', 'вернулся', 'вернется',
  'вышла', 'вышел', 'выйдет', 'продалась', 'продался', 'стала', 'стал', 'может', 'будет'
]);

function normalizedAliases(game) {
  return unique([
    game?.title,
    game?.name,
    ...(game?.aliases || [])
  ].map(canonicalPopularText)).sort((a, b) => b.length - a.length);
}

function contextOnlyMention(text, alias) {
  const normalized = canonicalPopularText(text);
  const index = normalized.indexOf(alias);
  if (index < 0) return false;
  const prefix = normalized.slice(Math.max(0, index - 90), index).trim();
  return CONTEXT_ONLY_PATTERNS.some(pattern => pattern.test(`${prefix} `));
}

function collectionLike(text) {
  const tokens = canonicalPopularText(text).split(' ').filter(Boolean);
  return tokens.some(token => COLLECTION_WORDS.has(token));
}

function rootLooksLikeUnknownSpecificTitle(text, alias) {
  const normalized = canonicalPopularText(text);
  if (normalized === alias) return false;
  const index = normalized.indexOf(alias);
  if (index !== 0) return true;
  const remainder = normalized.slice(alias.length).trim();
  if (!remainder) return false;
  const [next] = remainder.split(' ');
  return !ROOT_PROSE_LEADS.has(next);
}

/**
 * Resolve a free-text signal to one canonical game candidate.
 *
 * The resolver is intentionally conservative. Ambiguous franchise-root mentions,
 * collections, comparisons and context-only references are rejected instead of
 * being credited to an arbitrary individual game.
 */
export function createPopularEntityResolver(games, config = {}) {
  const prepared = (games || []).filter(Boolean).map(game => ({
    game,
    aliases: normalizedAliases(game)
  }));
  const bySlug = new Map(prepared.map(entry => [entry.game.slug, entry.game]));
  const aliasOwners = new Map();
  for (const entry of prepared) {
    for (const alias of entry.aliases) {
      const owners = aliasOwners.get(alias) || [];
      owners.push(entry.game);
      aliasOwners.set(alias, owners);
    }
  }

  const ambiguousRoots = new Set();
  for (const [alias, owners] of aliasOwners) {
    if (owners.length !== 1 || alias.split(' ').length !== 1) continue;
    const prefix = `${alias} `;
    const hasSpecificSibling = prepared.some(entry =>
      entry.game.slug !== owners[0].slug && entry.aliases.some(other => other.startsWith(prefix))
    );
    if (hasSpecificSibling) ambiguousRoots.add(alias);
  }

  const disambiguation = (config.disambiguation || []).map(rule => ({
    ...rule,
    aliases: (rule.prefer_aliases || []).map(canonicalPopularText).filter(Boolean)
  }));

  function resolve(text, { mode = 'editorial' } = {}) {
    const normalized = canonicalPopularText(text);
    if (!normalized) return null;
    const padded = ` ${normalized} `;

    for (const rule of disambiguation) {
      const matchedAlias = rule.aliases.find(alias => padded.includes(` ${alias} `));
      if (!matchedAlias) continue;
      if (mode !== 'platform' && contextOnlyMention(normalized, matchedAlias)) continue;
      const preferred = bySlug.get(rule.prefer_slug);
      if (preferred) return preferred;
    }

    const matches = [];
    for (const entry of prepared) {
      for (const alias of entry.aliases) {
        if (!alias) continue;
        if (!padded.includes(` ${alias} `)) continue;
        matches.push({ game: entry.game, alias });
      }
    }
    if (!matches.length) return null;

    matches.sort((a, b) => b.alias.length - a.alias.length);
    const specificMatches = matches.filter(match => !matches.some(other =>
      other.game.slug !== match.game.slug &&
      other.alias.length > match.alias.length &&
      (` ${other.alias} `).includes(` ${match.alias} `)
    ));

    const bestByGame = new Map();
    for (const match of specificMatches) {
      const existing = bestByGame.get(match.game.slug);
      if (!existing || match.alias.length > existing.alias.length) bestByGame.set(match.game.slug, match);
    }
    const candidates = [...bestByGame.values()];
    if (candidates.length !== 1) return null;

    const candidate = candidates[0];
    if (mode !== 'platform' && contextOnlyMention(normalized, candidate.alias)) return null;

    if (ambiguousRoots.has(candidate.alias)) {
      if (collectionLike(normalized)) return null;
      if (rootLooksLikeUnknownSpecificTitle(normalized, candidate.alias)) return null;
    }

    return candidate.game;
  }

  return {
    resolve,
    ambiguousRoots: new Set(ambiguousRoots)
  };
}

export function popularityMaxima(items) {
  const maxima = {};
  for (const family of POPULAR_SIGNAL_FAMILIES) {
    maxima[family] = Math.max(
      ...(items || []).map(item => Number((item?.signals || item?.families || {})[family] || 0)),
      1
    );
  }
  return maxima;
}

export function calculatePopularityIndex({ signals = {}, maxima = {}, newsSources = 0 }) {
  const normalized = {};
  for (const family of POPULAR_SIGNAL_FAMILIES) {
    normalized[family] = Number(signals[family] || 0) / Math.max(1, Number(maxima[family] || 1));
  }
  const activeFamilies = POPULAR_SIGNAL_FAMILIES.filter(family => normalized[family] > 0.01);
  const activeCommunityFamilies = POPULAR_COMMUNITY_FAMILIES.filter(family => normalized[family] > 0.02);
  const breadth = Math.min(1, (Number(newsSources || 0) + activeCommunityFamilies.length) / 8);
  const score = 100 * (
    POPULAR_WEIGHTS.news * normalized.news +
    POPULAR_WEIGHTS.reddit * normalized.reddit +
    POPULAR_WEIGHTS.youtube * normalized.youtube +
    POPULAR_WEIGHTS.twitch * normalized.twitch +
    POPULAR_WEIGHTS.steam_chart * normalized.steam_chart +
    POPULAR_WEIGHTS.breadth * breadth
  );
  return {
    score: Number(score.toFixed(1)),
    normalized,
    activeFamilies,
    activeCommunityFamilies
  };
}

export function recomputePopularityIndices(items) {
  const maxima = popularityMaxima(items);
  return (items || []).map(item => {
    const calculation = calculatePopularityIndex({
      signals: item.signals || {},
      maxima,
      newsSources: item.news_sources || (item.news_publishers || []).length
    });
    return {
      ...item,
      score: calculation.score,
      families: calculation.activeFamilies
    };
  });
}
