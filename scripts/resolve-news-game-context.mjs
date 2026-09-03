import fs from 'node:fs/promises';
import { buildGameReviewQueue, enrichNewsItems } from './lib/news-game-linker.mjs';
import { applyResolvedExternalGame, resolveVerifiedExternalNewsGame } from './lib/news-game-context-resolver.mjs';
import { canonicalGameIsPrimary } from './lib/news-primary-game-evidence.mjs';
import { refineNewsPrimaryGame } from './lib/news-primary-game-refiner.mjs';
import { cleanResolvedNewsGame } from './lib/news-game-title-cleanup.mjs';

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
  const game = cleanResolvedNewsGame(refineNewsPrimaryGame(item, proposed));
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
