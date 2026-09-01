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

const storyGenericTokens = new Set([
  'xbox', 'playstation', 'nintendo', 'steam', 'microsoft', 'sony', 'console', 'device', 'family', 'generation',
  'confirm', 'release', 'update', 'studio', 'company', 'game', 'games', 'developer', 'developers'
]);

const storyTokenAliases = new Map([
  ['stolen', 'theft'], ['stole', 'theft'], ['steal', 'theft'], ['thefts', 'theft'],
  ['кража', 'theft'], ['краже', 'theft'], ['кражи', 'theft'], ['украли', 'theft'], ['украдено', 'theft'], ['украдены', 'theft'], ['похищено', 'theft'], ['похищены', 'theft'],
  ['laptop', 'equipment'], ['laptops', 'equipment'], ['device', 'device'], ['devices', 'device'], ['equipment', 'equipment'],
  ['family', 'family'], ['families', 'family'], ['confirm', 'confirm'], ['confirms', 'confirm'], ['confirmed', 'confirm'],
  ['console', 'console'], ['consoles', 'console'], ['generation', 'generation'], ['generations', 'generation'],
  ['crunch', 'crunch'], ['crunches', 'crunch'], ['кранч', 'crunch'], ['кранчи', 'crunch'], ['кранчами', 'crunch'], ['кранчах', 'crunch'], ['кризис', 'crunch'], ['кризисе', 'crunch'],
  ['ноутбук', 'equipment'], ['ноутбуки', 'equipment'], ['ноутбуков', 'equipment'], ['оборудование', 'equipment'], ['оборудования', 'equipment'], ['техника', 'equipment'], ['техники', 'equipment']
]);

function normalizeStoryToken(token = '') {
  const direct = storyTokenAliases.get(token);
  if (direct) return direct;
  if (/^семейн/u.test(token) || /^семейств/u.test(token) || /^(?:семьи|семья)$/u.test(token)) return 'family';
  if (/^устройств/u.test(token)) return 'device';
  if (/^консол/u.test(token)) return 'console';
  if (/^подтверд/u.test(token)) return 'confirm';
  if (/^поколен/u.test(token)) return 'generation';
  return romanNumbers.get(token) || token;
}

function canonical(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeStoryToken)
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

function storyTokens(item = {}, { titleOnly = false } = {}) {
  const text = canonical(titleOnly
    ? (item.titleEn || item.titleRu || item.title || '')
    : [
        item.titleEn || '',
        item.titleRu || '',
        item.title || '',
        item.summaryEn || '',
        item.summaryRu || '',
        item.summary || ''
      ].join(' '));
  return new Set(text.split(' ')
    .filter(token => token.length >= 3 || /^\d+$/.test(token))
    .filter(token => !storyStopWords.has(token))
    .map(normalizeStoryToken));
}

function storyMilestones(item = {}) {
  const raw = [item.titleEn, item.titleRu, item.title, item.summaryEn, item.summaryRu, item.summary]
    .map(value => String(value || ''))
    .join(' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d{1,3})\s*(?:тыс\.?|тысяч\p{L}*)/giu, (_, value) => String(Number(value) * 1000))
    .replace(/(\d{1,3})[\s\u00a0](\d{3})(?!\d)/g, '$1$2');
  return new Set([...raw.matchAll(/(?<!\d)(\d{3,})(?!\d)/g)].map(match => String(Number(match[1]))));
}

function sharesMilestone(left = {}, right = {}) {
  const a = storyMilestones(left);
  const b = storyMilestones(right);
  if (!a.size || !b.size) return false;
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function linkedGameKeys(item = {}) {
  return new Set((Array.isArray(item.games) ? item.games : [])
    .flatMap(game => [game?.slug, game?.gameId])
    .map(value => String(value || '').trim())
    .filter(Boolean));
}

function sharesLinkedGame(left = {}, right = {}) {
  const a = linkedGameKeys(left);
  const b = linkedGameKeys(right);
  if (!a.size || !b.size) return false;
  for (const key of a) if (b.has(key)) return true;
  return false;
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
  const sameGame = sharesLinkedGame(left, right);
  const a = storyTokens(left, { titleOnly: sameGame });
  const b = storyTokens(right, { titleOnly: sameGame });
  if (!a.size || !b.size) return false;
  const shared = [...a].filter(token => b.has(token));
  const common = shared.length;
  const coverage = common / Math.min(a.size, b.size);
  const distinctive = shared.filter(token => token.length >= 4 && !storyGenericTokens.has(token));

  const titleA = storyTokens(left, { titleOnly: true });
  const titleB = storyTokens(right, { titleOnly: true });
  const titleShared = [...titleA].filter(token => titleB.has(token));
  const titleDistinctive = titleShared.filter(token => token.length >= 4 && !storyGenericTokens.has(token));
  if (sharesMilestone(left, right) && titleShared.length >= 2 && titleDistinctive.length >= 1) return true;

  if (sameGame) {
    // Publisher wording can differ heavily for the same event. Four shared headline
    // concepts with at least three distinctive tokens is enough even when one title
    // is much longer, while ordinary same-game updates remain separate.
    return (common >= 4 && coverage >= 0.5 && distinctive.length >= 2)
      || (common >= 4 && distinctive.length >= 3);
  }

  return (common >= 4 && coverage >= 0.35)
    || (common >= 5 && coverage >= 0.2 && distinctive.length >= 2);
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
  const limit = Math.max(1, Number(options.limit ?? 12));
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeHours = Math.max(1, Number(options.maxAgeHours || 168));
  const recentHours = Math.max(1, Number(options.recentHours || 72));
  const minRecent = Math.min(limit, Math.max(0, Number(options.minRecent ?? Math.ceil(limit * 2 / 3))));
  const maxPerTopic = Math.max(1, Number(options.maxPerTopic || 2));
  const maxPerSource = Math.max(1, Number(options.maxPerSource || 3));
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const recentMs = recentHours * 60 * 60 * 1000;
  const seenUrls = new Set();
  const topicCounts = new Map();
  const sourceCounts = new Map();
  const items = [];
  const deferredBySource = [];
  const rejected = {
    expired: 0,
    tooOld: 0,
    duplicateUrl: 0,
    duplicateStory: 0,
    topicCap: 0,
    sourceCap: 0,
    sourceCapDeferred: 0,
    sourceCapFallbackAccepted: 0,
    invalidDate: 0
  };

  const addItem = item => {
    const url = canonicalUrl(item.primaryUrl || item.url || '');
    const topic = newsTopicKey(item);
    const source = sourceKey(item);
    seenUrls.add(url);
    if (topic) topicCounts.set(topic, Number(topicCounts.get(topic) || 0) + 1);
    if (source) sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
    items.push(item);
  };

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
      deferredBySource.push(item);
      rejected.sourceCapDeferred += 1;
      continue;
    }

    addItem(item);
  }

  // Source concentration is a preference for the homepage, never a publication blocker.
  // If strict diversity would leave empty display slots, fill them with otherwise valid
  // stories from the deferred source while preserving URL/story/topic dedupe.
  if (items.length < limit) {
    for (const item of deferredBySource) {
      if (items.length >= limit) break;
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
      addItem(item);
      rejected.sourceCapFallbackAccepted += 1;
    }
  }

  rejected.sourceCap = Math.max(0, rejected.sourceCapDeferred - rejected.sourceCapFallbackAccepted);
  const recentCount = items.filter(item => timestamp(item.publishedAt) >= now - recentMs).length;
  const effectiveMinRecent = Math.min(minRecent, items.length);
  return {
    items,
    // `ok` describes freshness of the selected view, not whether publication is allowed.
    // A feed with fewer than `limit` valid stories is still a valid feed.
    ok: recentCount >= effectiveMinRecent,
    diagnostics: {
      requested: limit,
      selected: items.length,
      targetFilled: items.length === limit,
      recentCount,
      minRecent: effectiveMinRecent,
      configuredMinRecent: minRecent,
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
