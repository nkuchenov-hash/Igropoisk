#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { rebuildIndexes } from './lib/game-registry.mjs';

const root = process.cwd();
const args = process.argv.slice(2).filter(Boolean);
if (!args.length) throw new Error('Usage: node scripts/purge-game-entities.mjs <slug-or-game-id> [...]');

const readJson = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch { return fallback; }
};
const writeJson = (relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const removePath = relative => {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
};

const registryPath = 'data/game-registry/registry.transition.json';
const registry = readJson(registryPath);
if (!registry?.games || typeof registry.games !== 'object') throw new Error('Canonical Game Registry is missing or invalid.');

const requested = new Set(args.map(value => String(value).trim().toLowerCase()).filter(Boolean));
const targets = new Map();
for (const [id, entity] of Object.entries(registry.games)) {
  const slug = String(entity?.identity?.slug?.value || '').trim().toLowerCase();
  if (requested.has(String(id).toLowerCase()) || (slug && requested.has(slug))) {
    targets.set(id, { id, slug });
  }
}
for (const requestedValue of requested) {
  if ([...targets.values()].some(item => item.id.toLowerCase() === requestedValue || item.slug === requestedValue)) continue;
  if (requestedValue.startsWith('game_')) targets.set(requestedValue, { id: requestedValue, slug: '' });
  else targets.set(`unknown:${requestedValue}`, { id: '', slug: requestedValue });
}

const ids = new Set([...targets.values()].map(item => item.id).filter(Boolean));
const slugs = new Set([...targets.values()].map(item => item.slug).filter(Boolean));
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  requested: args,
  targets: [...targets.values()],
  deleted_files: [],
  catalog_removed: 0,
  content_records_removed: 0,
  registry_entities_removed: 0,
  registry_relation_refs_removed: 0,
  registry_review_refs_removed: 0
};

for (const slug of slugs) {
  for (const relative of [
    `game/${slug}`,
    `article/${slug}`,
    `data/drafts/${slug}.json`,
    `data/parser-output/${slug}.json`,
    `data/parser-runs/game-creator-${slug}.json`,
    `data/parser-runs/news-game-page-${slug}.json`,
    `data/reviews/${slug}.json`,
    `data/articles/${slug}.json`,
    `data/guides/${slug}.json`,
    `data/similarity/${slug}.json`,
    `data/game-dna/${slug}.json`
  ]) {
    if (removePath(relative)) report.deleted_files.push(relative);
  }
}

const catalogPath = 'data/catalog-visible.json';
const catalog = readJson(catalogPath, []);
if (Array.isArray(catalog)) {
  const filtered = catalog.filter(item => !slugs.has(String(item?.slug || '').toLowerCase()) && !ids.has(String(item?.game_id || item?.gameId || '')));
  report.catalog_removed = catalog.length - filtered.length;
  if (report.catalog_removed) writeJson(catalogPath, filtered);
}

const contentRoot = path.join(root, 'data/game-content');
if (fs.existsSync(contentRoot)) {
  for (const name of fs.readdirSync(contentRoot).filter(name => name.endsWith('.json'))) {
    const relative = `data/game-content/${name}`;
    const chunk = readJson(relative);
    if (!chunk?.games || typeof chunk.games !== 'object') continue;
    let changed = false;
    for (const [slug, game] of Object.entries(chunk.games)) {
      const gameId = String(game?.game_id || game?.gameId || '');
      if (slugs.has(String(slug).toLowerCase()) || ids.has(gameId)) {
        delete chunk.games[slug];
        report.content_records_removed += 1;
        changed = true;
      }
    }
    if (changed) writeJson(relative, chunk);
  }
}

for (const [id, entity] of Object.entries(registry.games)) {
  const slug = String(entity?.identity?.slug?.value || '').trim().toLowerCase();
  if (ids.has(id) || slugs.has(slug)) {
    ids.add(id);
    if (slug) slugs.add(slug);
    delete registry.games[id];
    report.registry_entities_removed += 1;
  }
}

for (const entity of Object.values(registry.games)) {
  if (!entity?.relations) continue;
  if (ids.has(String(entity.relations.baseGameId || ''))) {
    entity.relations.baseGameId = null;
    report.registry_relation_refs_removed += 1;
  }
  for (const key of ['relatedGameIds', 'series']) {
    if (!Array.isArray(entity.relations[key])) continue;
    const before = entity.relations[key].length;
    entity.relations[key] = entity.relations[key].filter(value => !ids.has(String(value?.gameId || value?.game_id || value || '')));
    report.registry_relation_refs_removed += before - entity.relations[key].length;
  }
}

if (Array.isArray(registry.reviewQueue)) {
  const nextQueue = [];
  for (const review of registry.reviewQueue) {
    if (ids.has(String(review?.candidateId || review?.candidate?.gameId || review?.candidate?.game_id || ''))) {
      report.registry_review_refs_removed += 1;
      continue;
    }
    if (Array.isArray(review?.possibleGameIds)) {
      const before = review.possibleGameIds.length;
      review.possibleGameIds = review.possibleGameIds.filter(id => !ids.has(String(id)));
      report.registry_review_refs_removed += before - review.possibleGameIds.length;
    }
    nextQueue.push(review);
  }
  registry.reviewQueue = nextQueue;
}

rebuildIndexes(registry);
writeJson(registryPath, registry);

fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
writeJson('tmp/game-entity-purge.json', report);
console.log(JSON.stringify(report, null, 2));
