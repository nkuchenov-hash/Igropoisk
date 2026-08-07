#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { isEmbeddedGameKind } from './lib/game-registry.mjs';
import { findVariantOwner, registerPopularCandidates, resolveSystemGameIdentity } from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const errors = [];
const fail = (code, details = {}) => errors.push({code, ...details});

let migration;
try {
  migration = migrateRepository(root, {dryRun: true, publicBaseUrl: '/game'});
} catch (error) {
  console.error(error?.stack || error);
  process.exit(2);
}
const popularPaths = ['data/popular/current.json', 'data/popular/published.json'].filter(relative => fs.existsSync(path.join(root, relative)));
const popularSnapshots = popularPaths.map(readJson);
const popularDiscovery = registerPopularCandidates(migration.registry, popularSnapshots);
const registry = popularDiscovery.registry;
for (const issue of popularDiscovery.issues) fail('popular_discovery_failed', issue);

const catalog = readJson('data/catalog-visible.json');
const catalogBySlug = new Map();
const catalogIds = new Set();

for (const [index, item] of catalog.entries()) {
  if (!item.game_id) fail('catalog_missing_game_id', {index, slug: item.slug ?? null});
  const variantOwner = findVariantOwner(registry, item);
  if (variantOwner) {
    fail('embedded_variant_in_catalog', {index, slug: item.slug, base_game_id: variantOwner.entity.id, variant_id: variantOwner.variant.id});
    continue;
  }
  const resolution = resolveSystemGameIdentity(item, registry);
  if (!resolution.entity) {
    fail('catalog_unresolved_game', {index, slug: item.slug ?? null, game_id: item.game_id ?? null, reason: resolution.reason});
    continue;
  }
  if (resolution.status === 'mismatch') fail('catalog_identity_mismatch', {index, slug: item.slug, game_id: item.game_id, expected_game_id: resolution.game_id, reason: resolution.reason});
  if (item.game_id !== resolution.game_id) fail('catalog_wrong_game_id', {index, slug: item.slug, game_id: item.game_id, expected_game_id: resolution.game_id});
  if (item.slug !== resolution.canonical_slug) fail('catalog_noncanonical_slug', {index, slug: item.slug, canonical_slug: resolution.canonical_slug, game_id: resolution.game_id});
  const kind = resolution.entity.identity?.kind?.value ?? 'unknown';
  if (isEmbeddedGameKind(kind) || resolution.entity.presentation?.standalonePage === false) fail('nonstandalone_entity_in_catalog', {index, slug: item.slug, game_id: resolution.game_id, kind});
  if (catalogIds.has(resolution.game_id)) fail('duplicate_catalog_game_id', {index, slug: item.slug, game_id: resolution.game_id});
  catalogIds.add(resolution.game_id);
  catalogBySlug.set(item.slug, item);
}

for (let snapshotIndex = 0; snapshotIndex < popularPaths.length; snapshotIndex += 1) {
  const relative = popularPaths[snapshotIndex];
  const snapshot = popularSnapshots[snapshotIndex];
  for (const [index, item] of (snapshot.ranking ?? []).entries()) {
    if (!item.game_id) {
      fail('popular_missing_game_id', {file: relative, index, slug: item.slug ?? null});
      continue;
    }
    const resolution = resolveSystemGameIdentity(item, registry);
    if (!resolution.entity) {
      fail('popular_unresolved_game', {file: relative, index, slug: item.slug ?? null, game_id: item.game_id, reason: resolution.reason});
      continue;
    }
    if (resolution.status === 'mismatch' || item.game_id !== resolution.game_id) fail('popular_identity_mismatch', {file: relative, index, slug: item.slug ?? null, game_id: item.game_id, expected_game_id: resolution.game_id, reason: resolution.reason});
    if (item.canonical_slug !== resolution.canonical_slug) fail('popular_missing_canonical_route', {file: relative, index, slug: item.slug ?? null, game_id: item.game_id, canonical_slug: item.canonical_slug ?? null, expected_slug: resolution.canonical_slug});
    if (resolution.variant && item.variant_id !== resolution.variant.id) fail('popular_variant_binding_mismatch', {file: relative, index, slug: item.slug ?? null, game_id: item.game_id, variant_id: item.variant_id ?? null, expected_variant_id: resolution.variant.id});
  }
}

const gameRoot = path.join(root, 'game');
if (fs.existsSync(gameRoot)) {
  for (const entry of fs.readdirSync(gameRoot, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const indexPath = path.join(gameRoot, entry.name, 'index.html');
    if (!fs.existsSync(indexPath)) continue;
    const variantOwner = findVariantOwner(registry, {slug: entry.name});
    if (variantOwner) {
      fail('embedded_variant_has_standalone_page', {slug: entry.name, base_game_id: variantOwner.entity.id, variant_id: variantOwner.variant.id});
      continue;
    }
    const resolution = resolveSystemGameIdentity({slug: entry.name}, registry);
    if (!resolution.entity) {
      fail('game_page_route_unresolved', {slug: entry.name});
      continue;
    }
    if (resolution.canonical_slug !== entry.name) fail('game_page_noncanonical_route', {slug: entry.name, game_id: resolution.game_id, canonical_slug: resolution.canonical_slug});
    const catalogItem = catalogBySlug.get(entry.name);
    if (catalogItem && catalogItem.game_id !== resolution.game_id) fail('game_page_catalog_id_mismatch', {slug: entry.name, page_game_id: resolution.game_id, catalog_game_id: catalogItem.game_id});
    const html = fs.readFileSync(indexPath, 'utf8');
    const embeddedId = html.match(/\bdata-game-id=["']([^"']+)["']/)?.[1] ?? null;
    if (embeddedId && embeddedId !== resolution.game_id) fail('game_page_embedded_id_mismatch', {slug: entry.name, page_game_id: embeddedId, expected_game_id: resolution.game_id});
  }
}

for (const game of Object.values(registry.games ?? {})) {
  if (game.workflow?.status === 'merged_into_another_game') continue;
  for (const article of game.articles ?? []) {
    if (article.variantId) fail('base_article_has_variant_id', {game_id: game.id, article_id: article.id, variant_id: article.variantId});
  }
  for (const variant of game.variants ?? []) {
    for (const article of variant.articles ?? []) {
      if (article.variantId !== variant.id) fail('child_article_wrong_variant', {game_id: game.id, variant_id: variant.id, article_id: article.id, article_variant_id: article.variantId ?? null});
    }
  }
}

const summary = {
  schema_version: 1,
  canonical_games: Object.keys(registry.games ?? {}).filter(id => registry.games[id]?.workflow?.status !== 'merged_into_another_game').length,
  migration_canonical_games: migration.report.canonicalGames,
  popular_discovery: {created: popularDiscovery.created, matched: popularDiscovery.matched},
  embedded_content: migration.report.embeddedContent,
  catalog_games: catalog.length,
  errors
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
