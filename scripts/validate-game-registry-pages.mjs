#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gameRoot = path.join(root, 'game');
const failures = [];
const pages = [];
if (!fs.existsSync(gameRoot)) throw new Error('game/ directory is missing');
for (const entry of fs.readdirSync(gameRoot, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name === '_shared') continue;
  const indexPath = path.join(gameRoot, entry.name, 'index.html');
  if (!fs.existsSync(indexPath)) continue;
  const html = fs.readFileSync(indexPath, 'utf8');
  const pageFailures = [];
  if (!html.includes('../_shared/game-shell.js')) pageFailures.push('missing shared game-shell runtime');
  if (!html.includes(`data-slug="${entry.name}"`) && !html.includes(`data-game-slug="${entry.name}"`)) pageFailures.push('slug marker differs from directory');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  for (const ref of refs.filter(value => value.startsWith('../_shared/'))) {
    const target = path.resolve(path.dirname(indexPath), ref.split(/[?#]/)[0]);
    if (!fs.existsSync(target)) pageFailures.push(`broken shared reference: ${ref}`);
  }
  if (pageFailures.length) failures.push({slug: entry.name, failures: [...new Set(pageFailures)]});
  pages.push({slug: entry.name, sharedReferences: refs.filter(value => value.startsWith('../_shared/')).length});
}
if (failures.length) throw new Error(`Game page runtime validation failed:\n${failures.map(item => `- ${item.slug}: ${item.failures.join('; ')}`).join('\n')}`);
console.log(JSON.stringify({pages: pages.length, runtime: 'game/_shared/game-shell.js', failures: 0}, null, 2));
