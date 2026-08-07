#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { bindPopularSnapshot, projectPublicCatalog } from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const write = process.argv.includes('--write');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const writeJson = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const migration = migrateRepository(root, {dryRun: true, publicBaseUrl: '/game'});
const registry = migration.registry;
const changes = [];
const blocking = [];

const catalogPath = 'data/catalog-visible.json';
const catalog = readJson(catalogPath);
const projectedCatalog = projectPublicCatalog(catalog, registry);
for (const issue of projectedCatalog.issues) {
  if (['unresolved'].includes(issue.status)) blocking.push({file: catalogPath, ...issue});
}
if (!same(catalog, projectedCatalog.records)) {
  changes.push({file: catalogPath, before: catalog.length, after: projectedCatalog.records.length});
  if (write) writeJson(catalogPath, projectedCatalog.records);
}

for (const relative of ['data/popular/current.json', 'data/popular/published.json']) {
  if (!fs.existsSync(path.join(root, relative))) continue;
  const source = readJson(relative);
  const bound = bindPopularSnapshot(source, registry);
  for (const issue of bound.issues) {
    if (issue.status === 'unresolved') blocking.push({file: relative, ...issue});
  }
  if (!same(source, bound.snapshot)) {
    changes.push({file: relative, ranking: bound.snapshot.ranking?.length ?? 0});
    if (write) writeJson(relative, bound.snapshot);
  }
}

const report = {
  schema_version: 1,
  mode: write ? 'write' : 'check',
  canonical_games: migration.report.canonicalGames,
  embedded_content: migration.report.embeddedContent,
  changes,
  blocking
};
console.log(JSON.stringify(report, null, 2));
if (blocking.length) process.exit(2);
if (!write && changes.length) process.exit(3);
