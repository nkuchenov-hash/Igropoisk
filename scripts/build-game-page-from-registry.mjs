#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi, isEmbeddedGameKind, validateForPublication} from './lib/game-registry.mjs';
import {projectPublicCatalog} from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const slugOrId = args.find(value => !value.startsWith('--'));
const registryPath = path.resolve(root, args.includes('--registry') ? args[args.indexOf('--registry') + 1] : 'data/game-registry/registry.transition.json');
if (!slugOrId) throw new Error('Usage: node scripts/build-game-page-from-registry.mjs <slug-or-id> [--registry path] [--dry-run]');

function hashDirectory(directory) {
  if (!fs.existsSync(directory)) return null;
  const hash = crypto.createHash('sha256');
  const walk = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).replaceAll(path.sep, '/');
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${relative}\n`);
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const api = new GameRegistryApi(registry);
const entity = api.findById(slugOrId) ?? api.findBySlug(slugOrId);
if (!entity) throw new Error(`Game not found in canonical registry: ${slugOrId}`);
const kind = entity.identity?.kind?.value ?? 'unknown';
if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false) {
  throw new Error(`Embedded game content cannot receive a standalone page: ${entity.id} (${kind})`);
}
const gate = validateForPublication(entity, {allowNoRelease: false});
if (!gate.passed) {
  console.error(JSON.stringify({status: 'blocked', gameId: entity.id, slug: entity.identity.slug.value, errors: gate.errors}, null, 2));
  process.exit(2);
}
const slug = entity.identity.slug.value;
const sharedPath = path.join(root, 'game/_shared');
const sharedBefore = hashDirectory(sharedPath);
const command = ['scripts/build-game-page.mjs', slug];
if (args.includes('--dry-run')) command.push('--dry-run');
const result = spawnSync('node', command, {cwd: root, encoding: 'utf8', stdio: 'inherit', env: {...process.env, GAME_REGISTRY_ID: entity.id}});
const sharedAfter = hashDirectory(sharedPath);
if (sharedBefore !== sharedAfter) throw new Error('Protected path game/_shared changed during page build');
if ((result.status ?? 1) !== 0 || args.includes('--dry-run')) process.exit(result.status ?? 1);

const catalogPath = path.join(root, 'data/catalog-visible.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const projected = projectPublicCatalog(catalog, registry);
const unresolved = projected.issues.filter(issue => issue.status === 'unresolved');
if (unresolved.length) throw new Error(`Public catalog contains unresolved Game Registry identities: ${JSON.stringify(unresolved)}`);
fs.writeFileSync(catalogPath, `${JSON.stringify(projected.records, null, 2)}\n`);

const pagePath = path.join(root, 'game', slug, 'index.html');
if (fs.existsSync(pagePath)) {
  let html = fs.readFileSync(pagePath, 'utf8');
  if (/\bdata-game-id=["'][^"']*["']/.test(html)) {
    html = html.replace(/\bdata-game-id=["'][^"']*["']/, `data-game-id="${entity.id}"`);
  } else if (/\bdata-slug=["'][^"']*["']/.test(html)) {
    html = html.replace(/(\bdata-slug=["'][^"']*["'])/, `$1 data-game-id="${entity.id}"`);
  }
  fs.writeFileSync(pagePath, html);
}
