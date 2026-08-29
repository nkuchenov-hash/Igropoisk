#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch { return fallback; }
};

const requested = String(process.argv[2] || process.env.GAME_TARGET_SLUG || '').trim();
const acceptance = read('data/content-pipeline/page-acceptance-target.json', {enabled: false});
const execution = read('data/content-pipeline/execution-log.json', {summary: {}});
const plan = read('data/content-pipeline/execution-plan.json', {pages: []});
const pages = Array.isArray(plan?.pages) ? plan.pages.filter(item => item?.slug) : [];

const isGreen = slug => {
  const page = read(`data/quality-control/page-${slug}-control.json`, null);
  const media = read(`data/quality-control/game-page-${slug}.json`, null);
  return page?.green === true && (media?.status === 'green' || media?.green === true);
};
const existsInProduction = slug => {
  if(!slug) return false;
  const check=spawnSync('git',['cat-file','-e',`origin/main:game/${slug}/index.html`],{cwd:root,stdio:'ignore'});
  return check.status===0;
};

let slug = requested;
if (!slug && acceptance?.enabled && acceptance?.slug) slug = String(acceptance.slug).trim();
if (!slug) {
  const previous = String(execution?.summary?.target_slug || '').trim();
  if (previous && isGreen(previous) && !existsInProduction(previous)) slug = previous;
}
if (!slug) slug = String(pages.find(item => !isGreen(item.slug))?.slug || pages[0]?.slug || '').trim();

if (!slug) {
  console.error('No bounded Game Page target is available. Refusing to run the global catalog backlog.');
  process.exit(2);
}

console.log(slug);
