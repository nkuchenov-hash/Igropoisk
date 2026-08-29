const romanNumbers = new Map([
  ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'], ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10']
]);

const storyStopWords = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'at', 'from', 'with', 'and', 'or', 'is', 'are', 'was', 'were',
  'this', 'that', 'it', 'its', 'has', 'have', 'had', 'will', 'could', 'would', 'about', 'after', 'before',
  'news', 'game', 'games', 'gaming', 'dev', 'developer', 'developers', 'reports', 'reported', 'reporting', 'shows', 'show',
  'как', 'что', 'это', 'для', 'или', 'при', 'после', 'перед', 'из', 'на', 'в', 'во', 'по', 'о', 'об', 'и', 'а', 'но',
  'стал', 'стала', 'станет', 'будет', 'могут', 'может', 'новый', 'новая', 'новое', 'новые', 'игра', 'игры', 'разработчик', 'разработчики'
]);

const storyTokenAliases = new Map([
  ['stolen', 'theft'], ['stole', 'theft'], ['steal', 'theft'], ['thefts', 'theft'],
  ['кража', 'theft'], ['краже', 'theft'], ['кражи', 'theft'], ['украли', 'theft'], ['украдено', 'theft'], ['украдены', 'theft'], ['похищено', 'theft'], ['похищены', 'theft'],
  ['laptop', 'equipment'], ['laptops', 'equipment'], ['device', 'equipment'], ['devices', 'equipment'], ['equipment', 'equipment'],
  ['ноутбук', 'equipment'], ['ноутбуки', 'equipment'], ['ноутбуков', 'equipment'], ['оборудование', 'equipment'], ['оборудования', 'equipment'], ['техника', 'equipment'], ['техники', 'equipment']
]);

function canonical(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => romanNumbers.get(token) || token)
    .join(' ');
}

function compact(value = '') {
  return canonical(value).replace(/\s+/g, '');
}

function gameAbbreviation(title = '') {
  const stop = new Set(['the', 'of', 'and', 'a', 'an']);
  const tokens = canonical(title).split(' ').filter(Boolean).filter(token => !stop.has(token));
  if (tokens.length < 2) return '';
  return tokens.map(token => /^\d+$/.test(token) ? token : token[0]).join('');
}

function gameMentionPosition(headline, game = {}) {
  const title = canonical(game.title || '');
  if (!title) return -1;
  const full = headline.indexOf(title);
  const abbreviation = gameAbbreviation(game.title || '');
  const short = abbreviation.length >= 3 ? compact(headline).indexOf(abbreviation) : -1;
  if (full >= 0 && short >= 0) return Math.min(full, short);
  return Math.max(full, short);
}

function storyTokens(item = {}) {
  const headline = canonical(`${item.titleEn || item.titleRu || item.title || ''}`);
  return new Set(headline.split(' ')
    .filter(token => token.length >= 3 || /^\d+$/.test(token))
    .filter(token => !storyStopWords.has(token))
    .map(token => storyTokenAliases.get(token) || token));
}

function storyTopicKey(item = {}) {
  const tokens = [...storyTokens(item)];
  if (!tokens.length) return '';
  return `story:${tokens.slice(0, 6).join('-')}`;
}

export function newsTopicKey(item = {}) {
  const games = Array.isArray(item.games) ? item.games.filter(game => game?.slug || game?.gameId) : [];
  if (!games.length) return storyTopicKey(item);
  const headline = canonical(`${item.titleEn || ''} ${item.titleRu || ''}`);
  const mentioned = games
    .map(game => ({ game, position: gameMentionPosition(headline, game) }))
    .filter(entry => entry.position >= 0)
    .sort((a, b) => a.position - b.position || String(b.game.title || '').length - String(a.game.title || '').length);
  const game = mentioned[0]?.game || (games.length === 1 ? games[0] : null);
  return game ? String(game.slug || game.gameId || '').trim() : storyTopicKey(item);
}

export function isSameNewsStory(left = {}, right = {}) {
  const a = storyTokens(left);
  const b = storyTokens(right);
  if (!a.size || !b.size) return false;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  const coverage = common / Math.min(a.size, b.size);
  return common >= 4 && coverage >= 0.4;
}

function sourceKey(item = {}) {
  const explicit = canonical(item.primarySource || item.source || '');
  if (explicit) return explicit;
  try {
    return new URL(item.primaryUrl || item.url || '').hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return String(value || '').replace(/[?#].*$/, '').trim();
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectCommercialHomeNews(input = [], options = {}) {
  const limit = Math.max(1, Number(options.limit || 12));
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeHours = Math.max(1, Number(options.maxAgeHours || 168));
  const recentHours = Math.max(1, Number(options.recentHours || 72));
  const minRecent = Math.min(limit, Math.max(1, Number(options.minRecent || Math.ceil(limit * 2 / 3))));
  const maxPerTopic = Math.max(1, Number(options.maxPerTopic || 2));
  const maxPerSource = Math.max(1, Number(options.maxPerSource || 3));
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const recentMs = recentHours * 60 * 60 * 1000;
  const seenUrls = new Set();
  const topicCounts = new Map();
  const sourceCounts = new Map();
  const items = [];
  const rejected = { expired: 0, tooOld: 0, duplicateUrl: 0, duplicateStory: 0, topicCap: 0, sourceCap: 0, invalidDate: 0 };

  for (const item of input) {
    if (items.length >= limit) break;
    const published = timestamp(item.publishedAt);
    if (!published) {
      rejected.invalidDate += 1;
      continue;
    }
    if (published < now - maxAgeMs || published > now + 60 * 60 * 1000) {
      rejected.tooOld += 1;
      continue;
    }
    const homeUntil = timestamp(item.homeUntil);
    if (homeUntil && homeUntil < now) {
      rejected.expired += 1;
      continue;
    }

    const url = canonicalUrl(item.primaryUrl || item.url || '');
    if (!url || seenUrls.has(url)) {
      rejected.duplicateUrl += 1;
      continue;
    }
    if (items.some(selected => isSameNewsStory(selected, item))) {
      rejected.duplicateStory += 1;
      continue;
    }

    const topic = newsTopicKey(item);
    if (topic && Number(topicCounts.get(topic) || 0) >= maxPerTopic) {
      rejected.topicCap += 1;
      continue;
    }
    const source = sourceKey(item);
    if (source && Number(sourceCounts.get(source) || 0) >= maxPerSource) {
      rejected.sourceCap += 1;
      continue;
    }

    seenUrls.add(url);
    if (topic) topicCounts.set(topic, Number(topicCounts.get(topic) || 0) + 1);
    if (source) sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
    items.push(item);
  }

  const recentCount = items.filter(item => timestamp(item.publishedAt) >= now - recentMs).length;
  return {
    items,
    ok: items.length === limit && recentCount >= minRecent,
    diagnostics: {
      requested: limit,
      selected: items.length,
      recentCount,
      minRecent,
      recentHours,
      maxAgeHours,
      maxPerTopic,
      maxPerSource,
      uniqueTopics: topicCounts.size,
      uniqueSources: sourceCounts.size,
      rejected
    }
  };
}
