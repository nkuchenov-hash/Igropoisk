#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { materializeGameDna } from './lib/game-dna.mjs';

const root = process.cwd();
const requested = String(process.argv[2] || '').trim();
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; }
};
const writeIfChanged = (relative, value) => {
  const target = path.join(root, relative);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let previous = '';
  try { previous = fs.readFileSync(target, 'utf8'); } catch {}
  if (previous === content) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return true;
};
const merge = (base, next) => {
  if (!next) return base || {};
  return {
    ...(base || {}), ...(next || {}),
    identity: { ...(base?.identity || {}), ...(next?.identity || {}) },
    classification: { ...(base?.classification || {}), ...(next?.classification || {}) },
    editorial: { ...(base?.editorial || {}), ...(next?.editorial || {}) },
    relations: { ...(base?.relations || {}), ...(next?.relations || {}) },
  };
};

const catalog = read('data/catalog-visible.json', []).filter((item) => item?.slug);
const records = new Map();
const contentDir = path.join(root, 'data/game-content');
if (fs.existsSync(contentDir)) {
  for (const file of fs.readdirSync(contentDir).filter((name) => name.endsWith('.json'))) {
    const payload = read(`data/game-content/${file}`, {});
    for (const [slug, game] of Object.entries(payload?.games || {})) records.set(slug, game);
  }
}
for (const item of catalog) {
  const slug = String(item.slug || '');
  let game = records.get(slug) || {};
  game = merge(game, read(`data/parser-output/${slug}.json`));
  game = merge(game, read(`data/drafts/${slug}.json`));
  game.identity = {
    ...(game.identity || {}),
    slug,
    title: game.identity?.title || item.title || slug,
    game_id: game.identity?.game_id || item.game_id || '',
  };
  records.set(slug, game);
}

const targets = requested ? catalog.filter((item) => item.slug === requested) : catalog;
const now = new Date().toISOString();
let created = 0;
let updated = 0;
let unchanged = 0;
const entries = [];

for (const item of targets) {
  const slug = item.slug;
  const game = records.get(slug);
  if (!game) continue;
  const existing = read(`data/game-dna/${slug}.json`);
  const entity = materializeGameDna({ game, catalogItem: item, existing, now });
  const changed = writeIfChanged(`data/game-dna/${slug}.json`, entity);
  if (!existing && changed) created += 1;
  else if (changed) updated += 1;
  else unchanged += 1;
}

for (const item of catalog) {
  const dna = read(`data/game-dna/${item.slug}.json`);
  if (!dna) continue;
  entries.push({
    game_id: dna.game_id || item.game_id || '',
    slug: item.slug,
    title: dna.title || item.title || item.slug,
    status: dna.status || 'auto',
    revision: Number(dna.revision || 0),
    updated_at: dna.updated_at || null,
    quality: dna.quality || null,
    public_url: `/game/${item.slug}/`,
  });
}
entries.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru'));
const previousIndex = read('data/game-dna/index.json');
const stableIndex = { schema_version: 1, entity: 'game_dna', count: entries.length, entries };
const previousStableIndex = previousIndex ? { schema_version: previousIndex.schema_version, entity: previousIndex.entity, count: previousIndex.count, entries: previousIndex.entries } : null;
writeIfChanged('data/game-dna/index.json', {
  ...stableIndex,
  generated_at: previousStableIndex && JSON.stringify(previousStableIndex) === JSON.stringify(stableIndex) ? previousIndex.generated_at : now,
});

console.log(JSON.stringify({ catalog_games: catalog.length, targeted: targets.length, created, updated, unchanged, indexed: entries.length }, null, 2));
