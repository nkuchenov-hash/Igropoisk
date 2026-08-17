#!/usr/bin/env node
import fs from 'node:fs';

const creator = fs.readFileSync('scripts/ensure-game-page.mjs', 'utf8');
const news = fs.readFileSync('scripts/run-news-game-page-fast.mjs', 'utf8');
const fail = message => { throw new Error(message); };

if (!creator.includes("mode: 'game_creator_structured_sources'")) fail('Universal Game Creator mode is missing');
if (!creator.includes("page: 'ready'")) fail('Base page must become ready independently');
if (!creator.includes("review: reviewReady ? 'ready' : 'pending'")) fail('Review must be an optional module state');
if (!creator.includes("media: mediaReady ? 'ready' : 'pending'")) fail('Media must be an optional module state');
if (!creator.includes('public_ready: true')) fail('Base page publication must not wait for optional modules');
if (creator.includes('const publicReady = !released || reviewReady')) fail('Review still gates base page publication');
if (creator.includes("missing.push('media')")) fail('Media still gates base page creation');
if (!news.includes("['scripts/ensure-game-page.mjs', gameId]")) fail('News must call the universal Game Creator');
if (!news.includes("GAME_CREATOR_SOURCE: 'news'")) fail('News source context must be passed to the Game Creator');
if (news.includes("['scripts/build-news-game-page-fast.mjs', gameId]")) fail('News still calls the old news-only page builder');

console.log('Game Creator boundary contract passed: page existence is independent from review/media/DNA/similarity modules.');
