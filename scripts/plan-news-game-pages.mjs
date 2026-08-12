#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi } from './lib/game-registry.mjs';
import { collectNewsGamePageReferences } from './lib/news-game-page-trigger.mjs';

const root = process.cwd();
const readJSON = (relative, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; } };
const writeJSON = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); };
const requestedGameIds = String(process.env.NEWS_GAME_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
const newsPayload = readJSON('tmp/live-news-events.json', readJSON('data/news-events.json', { items: [] }));
const registry = readJSON('data/game-registry/registry.transition.json');
if (!registry) throw new Error('Canonical Game Registry is missing before news page planning.');
const api = new GameRegistryApi(registry);
const references = collectNewsGamePageReferences(newsPayload, api, { requestedGameIds });
const queuePayload = readJSON('data/content-pipeline/queue.json', { items: [] });
const plan = readJSON('data/content-pipeline/execution-plan.json', { pages: [], reviews: [] });
const pageTypes = new Set(['build_page', 'enrich_game']);
const queue = Array.isArray(queuePayload?.items) ? queuePayload.items : [];
const newsTasks = queue
  .filter(item => pageTypes.has(item?.type) && references.has(item?.game_id))
  .map(item => {
    const reference = references.get(item.game_id);
    return {
      ...item,
      priority: Math.max(2000, Number(item.priority || 0)),
      news_reference: true,
      news_mentions: reference.mentions,
      news_latest_published_at: reference.latestPublishedAt || ''
    };
  });
const newsSlugs = new Set(newsTasks.map(item => item.slug));
const existingPages = Array.isArray(plan.pages) ? plan.pages.filter(item => !newsSlugs.has(item.slug)) : [];
plan.pages = [...newsTasks, ...existingPages]
  .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.slug || '').localeCompare(String(b.slug || '')));
plan.news = {
  requested_game_ids: requestedGameIds,
  referenced_games: references.size,
  page_tasks: newsTasks.length,
  unresolved_or_already_public: [...references.keys()].filter(gameId => !newsTasks.some(task => task.game_id === gameId))
};
writeJSON('data/content-pipeline/execution-plan.json', plan);
writeJSON('tmp/news-game-page-plan.json', {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  requested_game_ids: requestedGameIds,
  referenced_games: [...references.values()],
  page_tasks: newsTasks.map(item => ({ game_id: item.game_id, slug: item.slug, type: item.type, priority: item.priority }))
});
console.log(JSON.stringify({ requested: requestedGameIds.length, referenced: references.size, page_tasks: newsTasks.length, total_page_tasks: plan.pages.length }, null, 2));
