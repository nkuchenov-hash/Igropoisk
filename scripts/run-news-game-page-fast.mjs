#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GameRegistryApi } from './lib/game-registry.mjs';
import { decodeNewsGameRequests, registerNewsGameCandidates } from './lib/news-game-registry-discovery.mjs';

const root = process.cwd();
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch { return fallback; }
};
const write = (relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = relative => fs.existsSync(path.join(root, relative));
const run = (command, args, env = {}) => spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  stdio: 'pipe',
  env: { ...process.env, ...env },
  maxBuffer: 16 * 1024 * 1024
});

const requests = decodeNewsGameRequests(process.env.NEWS_GAME_REQUESTS_B64 || '');
if (!requests.length) {
  write('tmp/news-game-page-fast.json', {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    requested: 0,
    ready_count: 0,
    failed_count: 0,
    ready_games: [],
    failed: [],
    identity_issues: []
  });
  console.log('[news/game-page-fast] no requests');
  process.exit(0);
}

const registryPath = 'data/game-registry/registry.transition.json';
const registry = read(registryPath);
if (!registry) throw new Error('Canonical Game Registry is missing before fast news page creation.');
const discovery = registerNewsGameCandidates(registry, requests);
write(registryPath, discovery.registry);
const api = new GameRegistryApi(discovery.registry);

const requestByGameId = new Map();
for (const resolved of discovery.resolved) {
  const previous = requestByGameId.get(resolved.game_id);
  requestByGameId.set(resolved.game_id, previous ? {
    ...previous,
    news_ids: [...new Set([...(previous.news_ids || []), resolved.news_id].filter(Boolean))],
    source_url: previous.source_url || resolved.source_url || null
  } : { ...resolved, news_ids: [resolved.news_id].filter(Boolean) });
}

const readyGames = [];
const failed = [];
for (const resolved of requestByGameId.values()) {
  const entity = api.findById(resolved.game_id);
  if (!entity) {
    failed.push({ game_id: resolved.game_id, slug: resolved.slug, title: resolved.title, reason: 'canonical entity disappeared after registration' });
    continue;
  }
  const slug = String(entity.identity?.slug?.value || resolved.slug || '').trim().toLowerCase();
  const title = String(entity.identity?.canonicalTitle?.value || resolved.title || slug).trim();
  const gameId = entity.id;
  if (!slug || !title || !gameId) {
    failed.push({ game_id: gameId || null, slug: slug || null, title: title || null, reason: 'canonical identity incomplete' });
    continue;
  }

  const page = `game/${slug}/index.html`;
  const draft = `data/drafts/${slug}.json`;
  if (exists(page) && exists(draft)) {
    readyGames.push({ game_id: gameId, slug, title, reused: true, news_ids: resolved.news_ids || [] });
    continue;
  }

  const parserPath = `data/parser-output/${slug}.json`;
  const appId = Number(entity.externalIds?.steamAppId) || null;
  let parserOk = exists(parserPath);
  if (!parserOk) {
    const parsed = run('node', ['scripts/parse-game-data.mjs', slug, appId ? String(appId) : 'auto', title]);
    parserOk = parsed.status === 0 && exists(parserPath);
    if (!parserOk) {
      failed.push({
        game_id: gameId,
        slug,
        title,
        reason: 'structured game parser failed',
        stderr: (parsed.stderr || '').slice(-3000),
        stdout: (parsed.stdout || '').slice(-3000),
        news_ids: resolved.news_ids || []
      });
      continue;
    }
  }

  const built = run('node', ['scripts/build-news-game-page-fast.mjs', gameId], {
    NEWS_SOURCE_URL: resolved.source_url || ''
  });
  if (built.status !== 0 || !exists(page) || !exists(draft)) {
    failed.push({
      game_id: gameId,
      slug,
      title,
      reason: 'fast page materialization failed',
      stderr: (built.stderr || '').slice(-3000),
      stdout: (built.stdout || '').slice(-3000),
      news_ids: resolved.news_ids || []
    });
    continue;
  }

  readyGames.push({ game_id: gameId, slug, title, reused: false, news_ids: resolved.news_ids || [] });
}

const requiredGames = [...requestByGameId.values()].map(item => {
  const entity = api.findById(item.game_id);
  return {
    game_id: item.game_id,
    slug: String(entity?.identity?.slug?.value || item.slug || ''),
    title: String(entity?.identity?.canonicalTitle?.value || item.title || ''),
    news_ids: item.news_ids || []
  };
});
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  requested: requests.length,
  canonical_resolved: requestByGameId.size,
  created_in_registry: discovery.created,
  matched_in_registry: discovery.matched,
  ready_count: readyGames.length,
  failed_count: failed.length + discovery.issues.length,
  ready_games: readyGames,
  failed,
  identity_issues: discovery.issues
};
write('tmp/news-game-page-fast.json', report);
write('tmp/news-game-page-plan.json', {
  schema_version: 4,
  generated_at: report.generated_at,
  requested: requests,
  resolved: [...requestByGameId.values()],
  required_games: requiredGames,
  fast_ready_games: readyGames,
  identity_issues: discovery.issues,
  fast_failed: failed
});
console.log(JSON.stringify(report, null, 2));
if (report.ready_count === 0 && report.failed_count > 0) process.exitCode = 1;
