#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, validateForPublication } from './lib/game-registry.mjs';

const root = process.cwd();
const readJSON = (relative, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; } };
const writeJSON = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); };

const popular = readJSON('data/popular/current.json', { ranking: [] });
const ranking = Array.isArray(popular?.ranking) ? popular.ranking.slice(0, 20) : [];
const registryPath = 'data/game-registry/registry.transition.json';
const registry = readJSON(registryPath);
if (!registry) throw new Error('Canonical Game Registry is missing before Popular page planning.');

const api = new GameRegistryApi(registry);
const queuePayload = readJSON('data/content-pipeline/queue.json', { items: [] });
const plan = readJSON('data/content-pipeline/execution-plan.json', { pages: [], reviews: [] });
const queue = Array.isArray(queuePayload?.items) ? queuePayload.items : [];
const byGameId = new Map(queue.filter(item => ['build_page', 'enrich_game'].includes(item?.type)).map(item => [item.game_id, item]));
const requiredGames = [];
const popularTasks = [];
const identityIssues = [];

for (const [index, item] of ranking.entries()) {
  const explicitId = String(item?.game_id || item?.gameId || '').trim();
  const slugHint = String(item?.slug || '').trim();
  const entity = (explicitId ? api.findById(explicitId) : null) || (slugHint ? api.findBySlug(slugHint) : null);
  if (!entity) {
    identityIssues.push({ rank: index + 1, slug: slugHint || null, title: item?.title || null, game_id: explicitId || null, reason: 'canonical_game_not_found' });
    continue;
  }

  const slug = String(entity.identity?.slug?.value || slugHint || '');
  const title = String(entity.identity?.canonicalTitle?.value || item?.title || slug);
  if (!slug) {
    identityIssues.push({ rank: index + 1, slug: slugHint || null, title, game_id: entity.id, reason: 'canonical_slug_missing' });
    continue;
  }

  requiredGames.push({
    game_id: entity.id,
    slug,
    title,
    rank: index + 1,
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
  });

  const pageExists = fs.existsSync(path.join(root, 'game', slug, 'index.html'));
  const draft = readJSON(`data/drafts/${slug}.json`, null);
  if (pageExists && draft?.publication?.public_ready === true) continue;

  const existing = byGameId.get(entity.id);
  const gate = validateForPublication(entity, { allowNoRelease: false });
  const priority = Math.max(2050 + Math.max(0, 20 - index), Number(existing?.priority || 0));
  popularTasks.push({
    ...(existing || {}),
    type: existing?.type || (gate.passed ? 'build_page' : 'enrich_game'),
    game_id: entity.id,
    slug,
    title,
    steam_appid: existing?.steam_appid || (entity.externalIds?.steamAppId ? Number(entity.externalIds.steamAppId) : null),
    priority,
    reason: existing?.reason || (gate.passed ? 'Popular Now requires canonical game page' : `Popular Now requires enrichment: ${gate.errors.join(', ')}`),
    popular_reference: true,
    popular_rank: index + 1,
    popular_score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
  });
}

const popularSlugs = new Set(popularTasks.map(item => item.slug));
const existingPages = Array.isArray(plan.pages) ? plan.pages.filter(item => !popularSlugs.has(item.slug)) : [];
plan.pages = [...popularTasks, ...existingPages]
  .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.slug || '').localeCompare(String(b.slug || '')));
plan.popular = {
  requested: ranking.length,
  canonical_resolved: requiredGames.length,
  identity_issues: identityIssues,
  page_tasks: popularTasks.length
};

writeJSON('data/content-pipeline/execution-plan.json', plan);
writeJSON('tmp/popular-game-page-plan.json', {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  popular_generated_at: popular?.generated_at || popular?.generatedAt || null,
  requested: ranking.length,
  required_games: requiredGames,
  identity_issues: identityIssues,
  page_tasks: popularTasks.map(item => ({
    game_id: item.game_id,
    slug: item.slug,
    type: item.type,
    priority: item.priority,
    rank: item.popular_rank,
    score: item.popular_score
  }))
});

console.log(JSON.stringify({
  requested: ranking.length,
  canonical_resolved: requiredGames.length,
  identity_issues: identityIssues.length,
  page_tasks: popularTasks.length,
  total_page_tasks: plan.pages.length
}, null, 2));
