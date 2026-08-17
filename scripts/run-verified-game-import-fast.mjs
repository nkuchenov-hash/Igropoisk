#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GameRegistryApi } from './lib/game-registry.mjs';
import { registerVerifiedGameImports } from './lib/verified-game-import.mjs';

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

const payload = read('data/game-import-requests.json', { schema_version: 1, imports: [] });
const requests = Array.isArray(payload.imports) ? payload.imports : [];
const nowIso = new Date().toISOString();
const reportPath = 'tmp/verified-game-import-fast.json';
if (!requests.length) {
  write(reportPath, { schema_version: 1, generated_at: nowIso, requested: 0, ready_count: 0, failed_count: 0, ready_games: [], failed: [], identity_issues: [] });
  console.log('[verified-import/game-creator] no requests');
  process.exit(0);
}

const registryPath = 'data/game-registry/registry.transition.json';
const registry = read(registryPath);
if (!registry) throw new Error('Canonical Game Registry is missing before verified import creation.');
const discovery = registerVerifiedGameImports(registry, requests);
write(registryPath, discovery.registry);
const api = new GameRegistryApi(discovery.registry);
const requestByImportId = new Map(requests.map(request => [String(request.import_id || request.slug || ''), request]));
const readyGames = [];
const failed = [];

function seedParser(resolved, request) {
  if (!resolved.parser_seed) return false;
  const seed = structuredClone(resolved.parser_seed);
  seed.schema_version = Math.max(Number(seed.schema_version || 1), 2);
  seed.identity = {
    ...(seed.identity || {}),
    slug: resolved.slug,
    title: resolved.title,
    steam_appid: resolved.steam_appid || null
  };
  seed.release = seed.release || { date_text: String(request?.releases?.[0]?.date || '') };
  seed.companies = seed.companies || { developers: [], publishers: [] };
  seed.classification = seed.classification || { genres: [], categories: [], platforms: [] };
  seed.editorial = seed.editorial || { short_description: '', integrated_description: '', features: [] };
  seed.media = seed.media || { cover: '', hero: '', screenshots: [], videos: [], artwork: [] };
  seed.requirements = seed.requirements || { pc: { minimum: { raw: '' }, recommended: { raw: '' } }, platforms: seed.classification.platforms || [] };
  seed.links = seed.links || {};
  const primary = resolved.verification_sources?.[0] || request?.verification_sources?.[0] || null;
  seed.source = {
    ...(seed.source || {}),
    name: seed.source?.name || primary?.name || 'Verified game import',
    url: seed.source?.url || primary?.url || '',
    checked_at: seed.source?.checked_at || nowIso
  };
  write(`data/parser-output/${resolved.slug}.json`, seed);
  return true;
}

for (const resolved of discovery.resolved) {
  if (resolved.publication_intent !== 'full_page') continue;
  const request = requestByImportId.get(String(resolved.import_id || '')) || {};
  const entity = api.findById(resolved.game_id);
  if (!entity) {
    failed.push({ import_id: resolved.import_id, game_id: resolved.game_id, slug: resolved.slug, reason: 'registry_entity_missing_after_import' });
    continue;
  }
  const gameId = entity.id;
  const slug = String(entity.identity?.slug?.value || resolved.slug || '').trim().toLowerCase();
  const title = String(entity.identity?.canonicalTitle?.value || resolved.title || slug).trim();
  const parserPath = `data/parser-output/${slug}.json`;

  if (resolved.parser_seed) seedParser({ ...resolved, slug, title }, request);
  if (!exists(parserPath)) {
    const parsed = run('node', ['scripts/parse-game-data.mjs', slug, resolved.steam_appid ? String(resolved.steam_appid) : 'auto', title]);
    if (parsed.status !== 0 || !exists(parserPath)) {
      failed.push({
        import_id: resolved.import_id,
        game_id: gameId,
        slug,
        title,
        reason: 'structured game parser failed',
        stderr: (parsed.stderr || '').slice(-3000),
        stdout: (parsed.stdout || '').slice(-3000)
      });
      continue;
    }
  }

  const primaryUrl = resolved.verification_sources?.[0]?.url || request?.verification_sources?.[0]?.url || '';
  const built = run('node', ['scripts/ensure-game-page.mjs', gameId], {
    GAME_CREATOR_SOURCE: 'verified_import',
    GAME_SOURCE_URL: primaryUrl
  });
  if (built.status !== 0 || !exists(`game/${slug}/index.html`) || !exists(`data/drafts/${slug}.json`)) {
    failed.push({
      import_id: resolved.import_id,
      game_id: gameId,
      slug,
      title,
      reason: 'base Game Creator materialization failed',
      stderr: (built.stderr || '').slice(-3000),
      stdout: (built.stdout || '').slice(-3000)
    });
    continue;
  }
  const draft = read(`data/drafts/${slug}.json`, {});
  readyGames.push({ import_id: resolved.import_id, game_id: gameId, slug, title, modules: draft.modules || {}, reused: false });
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  creator: 'scripts/ensure-game-page.mjs',
  requested: requests.length,
  canonical_resolved: discovery.resolved.length,
  created_in_registry: discovery.created,
  matched_in_registry: discovery.matched,
  ready_count: readyGames.length,
  failed_count: failed.length + discovery.issues.length,
  ready_games: readyGames,
  failed,
  identity_issues: discovery.issues
};
write(reportPath, report);
console.log(JSON.stringify(report, null, 2));
if (report.ready_count === 0 && report.failed_count > 0) process.exitCode = 1;
