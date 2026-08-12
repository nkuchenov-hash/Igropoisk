#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { applyCanonicalGameIdentity, loadEditorialRegistry, resolveEditorialGame } from './lib/editorial-game-registry-adapter.mjs';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim();
if (!slug) {
  console.error('Usage: node scripts/canonicalize-editorial-game-id.mjs <game-slug>');
  process.exit(1);
}

const loaded = loadEditorialRegistry(root);
const identity = resolveEditorialGame({ slug }, { root, loaded });
const targets = [
  `data/drafts/${slug}.json`,
  `data/research/${slug}-source-matrix.json`,
  `data/reviews/${slug}.json`,
  `data/ratings/${slug}.json`,
  `data/articles/${slug}.json`,
  `data/articles/review-${slug}.json`,
  `data/article-drafts/${slug}.json`,
  `data/article-media/${slug}.json`,
  `data/franchises/${slug}.json`,
  `data/similarity/${slug}.json`,
  `data/parser-runs/review-research-${slug}.json`,
  `data/parser-runs/review-output-${slug}.json`
];

let changed = 0;
let found = 0;
for (const relative of targets) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  found += 1;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = applyCanonicalGameIdentity(current, identity);
  const before = JSON.stringify(current);
  const after = JSON.stringify(next);
  if (before !== after) {
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    changed += 1;
  }
}

const catalogPath=path.join(root,'data/catalog-visible.json');
if(fs.existsSync(catalogPath)){
  const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));const index=catalog.findIndex(item=>String(item.slug||'')===identity.slug);
  if(index>=0&&String(catalog[index].game_id||'')!==identity.game_id){catalog[index]={...catalog[index],game_id:identity.game_id};fs.writeFileSync(catalogPath,`${JSON.stringify(catalog,null,2)}\n`);changed+=1}
}
const pagePath=path.join(root,'game',identity.slug,'index.html');
if(fs.existsSync(pagePath)){
  let html=fs.readFileSync(pagePath,'utf8'),next=html;
  if(/\bdata-game-id=["'][^"']*["']/.test(next))next=next.replace(/\bdata-game-id=["'][^"']*["']/,`data-game-id="${identity.game_id}"`);
  else if(/\bdata-slug=["'][^"']*["']/.test(next))next=next.replace(/(\bdata-slug=["'][^"']*["'])/,`$1 data-game-id="${identity.game_id}"`);
  if(next!==html){fs.writeFileSync(pagePath,next);changed+=1}
}
console.log(JSON.stringify({ slug: identity.slug, game_id: identity.game_id, matched_by: identity.matched_by, artifacts_found: found, artifacts_changed: changed }, null, 2));
