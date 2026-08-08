import crypto from 'node:crypto';

const NON_GAME_ENTITIES = new Set([
  'xbox','xbox one','xbox series x','xbox series s','xbox game pass','game pass',
  'playstation','playstation 4','playstation 5','ps4','ps5','nintendo','nintendo switch','nintendo switch 2',
  'steam','steam deck','microsoft','microsoft gaming','sony','sony interactive entertainment',
  'epic games','epic games store','valve','ubisoft','electronic arts','ea','activision','blizzard',
  'bethesda','bethesda softworks','id software','bioware','larian','capcom','sega','konami','bandai namco',
  'take two','take-two','thq nordic','halo studios','tarsier studios','rockstar games','warner bros games',
  'ign','pc gamer','gamespot','eurogamer','vgc','polygon','gamesradar','rock paper shotgun','playground',
  'unreal engine','unreal engine 5','unity','summer game fest','the game awards'
]);
const GENERIC_SINGLE_WORD = new Set(['control','inside','prey','rust','journey','stray','anthem']);
const ORGANIZATION_SUFFIX = /\b(?:studio|studios|software|interactive|entertainment|publishing|publisher|games|nordic)\b$/i;
const GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';

export function normalizeGameContext(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function exactContains(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function organizationLike(value = '') {
  const normalized = normalizeGameContext(value);
  return NON_GAME_ENTITIES.has(normalized) || ORGANIZATION_SUFFIX.test(String(value).trim());
}

function evidenceFor(item, gameTitle) {
  const ctx = contextText(item);
  const game = normalizeGameContext(gameTitle);
  const words = game.split(' ').filter(Boolean);
  const title = exactContains(ctx.title, game);
  const summary = exactContains(ctx.summary, game);
  const url = exactContains(ctx.url, game);
  const genericSingle = words.length === 1 && GENERIC_SINGLE_WORD.has(game);
  const score = Number(title) * 120 + Number(summary) * 60 + Number(url) * 90 + (title && summary ? 25 : 0) + (title && url ? 20 : 0);
  return { title, summary, url, genericSingle, score };
}

function groundedCandidate(item, gameTitle, confidence = 0) {
  if (!gameTitle || organizationLike(gameTitle)) return null;
  const evidence = evidenceFor(item, gameTitle);
  const words = normalizeGameContext(gameTitle).split(' ').filter(Boolean);
  if (!words.length || words.length > 10) return null;
  if (!(evidence.title || evidence.summary || evidence.url)) return null;
  if (evidence.genericSingle && !(evidence.title && (evidence.summary || evidence.url))) return null;
  if (Number(confidence) < 0.78) return null;
  return evidence;
}

function externalGame(title, openCriticId, method, confidence, evidence) {
  const normalized = normalizeGameContext(title);
  const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const stable = crypto.createHash('sha1').update(`news-game:${openCriticId || normalized}`).digest('hex').slice(0, 16);
  return Object.freeze({
    gameId: `news_game_${stable}`,
    slug: slug || `game-${stable}`,
    title: String(title).trim(),
    pageExists: false,
    pageUrl: '',
    manual: false,
    matchedBy: method,
    verifiedExternal: Boolean(openCriticId),
    externalIds: openCriticId ? Object.freeze({ opencritic: String(openCriticId) }) : Object.freeze({}),
    resolutionConfidence: confidence,
    resolutionEvidence: Object.freeze(evidence)
  });
}

function parseJsonObject(value = '') {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { return null; }
}

async function identifyPrimaryGameWithModel(item, { fetchImpl, githubToken, model }) {
  if (!githubToken || typeof fetchImpl !== 'function') return null;
  const article = {
    title_en: item.titleEn || item.title || '',
    title_ru: item.titleRu || '',
    summary_en: item.summaryEn || item.summary || '',
    summary_ru: item.summaryRu || '',
    source_url: item.primaryUrl || item.url || ''
  };
  const prompt = `Determine the ONE primary video game this news article is actually about.\n\nRules:\n- Return the base/main game, not the name of an update, DLC, expansion, mode, event, studio, publisher, platform, person, quotation, or comparison game.\n- If the article is primarily industry/platform/business/general news and not about one specific video game, game_title must be null.\n- If another game is only mentioned as a comparison, inspiration, previous work, or franchise reference, do not choose it.\n- For an article about an expansion/update, identify the base game when the supplied text supports it.\n- Preserve the most specific supported game title (including subtitle after a colon) rather than a shorter fragment.\n- Use only the supplied article fields. Never invent a title.\n\nReturn ONLY JSON: {"game_title":string|null,"relation":"primary_game"|"dlc_or_update"|"industry_or_platform"|"ambiguous","confidence":number}.\nARTICLE=${JSON.stringify(article)}`;
  try {
    const response = await fetchImpl(GITHUB_MODELS_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: {
        authorization: `Bearer ${githubToken}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a precise video-game entity resolver. Output valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 180
      })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content || '');
    if (!parsed || !['primary_game', 'dlc_or_update'].includes(parsed.relation)) return null;
    const title = String(parsed.game_title || '').trim();
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const evidence = groundedCandidate(item, title, confidence);
    if (!evidence) return null;
    return { title, confidence, evidence, relation: parsed.relation };
  } catch {
    return null;
  }
}

function rowsFromOpenCritic(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function rowTitle(row = {}) {
  return String(row.name || row.title || row.gameName || '').trim();
}

function rowId(row = {}) {
  return row.id ?? row._id ?? row.gameId ?? null;
}

function titleSimilarity(left, right) {
  const a = normalizeGameContext(left);
  const b = normalizeGameContext(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aw = new Set(a.split(' ').filter(Boolean));
  const bw = new Set(b.split(' ').filter(Boolean));
  let shared = 0;
  for (const word of aw) if (bw.has(word)) shared += 1;
  return shared / Math.max(aw.size, bw.size);
}

async function verifyWithOpenCritic(candidate, item, fetchImpl) {
  if (!candidate || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(`https://opencritic.com/api/game/search?criteria=${encodeURIComponent(candidate.title)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskNewsGameResolver/2.0', accept: 'application/json,text/plain,*/*' }
    });
    if (!response.ok) return null;
    const rows = rowsFromOpenCritic(await response.json());
    const ranked = rows
      .map(row => ({ row, title: rowTitle(row), similarity: titleSimilarity(candidate.title, rowTitle(row)) }))
      .filter(entry => entry.title && entry.similarity >= 0.82)
      .sort((a, b) => b.similarity - a.similarity || b.title.length - a.title.length);
    const best = ranked[0];
    if (!best) return null;
    const evidence = groundedCandidate(item, best.title, candidate.confidence) || candidate.evidence;
    return externalGame(best.title, rowId(best.row), 'github-model-opencritic', Math.min(0.99, candidate.confidence + 0.05), evidence);
  } catch {
    return null;
  }
}

function cleanCandidate(value = '') {
  return String(value).replace(/[“”«»"()[\]{}]/g, ' ').replace(/^[\s:;,.!?–—-]+|[\s:;,.!?–—-]+$/g, '').replace(/\s+/g, ' ').trim();
}

function titleCandidates(value = '') {
  const text = String(value || '');
  const results = [];
  const colon = /\b([A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*(?:\s+(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*|x|of|the|and|to|for|vs\.?|Part)){0,4}\s*:\s*[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*(?:\s+(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*|x|of|the|and|to|for|vs\.?|Part)){0,4})/gu;
  for (const match of text.matchAll(colon)) results.push(cleanCandidate(match[1]));
  const plain = /\b([A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*(?:\s+(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.-]*|x|of|the|and|to|for|vs\.?|Part)){0,4})/gu;
  for (const match of text.matchAll(plain)) results.push(cleanCandidate(match[1]));
  return results.filter(Boolean);
}

export function extractNewsGameQueries(item = {}) {
  const candidates = [item.titleEn, item.title, item.titleRu].filter(Boolean).flatMap(titleCandidates);
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = normalizeGameContext(candidate);
    if (!key || key.length < 4 || seen.has(key) || organizationLike(candidate)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => normalizeGameContext(b).split(' ').length - normalizeGameContext(a).split(' ').length || b.length - a.length).slice(0, 10);
}

function conservativeFallback(item) {
  const candidates = extractNewsGameQueries(item).map(title => ({ title, evidence: evidenceFor(item, title) }))
    .filter(entry => {
      const words = normalizeGameContext(entry.title).split(' ').filter(Boolean);
      if (words.length === 1) return !entry.evidence.genericSingle && entry.evidence.title && entry.evidence.summary && entry.evidence.url;
      return entry.evidence.title && entry.evidence.summary && entry.evidence.url;
    })
    .sort((a, b) => b.evidence.score - a.evidence.score || b.title.length - a.title.length);
  if (!candidates.length) return null;
  if (candidates[1] && candidates[0].evidence.score === candidates[1].evidence.score && normalizeGameContext(candidates[0].title) !== normalizeGameContext(candidates[1].title)) return null;
  return candidates[0];
}

export async function resolveVerifiedExternalNewsGame(item, {
  fetchImpl = globalThis.fetch,
  githubToken = process.env.GITHUB_TOKEN || '',
  model = process.env.NEWS_GAME_MODEL || 'openai/gpt-4.1'
} = {}) {
  if (Array.isArray(item?.games) && item.games.length) return null;

  const semantic = await identifyPrimaryGameWithModel(item, { fetchImpl, githubToken, model });
  if (semantic) {
    const verified = await verifyWithOpenCritic(semantic, item, fetchImpl);
    if (verified) return verified;
    return externalGame(semantic.title, null, 'github-model-context', semantic.confidence, semantic.evidence);
  }

  const fallback = conservativeFallback(item);
  if (!fallback) return null;
  return externalGame(fallback.title, null, 'context-three-signal-fallback', 0.82, fallback.evidence);
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
