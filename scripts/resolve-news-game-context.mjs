import fs from 'node:fs/promises';
import { buildGameReviewQueue, enrichNewsItems } from './lib/news-game-linker.mjs';
import { applyResolvedExternalGame, resolveVerifiedExternalNewsGame } from './lib/news-game-context-resolver.mjs';
import { refineNewsPrimaryGame } from './lib/news-primary-game-refiner.mjs';

const eventsPath = 'data/news-events.json';
const reviewPath = 'data/news-game-review.json';
const maxExternalLookups = Number(process.env.NEWS_GAME_CONTEXT_MAX_LOOKUPS || 100);
const sequelMarker = /^(?:2|3|4|5|6|7|8|9|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

function itemsFrom(payload) {
  return Array.isArray(payload) ? payload : (payload.items || []);
}

function isPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
}

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTitleAndUrl(item = {}) {
  let url = '';
  try {
    const parsed = new URL(item.primaryUrl || item.url || '');
    url = decodeURIComponent(`${parsed.pathname} ${parsed.search}`);
  } catch {
    url = item.primaryUrl || item.url || '';
  }
  return normalize(`${item.titleRu || ''} ${item.titleEn || ''} ${item.title || ''} ${url}`);
}

function exactContains(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function canonicalAcronym(value = '') {
  const tokens = normalize(value).split(' ').filter(Boolean);
  if (tokens.length < 3) return '';
  const suffix = sequelMarker.test(tokens.at(-1) || '') ? ` ${tokens.at(-1)}` : '';
  const stem = suffix ? tokens.slice(0, -1) : tokens;
  if (stem.length < 3) return '';
  const acronym = stem.map(token => token[0]).join('');
  return acronym.length >= 3 ? `${acronym}${suffix}` : '';
}

export function canonicalGameIsPrimary(item = {}, game = {}) {
  const headlineAndUrl = sourceTitleAndUrl(item);
  const identities = [game.title, game.slug]
    .map(normalize)
    .filter(Boolean);
  for (const identity of identities) {
    if (exactContains(headlineAndUrl, identity)) return true;
    const acronym = canonicalAcronym(identity);
    if (acronym && exactContains(headlineAndUrl, acronym)) return true;
  }
  return false;
}

export function hasExplicitSequelMismatch(item = {}) {
  const headline = normalize([item.titleRu, item.titleEn, item.title].filter(Boolean).join(' '));
  if (!headline) return false;
  for (const game of Array.isArray(item.games) ? item.games : []) {
    const gameTitle = normalize(game?.title || game?.slug || '');
    if (!gameTitle) continue;
    const titleTokens = gameTitle.split(' ');
    if (sequelMarker.test(titleTokens.at(-1) || '')) continue;
    const headlineTokens = headline.split(' ');
    const phraseTokens = titleTokens;
    for (let index = 0; index <= headlineTokens.length - phraseTokens.length - 1; index += 1) {
      if (!phraseTokens.every((token, offset) => headlineTokens[index + offset] === token)) continue;
      const next = headlineTokens[index + phraseTokens.length];
      if (sequelMarker.test(next || '')) return true;
    }
  }
  return false;
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const canonical = await enrichNewsItems(itemsFrom(payload));
let externalLookups = 0;
let resolvedExternally = 0;
let alreadyResolved = 0;
let secondaryOnlyCanonicalLinks = 0;
let sequelMismatches = 0;
const items = [];

for (const original of canonical) {
  let item = original;
  if (Array.isArray(item.games) && item.games.length && hasExplicitSequelMismatch(item)) {
    sequelMismatches += 1;
    item = {
      ...item,
      games: [],
      gameIds: [],
      gameReviewStatus: 'unmatched',
      gameReviewReasons: [...new Set([...(item.gameReviewReasons || []), 'base-game-sequel-mismatch'])]
    };
  }

  if (Array.isArray(item.games) && item.games.length) {
    const primary = item.games.find(game => canonicalGameIsPrimary(item, game));
    if (primary) {
      alreadyResolved += 1;
      items.push({
        ...item,
        games: [primary],
        gameIds: [primary.gameId],
        gameReviewStatus: primary.pageExists ? 'resolved' : 'needs-review',
        gameReviewReasons: primary.pageExists ? [] : ['missing-game-page']
      });
      continue;
    }

    // A known game that appears only in the summary is contextual evidence, not proof
    // that it is the primary game. Reopen the item so the primary resolver can identify
    // the actual headline game (e.g. Haunted Chocolatier vs. a Stardew Valley mention).
    secondaryOnlyCanonicalLinks += 1;
    item = {
      ...item,
      games: [],
      gameIds: [],
      gameReviewStatus: 'unmatched',
      gameReviewReasons: [...new Set([...(item.gameReviewReasons || []), 'secondary-only-canonical-game'])]
    };
  }

  if (!isPublic(item) || externalLookups >= maxExternalLookups) {
    items.push(item);
    continue;
  }
  externalLookups += 1;
  const proposed = await resolveVerifiedExternalNewsGame(item);
  const game = refineNewsPrimaryGame(item, proposed);
  if (game) {
    resolvedExternally += 1;
    items.push(applyResolvedExternalGame(item, game));
  } else {
    items.push(item);
  }
}

const generatedAt = new Date().toISOString();
const output = Array.isArray(payload) ? items : {
  ...payload,
  generatedAt,
  gameResolutionModel: 'canonical-registry-plus-primary-context-v4-primary-evidence',
  gameResolutionStats: {
    alreadyResolved,
    sequelMismatches,
    secondaryOnlyCanonicalLinks,
    externalLookups,
    resolvedExternally,
    unresolvedPublic: items.filter(item => isPublic(item) && !(Array.isArray(item.games) && item.games.length)).length
  },
  items
};

await fs.writeFile(eventsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await fs.writeFile(reviewPath, `${JSON.stringify(buildGameReviewQueue(items, { generatedAt }), null, 2)}\n`, 'utf8');
console.log(`[news/game-context] ${alreadyResolved} canonical primary links; ${sequelMismatches} base-game sequel mismatches reopened; ${secondaryOnlyCanonicalLinks} secondary-only canonical links reopened; ${resolvedExternally} primary-context links from ${externalLookups} public unmatched events; ${items.filter(item => isPublic(item) && !(Array.isArray(item.games) && item.games.length)).length} public events remain without a game.`);