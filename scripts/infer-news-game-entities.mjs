import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildGameReviewQueue } from './lib/news-game-linker.mjs';

const HEADLINE_CYRILLIC = /[А-Яа-яЁё]/;
const HEADLINE_LATIN = /[A-Za-z]/;
const LATIN_ENTITY = /(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9’'&:+.-]*)(?:\s+(?:(?:[A-Z0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9’'&:+.-]*)|of|the|and|to|for|vs\.?|Part)){1,5}/gu;
const QUOTED_ENTITY = /[«“"]([^»”"]{2,64})[»”"]/gu;
const STOP_ENTITIES = new Set([
  'pc gamer',
  'game informer',
  'epic games',
  'rockstar games',
  'xbox game pass',
  'xbox series x',
  'xbox series s',
  'playstation 4',
  'playstation 5',
  'unreal engine',
  'unreal engine 5',
  'nintendo switch',
  'nintendo switch 2',
  'steam deck',
  'summer game fest',
  'the game awards'
]);

function normalizeCandidate(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim();
}

function stopKey(value = '') {
  return normalizeCandidate(value)
    .toLowerCase()
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return stopKey(value).replace(/\s+/g, '-');
}

function looksLikeGameTitle(value, { quoted = false } = {}) {
  const title = normalizeCandidate(value);
  if (title.length < 3 || title.length > 64) return false;
  const key = stopKey(title);
  if (!key || STOP_ENTITIES.has(key)) return false;
  if (/^(?:dlc|update|trailer|remake|remaster|gameplay|demo|beta|alpha)$/i.test(key)) return false;
  const tokens = key.split(' ');
  if (tokens.length > 7) return false;
  if (quoted) return tokens.length <= 6;
  return tokens.length >= 2;
}

function candidateScore(candidate) {
  const key = stopKey(candidate.title);
  const tokens = key.split(' ').filter(Boolean);
  return (candidate.quoted ? 50 : 0)
    + Math.min(tokens.length, 5) * 8
    + Math.min(candidate.title.length, 36) / 4
    + Number(/[0-9]/.test(candidate.title)) * 6
    + Number(/[’']/.test(candidate.title)) * 4;
}

export function inferHeadlineGame(item = {}) {
  const titles = [item.titleRu, item.title, item.titleEn]
    .filter(Boolean)
    .map(String)
    .filter((value, index, array) => array.indexOf(value) === index);

  const candidates = [];
  for (const title of titles) {
    if (!HEADLINE_CYRILLIC.test(title)) continue;

    for (const match of title.matchAll(QUOTED_ENTITY)) {
      const value = normalizeCandidate(match[1]);
      if (looksLikeGameTitle(value, { quoted: true })) candidates.push({ title: value, quoted: true, index: match.index || 0 });
    }

    if (!HEADLINE_LATIN.test(title)) continue;
    for (const match of title.matchAll(LATIN_ENTITY)) {
      const value = normalizeCandidate(match[0]);
      if (looksLikeGameTitle(value)) candidates.push({ title: value, quoted: false, index: match.index || 0 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => candidateScore(b) - candidateScore(a) || a.index - b.index);
  const best = candidates[0];
  return Object.freeze({
    title: best.title,
    slug: slugify(best.title),
    matchedBy: best.quoted ? 'headline-quoted-entity' : 'headline-latin-entity'
  });
}

function inferredGame(candidate) {
  return {
    gameId: '',
    slug: candidate.slug,
    title: candidate.title,
    pageExists: false,
    pageUrl: '',
    manual: false,
    matchedBy: candidate.matchedBy
  };
}

export function applyInferredGames(items = []) {
  return items.map(item => {
    if (Array.isArray(item?.games) && item.games.length) return item;
    const candidate = inferHeadlineGame(item);
    if (!candidate?.slug) return item;
    const reviewReasons = [...new Set([...(item.gameReviewReasons || []), 'inferred-game-not-in-registry'])];
    const gameCandidates = [
      ...(Array.isArray(item.gameCandidates) ? item.gameCandidates : []),
      {
        name: candidate.title,
        reason: 'inferred-game-not-in-registry',
        possibleGameIds: [],
        possibleGameSlugs: []
      }
    ];
    return {
      ...item,
      games: [inferredGame(candidate)],
      gameIds: Array.isArray(item.gameIds) ? item.gameIds.filter(Boolean) : [],
      gameCandidates,
      gameReviewStatus: 'needs-review',
      gameReviewReasons: reviewReasons
    };
  });
}

async function main() {
  const eventsPath = 'data/news-events.json';
  const reviewPath = 'data/news-game-review.json';
  const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  const sourceItems = Array.isArray(payload) ? payload : (payload.items || []);
  const items = applyInferredGames(sourceItems);
  const inferredCount = items.filter((item, index) => !(sourceItems[index]?.games || []).length && (item.games || []).length).length;
  const output = Array.isArray(payload) ? items : { ...payload, items };

  await fs.writeFile(eventsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fs.writeFile(reviewPath, `${JSON.stringify(buildGameReviewQueue(items), null, 2)}\n`, 'utf8');
  console.log(`[news-game-entity] inferred ${inferredCount} game hashtags from headlines`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
