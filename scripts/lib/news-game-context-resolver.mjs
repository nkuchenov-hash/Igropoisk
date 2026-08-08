import crypto from 'node:crypto';

const NON_GAME_ENTITIES = new Set([
  'xbox','xbox one','xbox series x','xbox series s','xbox game pass','game pass',
  'playstation','playstation 4','playstation 5','ps4','ps5','nintendo','nintendo switch','nintendo switch 2',
  'steam','steam deck','microsoft','microsoft gaming','sony','sony interactive entertainment',
  'epic games','epic games store','valve','ubisoft','electronic arts','ea','activision','blizzard',
  'bethesda','id software','bioware','larian','capcom','sega','konami','bandai namco','take two','take-two',
  'ign','pc gamer','gamespot','eurogamer','vgc','polygon','gamesradar','rock paper shotgun','playground',
  'unreal engine','unreal engine 5','unity','summer game fest','the game awards'
]);
const GENERIC_SINGLE_WORD = new Set(['control','inside','prey','rust','journey','stray','anthem']);
const LEADING_NOISE = new Set([
  'the','a','an','new','first','after','before','why','how','what','when','where','this','that','these','those',
  'developers','developer','studio','studios','publisher','publishers','microsoft','xbox','playstation','nintendo','sony'
]);
const JOINERS = new Set(['of','the','and','to','for','vs','vs.','part']);

export function normalizeGameContext(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function exactContains(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function urlText(value = '') {
  try {
    const url = new URL(value);
    return normalizeGameContext(decodeURIComponent(`${url.pathname} ${url.search}`));
  } catch {
    return normalizeGameContext(value);
  }
}

function contextText(item = {}) {
  return {
    title: normalizeGameContext([item.titleEn, item.titleRu, item.title].filter(Boolean).join(' · ')),
    summary: normalizeGameContext([item.summaryEn, item.summaryRu, item.summary].filter(Boolean).join(' · ')),
    url: urlText(item.primaryUrl || item.url || '')
  };
}

function cleanCandidate(value = '') {
  return String(value)
    .replace(/[“”«»"()[\]{}]/g, ' ')
    .replace(/^[\s:;,.!?–—-]+|[\s:;,.!?–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function usefulCandidate(value = '') {
  const candidate = cleanCandidate(value);
  const normalized = normalizeGameContext(candidate);
  if (!normalized || normalized.length < 4 || normalized.length > 80) return false;
  if (NON_GAME_ENTITIES.has(normalized)) return false;
  const words = normalized.split(' ').filter(Boolean);
  if (!words.length || words.length > 7) return false;
  if (words.length === 1 && (LEADING_NOISE.has(words[0]) || words[0].length < 4)) return false;
  if (words.length > 1 && words.every(word => LEADING_NOISE.has(word) || JOINERS.has(word))) return false;
  return true;
}

function titleCandidates(value = '') {
  const text = String(value || '');
  const matches = [];
  const rx = /(?:\b(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’:+.-]*|[A-Z0-9]{2,})\b(?:\s+(?:(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’:+.-]*|[A-Z0-9]{2,})|of|the|and|to|for|vs\.?|Part)){0,5})/gu;
  for (const match of text.matchAll(rx)) {
    const value = cleanCandidate(match[0]);
    if (usefulCandidate(value)) matches.push(value);
  }
  return matches;
}

function compactCandidateVariants(value = '') {
  const words = cleanCandidate(value).split(/\s+/).filter(Boolean);
  const variants = [];
  for (let length = Math.min(6, words.length); length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const part = words.slice(start, start + length).join(' ');
      if (usefulCandidate(part)) variants.push(part);
    }
  }
  return variants;
}

export function extractNewsGameQueries(item = {}) {
  const sourceTitles = [item.titleEn, item.title, item.titleRu].filter(Boolean).map(String);
  const candidates = [];
  for (const source of sourceTitles) {
    for (const phrase of titleCandidates(source)) candidates.push(...compactCandidateVariants(phrase));
  }
  const seen = new Set();
  return candidates
    .filter(candidate => {
      const key = normalizeGameContext(candidate);
      if (!key || seen.has(key) || NON_GAME_ENTITIES.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aw = normalizeGameContext(a).split(' ').length;
      const bw = normalizeGameContext(b).split(' ').length;
      return bw - aw || b.length - a.length;
    })
    .slice(0, 8);
}

function evidenceFor(item, gameTitle, query = '') {
  const ctx = contextText(item);
  const game = normalizeGameContext(gameTitle);
  const queryKey = normalizeGameContext(query);
  const words = game.split(' ').filter(Boolean);
  const title = exactContains(ctx.title, game);
  const summary = exactContains(ctx.summary, game);
  const url = exactContains(ctx.url, game);
  const exactQuery = Boolean(queryKey) && queryKey === game;
  const genericSingle = words.length === 1 && GENERIC_SINGLE_WORD.has(game);
  let score = Number(title) * 120 + Number(url) * 90 + Number(summary) * 55 + Number(exactQuery) * 30;
  if (title && summary) score += 25;
  if (title && url) score += 20;
  if (words.length >= 2) score += Math.min(20, words.length * 4);
  if (genericSingle) score -= 100;
  return { title, summary, url, exactQuery, genericSingle, score };
}

function externalGame(title, openCriticId, method, confidence, evidence) {
  const normalized = normalizeGameContext(title);
  const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const stable = crypto.createHash('sha1').update(`opencritic:${openCriticId || normalized}`).digest('hex').slice(0, 16);
  return Object.freeze({
    gameId: `news_game_${stable}`,
    slug: slug || `game-${stable}`,
    title: String(title).trim(),
    pageExists: false,
    pageUrl: '',
    manual: false,
    matchedBy: method,
    verifiedExternal: true,
    externalIds: openCriticId ? Object.freeze({ opencritic: String(openCriticId) }) : Object.freeze({}),
    resolutionConfidence: confidence,
    resolutionEvidence: Object.freeze(evidence)
  });
}

function rowsFromOpenCritic(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchOpenCritic(query, fetchImpl) {
  try {
    const response = await fetchImpl(`https://opencritic.com/api/game/search?criteria=${encodeURIComponent(query)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: {
        'user-agent': 'Mozilla/5.0 IgropoiskNewsGameResolver/1.0',
        accept: 'application/json,text/plain,*/*'
      }
    });
    if (!response.ok) return [];
    return rowsFromOpenCritic(await response.json());
  } catch {
    return [];
  }
}

function rowTitle(row = {}) {
  return String(row.name || row.title || row.gameName || '').trim();
}

function rowId(row = {}) {
  return row.id ?? row._id ?? row.gameId ?? null;
}

function chooseVerifiedOpenCritic(item, attempts = []) {
  const ranked = [];
  for (const attempt of attempts) {
    for (const row of attempt.rows || []) {
      const title = rowTitle(row);
      if (!title) continue;
      const evidence = evidenceFor(item, title, attempt.query);
      const wordCount = normalizeGameContext(title).split(' ').filter(Boolean).length;
      const valid = wordCount === 1
        ? !evidence.genericSingle && (evidence.title || evidence.url) && evidence.score >= 120
        : (evidence.title || evidence.url || (evidence.summary && evidence.exactQuery)) && evidence.score >= 90;
      if (!valid) continue;
      ranked.push({ row, title, evidence, score: evidence.score });
    }
  }
  ranked.sort((a, b) => b.score - a.score || b.title.length - a.title.length);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 15 && normalizeGameContext(ranked[0].title) !== normalizeGameContext(ranked[1].title)) return null;
  return ranked[0];
}

function corroboratedCandidate(item, queries = []) {
  const ranked = queries.map(query => {
    const evidence = evidenceFor(item, query, query);
    const words = normalizeGameContext(query).split(' ').filter(Boolean);
    if (words.length < 2) return null;
    if (!(evidence.title && (evidence.summary || evidence.url))) return null;
    return { title: query, evidence, score: evidence.score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.title.length - a.title.length);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 15 && normalizeGameContext(ranked[0].title) !== normalizeGameContext(ranked[1].title)) return null;
  return ranked[0];
}

export async function resolveVerifiedExternalNewsGame(item, { fetchImpl = globalThis.fetch, maxQueries = 4 } = {}) {
  if (Array.isArray(item?.games) && item.games.length) return null;
  const queries = extractNewsGameQueries(item);
  if (!queries.length) return null;

  const attempts = [];
  if (typeof fetchImpl === 'function') {
    for (const query of queries.slice(0, Math.max(0, maxQueries))) {
      const rows = await fetchOpenCritic(query, fetchImpl);
      attempts.push({ query, rows });
      const verified = chooseVerifiedOpenCritic(item, attempts);
      if (verified && verified.score >= 150) break;
    }
  }

  const verified = chooseVerifiedOpenCritic(item, attempts);
  if (verified) {
    const confidence = Math.min(0.99, 0.78 + Math.min(0.2, verified.score / 700));
    return externalGame(verified.title, rowId(verified.row), 'context-opencritic-verified', confidence, verified.evidence);
  }

  const corroborated = corroboratedCandidate(item, queries);
  if (corroborated) {
    const confidence = Math.min(0.94, 0.74 + Math.min(0.18, corroborated.score / 800));
    return externalGame(corroborated.title, null, 'context-corroborated', confidence, corroborated.evidence);
  }

  return null;
}

export function applyResolvedExternalGame(item, game) {
  if (!game) return item;
  return {
    ...item,
    game: game.title,
    games: [game],
    gameIds: [game.gameId],
    primaryGameId: game.gameId,
    gameReviewStatus: 'resolved',
    gameReviewReasons: [],
    gameCandidates: [],
    gameResolution: {
      status: 'resolved',
      method: game.matchedBy,
      confidence: game.resolutionConfidence,
      evidence: game.resolutionEvidence
    }
  };
}
