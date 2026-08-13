#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCanonicalNewsCatalog } from './lib/news-game-registry-adapter.mjs';

const root = process.cwd();
const eventsPath = path.join(root, 'data/news-events.json');
const reportPath = path.join(root, 'tmp/news-game-identity-verification.json');
const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
const model = String(process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5').trim();
const batchSize = Math.max(1, Math.min(10, Number(process.env.NEWS_GAME_VERIFY_BATCH || 8)));
if (!apiKey) throw new Error('OPENAI_API_KEY is required for canonical news game identity verification.');

const NON_GAME_TITLES = new Set([
  'twitch', 'dreamworks', 'aoc', 'steam', 'xbox', 'playstation', 'nintendo', 'epic games', 'valve', 'ubisoft',
  'electronic arts', 'ea', 'activision', 'blizzard', 'bethesda', 'capcom', 'sega', 'konami', 'bandai namco',
  'ign', 'pc gamer', 'eurogamer', 'gamespot', 'polygon', 'rock paper shotgun', 'playground'
]);
const NON_GAME_SUFFIX = /\b(?:studio|studios|software|interactive|entertainment|publisher|publishing|games|company|corporation|inc|llc|ltd)\b$/i;
const GENERIC_EDITION = /^(?:complete|deluxe|ultimate|gold|standard|legacy|collector'?s?)\s+edition$/i;

function normalize(value = '') {
  return String(value).normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[’‘]/gu, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function slugify(value = '') {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
function stableTempId(title) {
  return `news_game_${crypto.createHash('sha1').update(`verified-news-game:${normalize(title)}`).digest('hex').slice(0, 16)}`;
}
function uniqueDomains(evidence = []) {
  const domains = new Set();
  for (const source of evidence) {
    try { domains.add(new URL(source.url).hostname.replace(/^www\./, '').toLowerCase()); } catch {}
  }
  return domains;
}
function evidenceIsStrong(game = {}) {
  const evidence = Array.isArray(game.evidence) ? game.evidence.filter(item => item && /^https?:\/\//i.test(String(item.url || ''))) : [];
  if (evidence.length < 2 || uniqueDomains(evidence).size < 2) return false;
  if (!evidence.some(item => ['official', 'store', 'database'].includes(item.type))) return false;
  return Number(game.confidence || 0) >= 0.9;
}
function titleLooksLikeGame(title = '') {
  const value = String(title || '').trim();
  const key = normalize(value);
  if (!key || NON_GAME_TITLES.has(key) || NON_GAME_SUFFIX.test(value) || GENERIC_EDITION.test(value) || /^\d+$/.test(key)) return false;
  return true;
}
function text(item, keys) {
  for (const key of keys) if (String(item?.[key] || '').trim()) return String(item[key]).trim();
  return '';
}
function compactArticle(item) {
  return {
    news_id: String(item.id || ''),
    title: text(item, ['titleEn', 'titleRu', 'title']),
    summary: text(item, ['summaryEn', 'summaryRu', 'summary']),
    source_url: String(item.primaryUrl || item.url || ''),
    current_game_hints: (Array.isArray(item.games) ? item.games : []).map(game => ({
      title: game?.title || '', slug: game?.slug || '', game_id: game?.gameId || game?.game_id || ''
    })).filter(game => game.title || game.slug)
  };
}

const evidenceItemSchema = {
  type: 'object', additionalProperties: false, required: ['type', 'url'],
  properties: {
    type: { type: 'string', enum: ['official', 'store', 'database', 'editorial'] },
    url: { type: 'string' }
  }
};
const gameSchema = {
  type: 'object', additionalProperties: false,
  required: ['canonical_title', 'confidence', 'evidence'],
  properties: {
    canonical_title: { type: 'string' },
    confidence: { type: 'number' },
    evidence: { type: 'array', items: evidenceItemSchema }
  }
};
const resultSchema = {
  type: 'object', additionalProperties: false,
  required: ['articles'],
  properties: {
    articles: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['news_id', 'classification', 'games', 'reason'],
        properties: {
          news_id: { type: 'string' },
          classification: { type: 'string', enum: ['specific_game', 'non_game', 'ambiguous'] },
          games: { type: 'array', items: gameSchema },
          reason: { type: 'string' }
        }
      }
    }
  }
};

async function callVerifier(articles, { deep = false } = {}) {
  const prompt = `You are the final identity gate for game hashtags on a public gaming-news site. Use active web search.\n\nFor EACH supplied news article, determine whether the ARTICLE ITSELF is about one or more specific video games. A visible hashtag is a canonical game identifier and will trigger creation of a public game page, so false positives are unacceptable.\n\nRules:\n- Return specific_game only for actual video-game titles that are a primary subject of the article.\n- NEVER return a person, studio, publisher, platform, hardware maker, website/service, event, magazine, franchise name by itself, quotation, genre, hardware product, or generic phrase such as Complete Edition.\n- If a headline says a creator/studio/company did something but no named game is actually the primary subject, return non_game or ambiguous.\n- If an edition/update/DLC is discussed, return the canonical base game unless it is a genuinely standalone game.\n- If a franchise plus a specific installment is present, return the exact installment, not a truncated franchise (example: not "Warhammer 40" when the article is about "Warhammer 40,000: Dawn of War IV").\n- Do not trust current_game_hints; they are included specifically because some are wrong.\n- Verify every returned canonical title with at least TWO independent direct sources on different domains. At least one must be official, a store, or a recognized game database. Search-result pages are not evidence URLs.\n- Preserve official punctuation/subtitles in canonical_title.\n- An article may have multiple games only if those games are genuinely primary subjects, not comparisons or incidental mentions.\n- If evidence is insufficient, classification must be ambiguous and games must be empty.\n${deep ? '- This is a second-pass review of a difficult case: search more broadly and resolve the exact game or explicitly reject it.\n' : ''}\nReturn only the requested JSON schema.\n\nARTICLES=${JSON.stringify(articles)}`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search', search_context_size: deep ? 'high' : 'medium' }],
      tool_choice: 'required',
      input: prompt,
      text: { format: { type: 'json_schema', name: 'news_game_identity_verification', strict: true, schema: resultSchema } }
    }),
    signal: AbortSignal.timeout(deep ? 120000 : 90000)
  });
  if (!response.ok) throw new Error(`OpenAI identity verifier ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const output = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!output) throw new Error('OpenAI identity verifier returned no structured output.');
  return JSON.parse(output).articles || [];
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
const catalog = await loadCanonicalNewsCatalog({ root });
const exact = new Map();
for (const game of catalog.games) {
  const keys = [game.title, game.slug, ...(game.aliases || []), ...(game.abbreviations || [])].map(normalize).filter(Boolean);
  for (const key of keys) {
    const values = exact.get(key) || [];
    values.push(game);
    exact.set(key, values);
  }
}
function findCanonical(title) {
  const matches = exact.get(normalize(title)) || [];
  if (matches.length === 1) return matches[0];
  return null;
}
function materializeVerifiedGame(game) {
  const canonical = findCanonical(game.canonical_title);
  const evidence = [...new Map((game.evidence || []).map(item => [String(item.url || ''), { type: item.type, url: item.url }])).values()];
  if (canonical) {
    return {
      gameId: canonical.gameId,
      slug: canonical.slug,
      title: canonical.title,
      pageExists: canonical.pageExists,
      pageUrl: canonical.pageExists ? canonical.pageUrl : '',
      manual: false,
      matchedBy: 'web-identity-verifier-registry',
      verifiedExternal: true,
      identityVerified: true,
      verificationSources: evidence,
      resolutionConfidence: Math.max(0.9, Math.min(0.99, Number(game.confidence || 0.9)))
    };
  }
  const title = String(game.canonical_title || '').trim();
  const slug = slugify(title);
  return {
    gameId: stableTempId(title),
    slug,
    title,
    pageExists: false,
    pageUrl: '',
    manual: false,
    matchedBy: 'web-identity-verifier-new-game',
    verifiedExternal: true,
    identityVerified: true,
    verificationSources: evidence,
    resolutionConfidence: Math.max(0.9, Math.min(0.99, Number(game.confidence || 0.9)))
  };
}
function acceptedResult(result) {
  if (!result || result.classification !== 'specific_game' || !Array.isArray(result.games) || !result.games.length) return false;
  return result.games.every(game => titleLooksLikeGame(game.canonical_title) && evidenceIsStrong(game));
}

const compact = items.map(compactArticle);
const firstPass = new Map();
for (let offset = 0; offset < compact.length; offset += batchSize) {
  const batch = compact.slice(offset, offset + batchSize);
  const results = await callVerifier(batch);
  for (const result of results) if (result?.news_id) firstPass.set(String(result.news_id), result);
  console.log(`[news/game-verifier] first pass ${Math.min(offset + batch.length, compact.length)}/${compact.length}`);
}

const finalResults = new Map(firstPass);
const difficult = compact.filter(article => {
  const result = firstPass.get(article.news_id);
  return !result || result.classification === 'ambiguous' || (result.classification === 'specific_game' && !acceptedResult(result));
});
for (const article of difficult) {
  const [result] = await callVerifier([article], { deep: true });
  if (result?.news_id) finalResults.set(article.news_id, result);
  console.log(`[news/game-verifier] deep pass ${article.news_id}`);
}

let specificGameArticles = 0;
let nonGameArticles = 0;
let ambiguousArticles = 0;
let canonicalMatches = 0;
let verifiedNewGames = 0;
const issues = [];
const normalizedItems = items.map(item => {
  const id = String(item.id || '');
  const result = finalResults.get(id);
  const reasons = new Set((Array.isArray(item.gameReviewReasons) ? item.gameReviewReasons : []).filter(reason => ![
    'missing-game-page', 'unknown-explicit-game', 'ambiguous-explicit-name', 'ambiguous-alias', 'manual-game-not-found',
    'unverified-primary-game', 'ambiguous-primary-game-verification', 'verified-no-primary-game'
  ].includes(reason)));
  if (!result) {
    ambiguousArticles += 1;
    reasons.add('ambiguous-primary-game-verification');
    issues.push({ news_id: id, reason: 'missing-verifier-result' });
    return { ...item, games: [], gameIds: [], gameReviewReasons: [...reasons] };
  }
  if (result.classification === 'non_game') {
    nonGameArticles += 1;
    reasons.add('verified-no-primary-game');
    return { ...item, games: [], gameIds: [], gameReviewReasons: [...reasons], gameIdentityVerifiedAt: new Date().toISOString() };
  }
  if (!acceptedResult(result)) {
    ambiguousArticles += 1;
    reasons.add('ambiguous-primary-game-verification');
    issues.push({ news_id: id, reason: result.reason || 'insufficient-verification', proposed_games: result.games || [] });
    return { ...item, games: [], gameIds: [], gameReviewReasons: [...reasons] };
  }
  specificGameArticles += 1;
  const games = [];
  const seen = new Set();
  for (const verified of result.games) {
    const game = materializeVerifiedGame(verified);
    if (!game.slug || seen.has(game.gameId)) continue;
    seen.add(game.gameId);
    games.push(game);
    if (game.matchedBy === 'web-identity-verifier-registry') canonicalMatches += 1;
    else verifiedNewGames += 1;
  }
  if (!games.length) {
    ambiguousArticles += 1;
    specificGameArticles -= 1;
    reasons.add('ambiguous-primary-game-verification');
    issues.push({ news_id: id, reason: 'verified-result-could-not-be-materialized' });
  } else if (games.some(game => !game.pageExists)) {
    reasons.add('missing-game-page');
  }
  return {
    ...item,
    games,
    gameIds: games.map(game => game.gameId),
    gameReviewReasons: [...reasons],
    gameIdentityVerifiedAt: new Date().toISOString()
  };
});

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  model,
  articles: normalizedItems.length,
  specific_game_articles: specificGameArticles,
  non_game_articles: nonGameArticles,
  ambiguous_articles: ambiguousArticles,
  canonical_matches: canonicalMatches,
  verified_new_game_references: verifiedNewGames,
  unique_games: new Set(normalizedItems.flatMap(item => (item.games || []).map(game => game.gameId))).size,
  issues
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(Array.isArray(payload) ? normalizedItems : { ...payload, items: normalizedItems }, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[news/game-verifier] ${report.articles} articles; game=${specificGameArticles}; non-game=${nonGameArticles}; ambiguous=${ambiguousArticles}; unique games=${report.unique_games}.`);
