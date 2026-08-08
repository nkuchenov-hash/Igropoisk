import crypto from 'node:crypto';

const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const NON_GAME_ENTITIES = new Set([
  'xbox','xbox one','xbox series x','xbox series s','xbox game pass','game pass','playstation','playstation 4','playstation 5','ps4','ps5',
  'nintendo','nintendo switch','nintendo switch 2','steam','steam deck','microsoft','microsoft gaming','sony','sony interactive entertainment',
  'epic games','epic games store','valve','ubisoft','electronic arts','ea','activision','blizzard','bethesda','bethesda softworks','id software',
  'bioware','larian','capcom','sega','konami','bandai namco','take two','take-two','thq nordic','halo studios','tarsier studios','rockstar games',
  'warner bros games','ign','pc gamer','gamespot','eurogamer','vgc','polygon','gamesradar','rock paper shotgun','playground','unreal engine',
  'unreal engine 5','unity','summer game fest','the game awards','fanfest','magic'
]);
const GENERIC_SINGLE_WORD = new Set(['control','inside','prey','rust','journey','stray','anthem']);
const ORGANIZATION_SUFFIX = /\b(?:studio|studios|software|interactive|entertainment|publishing|publisher|games|nordic)\b$/i;
const COMPARISON_CUE = /(?:\blike\b|\bvibes?\b|inspired by|inspiration from|authors? of|creators? of|behind\b|compared (?:with|to)|brings?\s+(?:the\s+)?$)/i;
const UPDATE_WORDS = /\b(?:dlc|update|expansion|addition|add-on|season|mode|patch)\b/i;
let modelWarningEmitted = false;

export function normalizeGameContext(value = '') {
  return String(value).normalize('NFKD').replace(/[’‘]/gu, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function urlText(value = '') {
  try {
    const url = new URL(value);
    return normalizeGameContext(decodeURIComponent(`${url.pathname} ${url.search}`));
  } catch { return normalizeGameContext(value); }
}

function exactContains(haystack, needle) { return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `); }
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  const padded = ` ${haystack} `;
  const token = ` ${needle} `;
  let count = 0; let from = 0;
  while ((from = padded.indexOf(token, from)) >= 0) { count += 1; from += token.length; }
  return count;
}
function organizationLike(value = '') {
  const normalized = normalizeGameContext(value);
  return NON_GAME_ENTITIES.has(normalized) || ORGANIZATION_SUFFIX.test(String(value).trim());
}
function contextText(item = {}) {
  return {
    rawTitle: [item.titleEn, item.title, item.titleRu].filter(Boolean).join(' · '),
    title: normalizeGameContext([item.titleEn, item.titleRu, item.title].filter(Boolean).join(' · ')),
    summary: normalizeGameContext([item.summaryEn, item.summaryRu, item.summary].filter(Boolean).join(' · ')),
    url: urlText(item.primaryUrl || item.url || '')
  };
}

function evidenceFor(item, gameTitle) {
  const ctx = contextText(item); const game = normalizeGameContext(gameTitle); const words = game.split(' ').filter(Boolean);
  const titleCount = countOccurrences(ctx.title, game); const summaryCount = countOccurrences(ctx.summary, game); const urlCount = countOccurrences(ctx.url, game);
  return {
    title: titleCount > 0, summary: summaryCount > 0, url: urlCount > 0,
    titleCount, summaryCount, urlCount,
    genericSingle: words.length === 1 && GENERIC_SINGLE_WORD.has(game)
  };
}

function externalGame(title, openCriticId, method, confidence, evidence) {
  const normalized = normalizeGameContext(title);
  const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const stable = crypto.createHash('sha1').update(`news-game:${openCriticId || normalized}`).digest('hex').slice(0, 16);
  return Object.freeze({
    gameId: `news_game_${stable}`, slug: slug || `game-${stable}`, title: String(title).trim(), pageExists: false, pageUrl: '', manual: false,
    matchedBy: method, verifiedExternal: Boolean(openCriticId), externalIds: openCriticId ? Object.freeze({ opencritic: String(openCriticId) }) : Object.freeze({}),
    resolutionConfidence: confidence, resolutionEvidence: Object.freeze(evidence)
  });
}

function groundedCandidate(item, gameTitle, confidence = 0) {
  if (!gameTitle || organizationLike(gameTitle) || /^\d+$/.test(normalizeGameContext(gameTitle))) return null;
  const evidence = evidenceFor(item, gameTitle); const words = normalizeGameContext(gameTitle).split(' ').filter(Boolean);
  if (!words.length || words.length > 10 || !(evidence.title || evidence.summary || evidence.url) || Number(confidence) < 0.78) return null;
  if (evidence.genericSingle && !(evidence.title && (evidence.summary || evidence.url))) return null;
  return evidence;
}

function parseJsonObject(value = '') {
  try { return JSON.parse(String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
}

async function identifyPrimaryGameWithModel(item, { fetchImpl, githubToken, model }) {
  if (!githubToken || typeof fetchImpl !== 'function') return null;
  const article = {
    title_en: item.titleEn || item.title || '', title_ru: item.titleRu || '', summary_en: item.summaryEn || item.summary || '', summary_ru: item.summaryRu || '',
    source_url: item.primaryUrl || item.url || ''
  };
  const prompt = `Identify the ONE primary video game this news article is actually about. Return the base/main game, not an update/DLC/expansion/mode name, studio, publisher, platform, person, quotation, collection, event, or comparison/inspiration game. If the article is industry/platform/business/general news rather than about one specific game, return null. Preserve the most specific supported title including a real subtitle after a colon. Use only supplied fields; never invent. Return ONLY JSON {"game_title":string|null,"relation":"primary_game"|"dlc_or_update"|"industry_or_platform"|"ambiguous","confidence":number}. ARTICLE=${JSON.stringify(article)}`;
  try {
    const response = await fetchImpl(GITHUB_MODELS_ENDPOINT, {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { authorization: `Bearer ${githubToken}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are a precise video-game entity resolver. Output valid JSON only.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0, max_tokens: 180 })
    });
    if (!response.ok) {
      if (!modelWarningEmitted) { modelWarningEmitted = true; console.warn(`[news/game-context-model] GitHub Models unavailable: HTTP ${response.status}`); }
      return null;
    }
    const payload = await response.json(); const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content || '');
    if (!parsed || !['primary_game','dlc_or_update'].includes(parsed.relation)) return null;
    const title = String(parsed.game_title || '').trim(); const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const evidence = groundedCandidate(item, title, confidence); if (!evidence) return null;
    return { title, confidence, evidence, relation: parsed.relation };
  } catch (error) {
    if (!modelWarningEmitted) { modelWarningEmitted = true; console.warn(`[news/game-context-model] GitHub Models request failed: ${error?.message || error}`); }
    return null;
  }
}

function rowsFromOpenCritic(payload) { return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.results) ? payload.results : []; }
function rowTitle(row = {}) { return String(row.name || row.title || row.gameName || '').trim(); }
function rowId(row = {}) { return row.id ?? row._id ?? row.gameId ?? null; }
function titleSimilarity(left, right) {
  const a = normalizeGameContext(left), b = normalizeGameContext(right); if (!a || !b) return 0; if (a === b) return 1;
  const aw = new Set(a.split(' ')), bw = new Set(b.split(' ')); let shared = 0; for (const word of aw) if (bw.has(word)) shared += 1;
  return shared / Math.max(aw.size, bw.size);
}
async function verifyWithOpenCritic(candidate, item, fetchImpl) {
  if (!candidate || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(`https://opencritic.com/api/game/search?criteria=${encodeURIComponent(candidate.title)}`, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 IgropoiskNewsGameResolver/2.0', accept: 'application/json,text/plain,*/*' } });
    if (!response.ok) return null;
    const best = rowsFromOpenCritic(await response.json()).map(row => ({ row, title: rowTitle(row), similarity: titleSimilarity(candidate.title, rowTitle(row)) }))
      .filter(entry => entry.title && entry.similarity >= 0.82).sort((a,b) => b.similarity - a.similarity || b.title.length - a.title.length)[0];
    if (!best) return null;
    return externalGame(best.title, rowId(best.row), 'github-model-opencritic', Math.min(0.99, candidate.confidence + 0.05), groundedCandidate(item, best.title, candidate.confidence) || candidate.evidence);
  } catch { return null; }
}

function cleanCandidate(value = '') { return String(value).replace(/[“”«»"()[\]{}]/g, ' ').replace(/^[\s:;,.!?–—-]+|[\s:;,.!?–—-]+$/g, '').replace(/\s+/g, ' ').trim(); }
const NAME_WORD = "[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*";
const NAME_TAIL = `(?:\\s+(?:${NAME_WORD}|x|of|the|and|to|for|vs\\.?|Part)){0,5}`;
const NAME_RE = new RegExp(`\\b(${NAME_WORD}${NAME_TAIL})`, 'gu');
const COLON_RE = new RegExp(`\\b(${NAME_WORD}${NAME_TAIL}\\s*:\\s*${NAME_WORD}${NAME_TAIL})`, 'gu');

function collectNamed(text, origin) {
  const source = String(text || ''); const result = [];
  for (const match of source.matchAll(COLON_RE)) result.push({ title: cleanCandidate(match[1]), index: match.index || 0, origin, colon: true });
  for (const match of source.matchAll(NAME_RE)) result.push({ title: cleanCandidate(match[1]), index: match.index || 0, origin, colon: false });
  return result;
}
function collectSummaryAnchors(text) {
  const source = String(text || ''); const result = [];
  const patterns = [
    /(?:game|shooter|roguelite|fighter|adventure game|action rpg|horror shooter)\s*(?:called|named|titled)?\s*[,–—:-]?\s*([A-Z0-9][A-Za-z0-9'’.-]*(?:\s+(?:[A-Z0-9][A-Za-z0-9'’.-]*|x|of|the|and|to|for)){0,6})/giu,
    /(?:keep an eye on|working on our first game\s*[–—:-]?|our first game\s*[–—:-]?|called|named|titled)\s+([A-Z0-9][A-Za-z0-9'’.-]*(?:\s+(?:[A-Z0-9][A-Za-z0-9'’.-]*|x|of|the|and|to|for)){0,6})/giu
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) result.push({ title: cleanCandidate(match[1]), index: match.index || 0, origin: 'summary-anchor', anchor: true, colon: String(match[1]).includes(':') });
  const leading = source.match(new RegExp(`^(${NAME_WORD}${NAME_TAIL}(?:\\s*:\\s*${NAME_WORD}${NAME_TAIL})?)`, 'u'));
  if (leading) result.push({ title: cleanCandidate(leading[1]), index: 0, origin: 'summary-leading', leading: true, colon: leading[1].includes(':') });
  return result;
}

function candidateEntries(item = {}) {
  const ctx = contextText(item); const all = [
    ...collectNamed(item.titleEn || item.title || '', 'title'), ...collectNamed(item.titleRu || '', 'title-ru'),
    ...collectSummaryAnchors(item.summaryEn || item.summary || ''), ...collectSummaryAnchors(item.summaryRu || '')
  ];
  const merged = new Map();
  for (const candidate of all) {
    const key = normalizeGameContext(candidate.title);
    if (!key || key.length < 4 || /^\d+$/.test(key) || organizationLike(candidate.title)) continue;
    const previous = merged.get(key) || { title: candidate.title, index: candidate.index, origins: new Set(), colon: false, anchor: false, leading: false };
    previous.origins.add(candidate.origin); previous.colon ||= Boolean(candidate.colon); previous.anchor ||= Boolean(candidate.anchor); previous.leading ||= Boolean(candidate.leading || (candidate.origin === 'title' && candidate.index === 0));
    previous.index = Math.min(previous.index, candidate.index); if (candidate.title.length > previous.title.length) previous.title = candidate.title;
    merged.set(key, previous);
  }
  const entries = [...merged.values()].map(entry => {
    const evidence = evidenceFor(item, entry.title); const titleRaw = String(item.titleEn || item.title || '');
    const before = titleRaw.slice(0, Math.max(0, titleRaw.toLowerCase().indexOf(String(entry.title).toLowerCase())));
    const comparison = COMPARISON_CUE.test(before.slice(-45));
    const afterDashInUpdate = UPDATE_WORDS.test(titleRaw) && /[-–—]\s*$/.test(before.slice(-3));
    let score = evidence.title * 110 + evidence.summary * 65 + evidence.url * 85 + Math.min(60, (evidence.titleCount + evidence.summaryCount + evidence.urlCount) * 12);
    score += entry.colon * 55 + entry.anchor * 75 + entry.leading * 30 + entry.origins.has('summary-leading') * 35;
    score -= comparison * 150 + afterDashInUpdate * 100;
    return { ...entry, evidence, score };
  });
  const filtered = entries.filter(entry => !entries.some(longer => {
    if (longer === entry) return false;
    const a = normalizeGameContext(entry.title), b = normalizeGameContext(longer.title);
    return b.length > a.length && exactContains(b, a) && (longer.colon || longer.anchor || longer.score >= entry.score - 10);
  }));
  return filtered.sort((a,b) => b.score - a.score || a.index - b.index || b.title.length - a.title.length);
}

export function extractNewsGameQueries(item = {}) { return candidateEntries(item).map(entry => entry.title).slice(0, 10); }

function conservativeFallback(item) {
  const ranked = candidateEntries(item).filter(entry => {
    const words = normalizeGameContext(entry.title).split(' ').filter(Boolean);
    if (entry.evidence.genericSingle) return false;
    if (entry.anchor) return entry.evidence.summary && entry.score >= 180;
    if (words.length === 1) return entry.evidence.title && entry.evidence.summary && entry.evidence.url && entry.score >= 250;
    return ((entry.evidence.title && entry.evidence.url) || (entry.evidence.title && entry.evidence.summary)) && entry.score >= 210;
  });
  if (!ranked.length) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 22 && normalizeGameContext(ranked[0].title) !== normalizeGameContext(ranked[1].title)) return null;
  return ranked[0];
}

export async function resolveVerifiedExternalNewsGame(item, { fetchImpl = globalThis.fetch, githubToken = process.env.GITHUB_TOKEN || '', model = process.env.NEWS_GAME_MODEL || 'openai/gpt-4.1' } = {}) {
  if (Array.isArray(item?.games) && item.games.length) return null;
  const semantic = await identifyPrimaryGameWithModel(item, { fetchImpl, githubToken, model });
  if (semantic) return await verifyWithOpenCritic(semantic, item, fetchImpl) || externalGame(semantic.title, null, 'github-model-context', semantic.confidence, semantic.evidence);
  const fallback = conservativeFallback(item); if (!fallback) return null;
  return externalGame(fallback.title, null, 'context-evidence-resolver', Math.min(0.94, 0.78 + fallback.score / 1600), fallback.evidence);
}

export function applyResolvedExternalGame(item, game) {
  if (!game) return item;
  return { ...item, game: game.title, games: [game], gameIds: [game.gameId], primaryGameId: game.gameId, gameReviewStatus: 'resolved', gameReviewReasons: [], gameCandidates: [], gameResolution: { status: 'resolved', method: game.matchedBy, confidence: game.resolutionConfidence, evidence: game.resolutionEvidence } };
}
