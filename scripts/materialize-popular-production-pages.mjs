#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceRoot = process.cwd();
const targetIndex = process.argv.indexOf('--target');
const targetRoot = targetIndex >= 0 ? path.resolve(process.argv[targetIndex + 1] || '') : '';
if (!targetRoot || !fs.existsSync(targetRoot)) throw new Error('Use --target <main-worktree>.');

const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const copy = relative => {
  const source = path.join(sourceRoot, relative);
  if (!fs.existsSync(source)) return false;
  const target = path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
};

const plan = read(path.join(sourceRoot, 'tmp/popular-game-page-plan.json'), { required_games: [] });
const required = Array.isArray(plan?.required_games) ? plan.required_games : [];
const readyGames = required.filter(game => {
  const slug = String(game?.slug || '').trim().toLowerCase();
  if (!slug) return false;
  const page = path.join(sourceRoot, 'game', slug, 'index.html');
  const draft = read(path.join(sourceRoot, 'data/drafts', `${slug}.json`), null);
  const quality = read(path.join(sourceRoot, 'data/quality-control', `page-${slug}-control.json`), null);
  return fs.existsSync(page) && draft?.publication?.public_ready === true && quality?.green !== false;
});
const slugs = [...new Set(readyGames.map(game => String(game.slug || '').trim().toLowerCase()).filter(Boolean))];
if (!slugs.length) {
  write(path.join(sourceRoot, 'tmp/popular-production-materialization.json'), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    requested: required.length,
    ready: 0,
    games: [],
    pending: required.map(game => game.slug).filter(Boolean)
  });
  console.log('[popular/production] no ready Popular Now game pages');
  process.exit(0);
}

for (const slug of slugs) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unsafe game slug: ${slug}`);
  for (const relative of [`game/${slug}/index.html`, `data/drafts/${slug}.json`, `data/game-dna/${slug}.json`]) {
    if (!copy(relative)) throw new Error(`Required output missing: ${relative}`);
  }
  for (const relative of [
    `data/reviews/${slug}.json`,
    `data/guides/${slug}.json`,
    `data/articles/${slug}.json`,
    `data/similarity/${slug}.json`,
    `data/ratings/${slug}.json`,
    `article/${slug}/index.html`
  ]) copy(relative);
}

const sourceCatalog = read(path.join(sourceRoot, 'data/catalog-visible.json'), []);
const targetCatalogPath = path.join(targetRoot, 'data/catalog-visible.json');
const targetCatalog = read(targetCatalogPath, []);
const sourceBySlug = new Map(sourceCatalog.map(item => [String(item?.slug || ''), item]));
const mergedCatalog = new Map(targetCatalog.map(item => [String(item?.slug || ''), item]));
for (const slug of slugs) {
  const entry = sourceBySlug.get(slug);
  if (!entry) throw new Error(`Visible catalog missing ${slug}`);
  mergedCatalog.set(slug, entry);
}
write(targetCatalogPath, [...mergedCatalog.values()]);

const sourceDnaIndex = read(path.join(sourceRoot, 'data/game-dna/index.json'), { entries: [] });
const targetDnaPath = path.join(targetRoot, 'data/game-dna/index.json');
const targetDna = read(targetDnaPath, { entries: [] });
const sourceDna = new Map((sourceDnaIndex.entries || []).map(item => [String(item.slug || ''), item]));
const mergedDna = new Map((targetDna.entries || []).map(item => [String(item.slug || ''), item]));
for (const slug of slugs) {
  const entry = sourceDna.get(slug);
  if (!entry) throw new Error(`Game DNA index missing ${slug}`);
  mergedDna.set(slug, entry);
}
const dnaEntries = [...mergedDna.values()].sort((a, b) => String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'ru'));
write(targetDnaPath, {
  schema_version: 1,
  entity: 'game_dna',
  count: dnaEntries.length,
  entries: dnaEntries,
  generated_at: new Date().toISOString()
});

const sourceContent = path.join(sourceRoot, 'data/game-content');
const files = fs.existsSync(sourceContent) ? fs.readdirSync(sourceContent).filter(name => name.endsWith('.json')) : [];
const located = new Map();
for (const name of files) {
  const chunk = read(path.join(sourceContent, name));
  if (!chunk?.games) continue;
  const selected = slugs.filter(slug => chunk.games[slug]);
  if (!selected.length) continue;
  const targetFile = path.join(targetRoot, 'data/game-content', name);
  const targetChunk = read(targetFile, { schema_version: chunk.schema_version || 4, games: {} });
  targetChunk.games ||= {};
  for (const slug of selected) {
    targetChunk.games[slug] = chunk.games[slug];
    located.set(slug, name);
  }
  write(targetFile, targetChunk);
}
for (const slug of slugs) if (!located.has(slug)) throw new Error(`Materialized game-content missing ${slug}`);

const staged = spawnSync('git', ['add', '-A', '--', 'data/game-dna'], { cwd: targetRoot, encoding: 'utf8' });
if (staged.status !== 0) throw new Error(`Could not stage Game DNA: ${staged.stderr || staged.stdout}`);

const pending = required.map(game => String(game?.slug || '').trim()).filter(slug => slug && !slugs.includes(slug));
write(path.join(sourceRoot, 'tmp/popular-production-materialization.json'), {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  popular_generated_at: plan?.popular_generated_at || null,
  requested: required.length,
  ready: slugs.length,
  games: slugs.map(slug => ({ slug, game_content: located.get(slug), game_dna: `data/game-dna/${slug}.json` })),
  pending
});
console.log(`[popular/production] materialized ${slugs.length} ready Popular Now game pages; ${pending.length} pending.`);
