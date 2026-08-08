import fs from 'node:fs/promises';
import { buildGameReviewQueue, enrichNewsItems } from './lib/news-game-linker.mjs';
import { applyResolvedExternalGame, resolveVerifiedExternalNewsGame } from './lib/news-game-context-resolver.mjs';

const eventsPath = 'data/news-events.json';
const reviewPath = 'data/news-game-review.json';
const maxExternalLookups = Number(process.env.NEWS_GAME_CONTEXT_MAX_LOOKUPS || 24);

function itemsFrom(payload) {
  return Array.isArray(payload) ? payload : (payload.items || []);
}

function isPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const canonical = await enrichNewsItems(itemsFrom(payload));
let externalLookups = 0;
let resolvedExternally = 0;
let alreadyResolved = 0;
const items = [];

for (const item of canonical) {
  if (Array.isArray(item.games) && item.games.length) {
    alreadyResolved += 1;
    items.push(item);
    continue;
  }
  if (!isPublic(item) || externalLookups >= maxExternalLookups) {
    items.push(item);
    continue;
  }
  externalLookups += 1;
  const game = await resolveVerifiedExternalNewsGame(item);
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
  gameResolutionModel: 'canonical-registry-plus-verified-context-v1',
  gameResolutionStats: {
    alreadyResolved,
    externalLookups,
    resolvedExternally,
    unresolvedPublic: items.filter(item => isPublic(item) && !(Array.isArray(item.games) && item.games.length)).length
  },
  items
};

await fs.writeFile(eventsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await fs.writeFile(reviewPath, `${JSON.stringify(buildGameReviewQueue(items, { generatedAt }), null, 2)}\n`, 'utf8');
console.log(`[news/game-context] ${alreadyResolved} canonical links; ${resolvedExternally} verified context links from ${externalLookups} public unmatched events; ${items.filter(item => isPublic(item) && !(Array.isArray(item.games) && item.games.length)).length} public events remain without a game.`);
