#!/usr/bin/env node

// Compatibility entrypoint for already-dispatched/older news workflow runs.
// New code calls scripts/ensure-game-page.mjs directly so all sources share one creator.
process.env.GAME_CREATOR_SOURCE ||= 'news';
process.env.GAME_SOURCE_URL ||= process.env.NEWS_SOURCE_URL || '';
await import('./ensure-game-page.mjs');
