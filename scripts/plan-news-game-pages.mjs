#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { GameRegistryApi, validateForPublication } from './lib/game-registry.mjs';
import { decodeNewsGameRequests, registerNewsGameCandidates } from './lib/news-game-registry-discovery.mjs';

const root = process.cwd();
const readJSON = (relative, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; } };
const writeJSON = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); };
const requests = decodeNewsGameRequests(process.env.NEWS_GAME_REQUESTS_B64 || '');
const registryPath = 'data/game-registry/registry.transition.json';
const registry = readJSON(registryPath);
if (!registry) throw new Error('Canonical Game Registry is missing before news page planning.');

const discovery = registerNewsGameCandidates(registry, requests);
if (discovery.created > 0) writeJSON(registryPath, discovery.registry);
const api = new GameRegistryApi(discovery.registry);
const queuePayload = readJSON('data/content-pipeline/queue.json', { items: [] });
const plan = readJSON('data/content-pipeline/execution-plan.json', { pages: [], reviews: [] });
const queue = Array.isArray(queuePayload?.items) ? queuePayload.items : [];
const byGameId = new Map(queue.filter(item => ['build_page', 'enrich_game'].includes(item?.type)).map(item => [item.game_id, item]));
const requestedById = new Map();
for (const item of discovery.resolved) {
  const previous = requestedById.get(item.game_id);
  requestedById.set(item.game_id, previous ? {
    ...previous,
    production_missing: Boolean(previous.production_missing || item.production_missing),
    news_ids: [...new Set([...(previous.news_ids || []), item.news_id].filter(Boolean))]
  } : { ...item, news_ids: [item.news_id].filter(Boolean) });
}

const requiredGames = [];
const newsTasks = [];
for (const request of requestedById.values()) {
  const entity = api.findById(request.game_id);
  if (!entity) continue;
  const slug = String(entity.identity?.slug?.value || request.slug || '');
  if (!slug) continue;
  const title = String(entity.identity?.canonicalTitle?.value || request.title || slug);
  requiredGames.push({game_id: entity.id,slug,title,production_missing: Boolean(request.production_missing),news_ids: request.news_ids || []});
  if (fs.existsSync(path.join(root, 'game', slug, 'index.html'))) continue;
  const existing = byGameId.get(entity.id);
  const gate = validateForPublication(entity, { allowNoRelease: false });
  newsTasks.push({...existing,type: existing?.type || (gate.passed ? 'build_page' : 'enrich_game'),game_id: entity.id,slug,title,steam_appid: existing?.steam_appid || (entity.externalIds?.steamAppId ? Number(entity.externalIds.steamAppId) : null),priority: Math.max(2000, Number(existing?.priority || 0)),reason: existing?.reason || (gate.passed ? 'news requires canonical game page' : `news requires enrichment: ${gate.errors.join(', ')}`),news_reference: true,news_ids: request.news_ids || [],news_source_url: request.source_url || null});
}
const newsSlugs = new Set(newsTasks.map(item => item.slug));
const existingPages = Array.isArray(plan.pages) ? plan.pages.filter(item => !newsSlugs.has(item.slug)) : [];
plan.pages = [...newsTasks, ...existingPages].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.slug || '').localeCompare(String(b.slug || '')));
plan.news = {requested: requests.length,canonical_resolved: requestedById.size,required_games: requiredGames.length,created_in_registry: discovery.created,matched_in_registry: discovery.matched,identity_issues: discovery.issues,page_tasks: newsTasks.length};
writeJSON('data/content-pipeline/execution-plan.json', plan);
writeJSON('tmp/news-game-page-plan.json', {schema_version: 3,generated_at: new Date().toISOString(),requested: requests,resolved: [...requestedById.values()],required_games: requiredGames,identity_issues: discovery.issues,page_tasks: newsTasks.map(item => ({ game_id: item.game_id, slug: item.slug, type: item.type, priority: item.priority }))});
console.log(JSON.stringify({ requested: requests.length, canonical_resolved: requestedById.size, required_games: requiredGames.length, created: discovery.created, issues: discovery.issues.length, page_tasks: newsTasks.length, total_page_tasks: plan.pages.length }, null, 2));

const imported=spawnSync('node',['scripts/plan-game-imports.mjs'],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:8*1024*1024});
if(imported.stdout)console.log(imported.stdout);if(imported.stderr)console.error(imported.stderr);if(imported.status!==0)throw new Error(`Verified game import planning failed with exit ${imported.status}`);
