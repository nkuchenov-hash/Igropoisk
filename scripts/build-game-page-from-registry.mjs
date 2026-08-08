#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi, isEmbeddedGameKind} from './lib/game-registry.mjs';
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

function field(entity, key, fallback = null) {
  const value = entity?.fields?.[key]?.value;
  return value === undefined || value === null ? fallback : value;
}

function mediaUrl(entity, kinds) {
  const item = (entity?.media ?? []).find(media => kinds.includes(media.kind) && media.url);
  return item?.url ?? '';
}

function ensureResearchSeed(entity) {
  const slug = entity.identity.slug.value;
  const parserPath = path.join(root, 'data/parser-output', `${slug}.json`);
  const draftPath = path.join(root, 'data/drafts', `${slug}.json`);
  if (fs.existsSync(parserPath) || fs.existsSync(draftPath)) return;

  const steamAppId = entity.externalIds?.steamAppId ? Number(entity.externalIds.steamAppId) : null;
  const platforms = field(entity, 'platforms', []);
  const release = (entity.releases ?? []).find(item => item.date?.value)?.date?.value ?? '';
  const officialLinks = field(entity, 'officialLinks', {});
  const store = steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : '';
  const seed = {
    schema_version: 1,
    identity: {
      slug,
      title: entity.identity.canonicalTitle.value,
      steam_appid: steamAppId
    },
    release: {date_text: String(release || '')},
    companies: {
      developers: field(entity, 'developers', []),
      publishers: field(entity, 'publishers', [])
    },
    classification: {
      genres: field(entity, 'genres', []),
      categories: [],
      platforms: Array.isArray(platforms) ? platforms : [platforms].filter(Boolean)
    },
    editorial: {
      short_description: field(entity, 'shortDescription', field(entity, 'description', '')),
      integrated_description: '',
      features: []
    },
    media: {
      cover: mediaUrl(entity, ['cover', 'keyArt']),
      hero: mediaUrl(entity, ['hero', 'keyArt', 'cover']),
      screenshots: [],
      videos: [],
      artwork: []
    },
    requirements: {
      pc: {minimum: {raw: ''}, recommended: {raw: ''}},
      platforms: Array.isArray(platforms) ? platforms : [platforms].filter(Boolean)
    },
    links: {
      store,
      official: typeof officialLinks === 'string' ? officialLinks : officialLinks?.official ?? ''
    },
    source: {
      name: 'Game Registry',
      url: '',
      checked_at: new Date().toISOString()
    }
  };
  fs.mkdirSync(path.dirname(parserPath), {recursive: true});
  fs.writeFileSync(parserPath, `${JSON.stringify(seed, null, 2)}\n`);
}

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const api = new GameRegistryApi(registry);
const entity = api.findById(slugOrId) ?? api.findBySlug(slugOrId);
if (!entity) throw new Error(`Game not found in canonical registry: ${slugOrId}`);
const kind = entity.identity?.kind?.value ?? 'unknown';
if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false) {
  throw new Error(`Embedded game content cannot receive a standalone page: ${entity.id} (${kind})`);
}
if (entity.workflow?.status === 'needs_review') throw new Error(`Game identity requires review before page research: ${entity.id}`);
if ((entity.conflicts ?? []).length) throw new Error(`Game has unresolved canonical conflicts: ${entity.id}`);
if (!entity.identity?.canonicalTitle?.value || !entity.identity?.slug?.value) throw new Error(`Game identity is incomplete: ${entity.id}`);

// The strict publication gate belongs to build-game-page.mjs after research. A newly
// discovered popular game may legitimately start with only canonical identity data.
ensureResearchSeed(entity);
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
