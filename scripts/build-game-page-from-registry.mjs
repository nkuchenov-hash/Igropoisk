#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi, validateForPublication} from './lib/game-registry.mjs';

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
process.exit(result.status ?? 1);
