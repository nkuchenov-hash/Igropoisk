#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { bindPopularSnapshot, projectPublicCatalog, registerPopularCandidates } from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const write = process.argv.includes('--write');
const popularOnly = process.argv.includes('--popular-only');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const writeJson = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const popularPaths = ['data/popular/current.json', 'data/popular/published.json'].filter(relative => fs.existsSync(path.join(root, relative)));
const popularSources = popularPaths.map(readJson);

const migration = migrateRepository(root, {dryRun: true, publicBaseUrl: '/game'});
const discovery = registerPopularCandidates(migration.registry, popularSources);
const registry = discovery.registry;
const changes = [];
const blocking = discovery.issues.map(issue => ({file: 'data/popular/*.json', ...issue}));

if (!popularOnly) {
  const catalogPath = 'data/catalog-visible.json';
  const catalog = readJson(catalogPath);
  const projectedCatalog = projectPublicCatalog(catalog, registry);
  for (const issue of projectedCatalog.issues) {
    if (issue.status === 'unresolved') blocking.push({file: catalogPath, ...issue});
  }
  if (!same(catalog, projectedCatalog.records)) {
    changes.push({file: catalogPath, before: catalog.length, after: projectedCatalog.records.length});
    if (write) writeJson(catalogPath, projectedCatalog.records);
  }
}

for (let index = 0; index < popularPaths.length; index += 1) {
  const relative = popularPaths[index];
  const source = popularSources[index];
  const bound = bindPopularSnapshot(source, registry);
  for (const issue of bound.issues) {
    if (issue.status === 'unresolved' || issue.status === 'mismatch') blocking.push({file: relative, ...issue});
  }
  if (!same(source, bound.snapshot)) {
    changes.push({file: relative, ranking: bound.snapshot.ranking?.length ?? 0});
    if (write) writeJson(relative, bound.snapshot);
  }
}

const report = {
  schema_version: 1,
  mode: write ? 'write' : 'check',
  scope: popularOnly ? 'popular' : 'system',
  canonical_games: Object.keys(registry.games ?? {}).filter(id => registry.games[id]?.workflow?.status !== 'merged_into_another_game').length,
  migration_canonical_games: migration.report.canonicalGames,
  popular_discovery: {created: discovery.created, matched: discovery.matched},
  embedded_content: migration.report.embeddedContent,
  changes,
  blocking
};
console.log(JSON.stringify(report, null, 2));
if (blocking.length) process.exit(2);
if (!write && changes.length) process.exit(3);
