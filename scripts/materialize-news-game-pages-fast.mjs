#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = process.cwd();
const targetIndex = process.argv.indexOf('--target');
const targetRoot = targetIndex >= 0 ? path.resolve(process.argv[targetIndex + 1] || '') : '';
if (!targetRoot || !fs.existsSync(targetRoot)) throw new Error('Use --target <main-worktree>.');

const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const copy = relative => {
  const source = path.join(sourceRoot, relative);
  if (!fs.existsSync(source)) return false;
  const target = path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
};

const report = read(path.join(sourceRoot, 'tmp/news-game-page-fast.json'), { ready_games: [] });
const games = Array.isArray(report.ready_games) ? report.ready_games : [];
const slugs = [...new Set(games.map(game => String(game.slug || '').trim().toLowerCase()).filter(Boolean))];
if (!slugs.length) {
  console.log('[news/game-page-fast] no ready pages to promote');
  process.exit(0);
}

for (const slug of slugs) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unsafe game slug: ${slug}`);
  if (!copy(`game/${slug}/index.html`)) throw new Error(`Required page missing: game/${slug}/index.html`);
  if (!copy(`data/drafts/${slug}.json`)) throw new Error(`Required draft missing: data/drafts/${slug}.json`);
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

const sourceContent = path.join(sourceRoot, 'data/game-content');
const files = fs.existsSync(sourceContent) ? fs.readdirSync(sourceContent).filter(name => name.endsWith('.json')) : [];
const located = new Map();
for (const name of files) {
  const sourceChunk = read(path.join(sourceContent, name));
  if (!sourceChunk?.games) continue;
  const selected = slugs.filter(slug => sourceChunk.games[slug]);
  if (!selected.length) continue;
  const targetFile = path.join(targetRoot, 'data/game-content', name);
  const targetChunk = read(targetFile, { schema_version: sourceChunk.schema_version || 5, games: {} });
  targetChunk.schema_version = Math.max(Number(targetChunk.schema_version || 1), Number(sourceChunk.schema_version || 1));
  targetChunk.games = targetChunk.games || {};
  for (const slug of selected) {
    targetChunk.games[slug] = sourceChunk.games[slug];
    located.set(slug, name);
  }
  write(targetFile, targetChunk);
}
for (const slug of slugs) if (!located.has(slug)) throw new Error(`Materialized game-content missing ${slug}`);

write(path.join(sourceRoot, 'tmp/news-game-page-fast-production.json'), {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  games: slugs.map(slug => ({ slug, game_content: located.get(slug) }))
});
console.log(`[news/game-page-fast] materialized ${slugs.length} base game pages into production worktree; enrichment remains in the regular lifecycle.`);
