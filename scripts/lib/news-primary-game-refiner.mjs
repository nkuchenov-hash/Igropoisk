import crypto from 'node:crypto';

const NON_GAME = new Set([
  'xbox','xbox insiders','xbox game pass','game pass','playstation','playstation plus','ps5','ps4','steam','microsoft','sony','nintendo','nintendo switch','nintendo switch 2',
  'thq nordic','halo studios','id software','bioware','capcom','bethesda','take two','take-two','ign','pc gamer','gamespot','eurogamer','polygon','fanfest','fan fest',
  'indie selects','indie select hub','magic'
]);
const ACTION_START = /^(?:how|keep|available|coming|celebrating|indie selects?|magic designer)\b/i;
const COLLECTION_WORD = /\b(?:triptych|collection|franchise|series|insiders?|anniversary|fanfest)\b/i;
const GENERIC_SINGLE = new Set(['control','inside','prey','rust','journey','stray','anthem','magic']);
const COMPARISON_CUE = /(?:\blike\b|\bvibes?\b|inspired by|inspiration from|authors? of|creators? of|behind\b|compared (?:with|to)|brings?\s+(?:the\s+)?)\s*$/i;
const UPDATE_CUE = /\b(?:update|dlc|expansion|addition|add-on|season|mode|patch)\b[^–—-]{0,12}[–—-]?\s*$/i;
const CONNECTORS = '(?:of|the|and|to|for|vs\\.?|x|Part)';
const WORD = "[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*";
const TITLE = `${WORD}(?:\\s+(?:${WORD}|${CONNECTORS})){0,6}(?:\\s*:\\s*${WORD}(?:\\s+(?:${WORD}|${CONNECTORS})){0,5})?`;

export function normalizePrimaryGame(value = '') {
  return String(value).normalize('NFKD').replace(/[’‘]/gu, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function cleanNewsEntitySummary(value = '') {
  return String(value)
    .replace(/\s+(?:The post|Сообщение|Публикация)\b[\s\S]*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function contains(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function cleanCandidate(value = '') {
  return String(value)
    .replace(/[“”«»"()[\]{}]/g, ' ')
    .replace(/[.!?]\s+[A-ZА-ЯЁ][\s\S]*$/u, '')
    .replace(/^[\s:;,.!?–—-]+|[\s:;,.!?–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function invalidCandidate(value = '') {
  const normalized = normalizePrimaryGame(value);
  if (!normalized || normalized.length < 3 || /^\d+$/.test(normalized) || NON_GAME.has(normalized)) return true;
  if (COLLECTION_WORD.test(value)) return true;
  return /\b(?:studio|studios|software|publisher|publishing|entertainment)\b$/i.test(value);
}

function context(item = {}) {
  const summary = [cleanNewsEntitySummary(item.summaryEn || item.summary || ''), cleanNewsEntitySummary(item.summaryRu || '')].filter(Boolean).join(' · ');
  let url = '';
  try {
    const value = item.primaryUrl || item.url || '';
    const parsed = new URL(value);
    url = normalizePrimaryGame(decodeURIComponent(`${parsed.pathname} ${parsed.search}`));
  } catch {
    url = normalizePrimaryGame(item.primaryUrl || item.url || '');
  }
  return {
    title: normalizePrimaryGame([item.titleEn, item.title, item.titleRu].filter(Boolean).join(' · ')),
    summary: normalizePrimaryGame(summary),
    url
  };
}

function evidenceFor(item, value) {
  const ctx = context(item);
  const normalized = normalizePrimaryGame(value);
  return { title: contains(ctx.title, normalized), summary: contains(ctx.summary, normalized), url: contains(ctx.url, normalized) };
}

function makeGame(title, evidence, method = 'primary-game-context-v1') {
  const cleanTitle = cleanCandidate(title);
  const normalized = normalizePrimaryGame(cleanTitle);
  const stable = crypto.createHash('sha1').update(`news-primary:${normalized}`).digest('hex').slice(0, 16);
  return Object.freeze({
    gameId: `news_game_${stable}`,
    slug: normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || `game-${stable}`,
    title: cleanTitle,
    pageExists: false,
    pageUrl: '',
    manual: false,
    matchedBy: method,
    verifiedExternal: false,
    externalIds: Object.freeze({}),
    resolutionConfidence: 0.9,
    resolutionEvidence: Object.freeze(evidence)
  });
}

function addCandidate(map, value, kind, weight, index = 999) {
  const title = cleanCandidate(value);
  if (invalidCandidate(title)) return;
  const normalized = normalizePrimaryGame(title);
  const current = map.get(normalized) || { title, normalized, score: 0, kinds: new Set(), index, strong: false, comparison: false, updateName: false };
  current.score += weight;
  current.kinds.add(kind);
  current.index = Math.min(current.index, index);
  current.strong ||= ['summary-cue', 'title-cue', 'summary-leading'].includes(kind);
  if (title.length > current.title.length) current.title = title;
  map.set(normalized, current);
}

function collectMatches(regex, text, callback) {
  for (const match of String(text || '').matchAll(regex)) callback(match);
}

function detectCandidate(item = {}) {
  const title = String(item.titleEn || item.title || '');
  const titleRu = String(item.titleRu || '');
  const summary = cleanNewsEntitySummary(item.summaryEn || item.summary || '');
  const summaryRu = cleanNewsEntitySummary(item.summaryRu || '');
  const map = new Map();

  const titleCue = new RegExp(`(?:release of|launch of|for|about|in|shooter|simulator|soulslike|fighter|game)\\s+(${TITLE})`, 'gu');
  collectMatches(titleCue, title, match => addCandidate(map, match[1], 'title-cue', 140, match.index || 0));

  const colonTitle = new RegExp(`\\b(${WORD}(?:\\s+(?:${WORD}|${CONNECTORS})){0,4}\\s*:\\s*${WORD}(?:\\s+(?:${WORD}|${CONNECTORS})){0,5})`, 'gu');
  collectMatches(colonTitle, title, match => addCandidate(map, match[1], 'title-colon', 120, match.index || 0));

  const sequence = new RegExp(`\\b(${TITLE})`, 'gu');
  collectMatches(sequence, title, match => addCandidate(map, match[1], 'title-seq', 45, match.index || 0));

  const summaryCues = [
    new RegExp(`(?:game|shooter|simulator|soulslike|fighter|roguelite|action[- ]?rpg|horror shooter)(?:\\s+(?:called|named|titled))?\\s*[,–—:-]?\\s+(${TITLE})`, 'gu'),
    new RegExp(`(?:called|named|titled|keep an eye on|journey in|play as [^,.]{0,30} in|first game\\s*[–—:-][^,.]{0,60}[,–—:-])\\s*(${TITLE})`, 'gu'),
    new RegExp(`(?:game|shooter|simulator|fighter|roguelite)\\s*,\\s*(${TITLE})`, 'gu')
  ];
  for (const regex of summaryCues) collectMatches(regex, summary, match => addCandidate(map, match[1], 'summary-cue', 180, match.index || 0));

  const summaryIn = new RegExp(`\\bin\\s+(${TITLE})`, 'gu');
  collectMatches(summaryIn, summary, match => {
    const candidate = cleanCandidate(match[1]);
    const normalized = normalizePrimaryGame(candidate);
    if (contains(normalizePrimaryGame(title), normalized) || /\b(?:simulator|souls|craft)\b/i.test(candidate)) addCandidate(map, candidate, 'summary-cue', 130, match.index || 0);
  });

  const leading = summary.match(new RegExp(`^(${TITLE})`, 'u'));
  if (leading) addCandidate(map, leading[1], 'summary-leading', 110, 0);

  const ctx = context({ ...item, summaryEn: summary, summaryRu });
  for (const candidate of map.values()) {
    const evidence = {
      title: contains(ctx.title, candidate.normalized) || contains(normalizePrimaryGame(titleRu), candidate.normalized),
      summary: contains(ctx.summary, candidate.normalized),
      url: contains(ctx.url, candidate.normalized)
    };
    candidate.evidence = evidence;
    candidate.score += Number(evidence.title) * 90 + Number(evidence.summary) * 100 + Number(evidence.url) * 60;

    const position = title.toLowerCase().indexOf(candidate.title.toLowerCase());
    const before = position >= 0 ? title.slice(0, position) : '';
    candidate.comparison = position >= 0 && COMPARISON_CUE.test(before.slice(-55));
    candidate.updateName = position >= 0 && UPDATE_CUE.test(before.slice(-45));
    candidate.score -= Number(candidate.comparison) * 500 + Number(candidate.updateName) * 400;
    if (ACTION_START.test(candidate.title)) candidate.score -= candidate.strong ? 130 : 300;
    if (candidate.normalized.split(' ').length === 1 && GENERIC_SINGLE.has(candidate.normalized)) candidate.score -= 300;
  }

  let ranked = [...map.values()];
  ranked = ranked.filter(candidate => !ranked.some(longer => {
    if (longer === candidate || longer.normalized.length <= candidate.normalized.length) return false;
    return contains(longer.normalized, candidate.normalized) && (longer.strong || longer.kinds.has('title-colon') || longer.score >= candidate.score - 25);
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index || b.title.length - a.title.length);

  const best = ranked[0];
  if (!best || best.score < 230 || best.comparison || best.updateName) return null;
  const wordCount = best.normalized.split(' ').filter(Boolean).length;
  if (wordCount === 1 && !best.evidence.url && !best.strong) return null;
  if (!best.evidence.summary && !best.strong) return null;
  if (ranked[1] && best.score - ranked[1].score < 30 && best.normalized !== ranked[1].normalized) return null;
  return best;
}

function existingContextGameIsValid(item, game) {
  if (!game?.title || invalidCandidate(game.title) || ACTION_START.test(game.title)) return false;
  const evidence = evidenceFor(item, game.title);
  const normalized = normalizePrimaryGame(game.title);
  if (normalized.split(' ').length === 1 && GENERIC_SINGLE.has(normalized)) return false;
  return (evidence.summary && (evidence.title || evidence.url)) || (evidence.title && evidence.url);
}

export function refineNewsPrimaryGame(item, proposedGame = null) {
  const proposedIsContext = Boolean(proposedGame) && /(?:context|github-model)/.test(String(proposedGame.matchedBy || ''));
  if (proposedGame && !proposedIsContext) return proposedGame;

  const detected = detectCandidate(item);
  const proposedValid = existingContextGameIsValid(item, proposedGame);
  if (proposedValid) {
    if (detected) {
      const proposedKey = normalizePrimaryGame(proposedGame.title);
      if (detected.normalized !== proposedKey && contains(detected.normalized, proposedKey)) return makeGame(detected.title, detected.evidence);
    }
    return proposedGame;
  }
  if (!detected) return null;
  return makeGame(detected.title, detected.evidence);
}
