#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = process.cwd();
const targetArg = process.argv.indexOf('--target');
const targetRoot = targetArg >= 0 ? path.resolve(process.argv[targetArg + 1] || '') : '';
if (!targetRoot || !fs.existsSync(targetRoot)) throw new Error('Use --target <main-worktree>.');

const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const copyIfPresent = relative => {
  const source = path.join(sourceRoot, relative);
  if (!fs.existsSync(source)) return false;
  const target = path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
};

const plan = readJson(path.join(sourceRoot, 'tmp/news-game-page-plan.json'), { required_games: [] });
const required = Array.isArray(plan.required_games) ? plan.required_games : [];
if (!required.length) {
  console.log('[news/production] no required game pages');
  process.exit(0);
}
const slugs = [...new Set(required.map(item => String(item.slug || '').trim().toLowerCase()).filter(Boolean))];
for (const slug of slugs) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unsafe game slug: ${slug}`);
  for (const relative of [`game/${slug}/index.html`, `data/drafts/${slug}.json`]) {
    if (!copyIfPresent(relative)) throw new Error(`Required green game output is missing: ${relative}`);
  }
  for (const relative of [
    `data/ratings/${slug}.json`,
    `data/reviews/${slug}.json`,
    `data/guides/${slug}.json`,
    `data/articles/${slug}.json`,
    `data/similarity/${slug}.json`,
    `article/${slug}/index.html`
  ]) copyIfPresent(relative);
}

const sourceCatalog = readJson(path.join(sourceRoot, 'data/catalog-visible.json'), []);
const targetCatalogPath = path.join(targetRoot, 'data/catalog-visible.json');
const targetCatalog = readJson(targetCatalogPath, []);
const sourceEntries = new Map((Array.isArray(sourceCatalog) ? sourceCatalog : []).map(item => [String(item?.slug || ''), item]));
const mergedCatalog = new Map((Array.isArray(targetCatalog) ? targetCatalog : []).map(item => [String(item?.slug || ''), item]));
for (const slug of slugs) {
  const entry = sourceEntries.get(slug);
  if (!entry) throw new Error(`Visible catalog is missing news-required game ${slug}.`);
  mergedCatalog.set(slug, entry);
}
writeJson(targetCatalogPath, [...mergedCatalog.values()].sort((a, b) => Number(a.year || 9999) - Number(b.year || 9999) || String(a.title || '').localeCompare(String(b.title || ''), 'en')));

const sourceGameContentRoot = path.join(sourceRoot, 'data/game-content');
const chunkFiles = fs.existsSync(sourceGameContentRoot) ? fs.readdirSync(sourceGameContentRoot).filter(name => name.endsWith('.json')) : [];
const located = new Map();
for (const name of chunkFiles) {
  const sourceChunk = readJson(path.join(sourceGameContentRoot, name));
  if (!sourceChunk?.games || typeof sourceChunk.games !== 'object') continue;
  const selected = slugs.filter(slug => sourceChunk.games[slug]);
  if (!selected.length) continue;
  const targetFile = path.join(targetRoot, 'data/game-content', name);
  const targetChunk = readJson(targetFile, { schema_version: sourceChunk.schema_version || 4, games: {} });
  targetChunk.schema_version = Math.max(Number(targetChunk.schema_version || 0), Number(sourceChunk.schema_version || 0)) || 4;
  targetChunk.games ||= {};
  for (const slug of selected) {
    targetChunk.games[slug] = sourceChunk.games[slug];
    located.set(slug, name);
  }
  writeJson(targetFile, targetChunk);
}
for (const slug of slugs) if (!located.has(slug)) throw new Error(`Materialized game-content entry is missing for ${slug}.`);

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  games: slugs.map(slug => ({ slug, game_content: located.get(slug) }))
};
writeJson(path.join(sourceRoot, 'tmp/news-production-materialization.json'), report);
console.log(`[news/production] materialized ${slugs.length} canonical game pages into production worktree.`);
