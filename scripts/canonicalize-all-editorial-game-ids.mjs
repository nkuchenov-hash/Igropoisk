#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { applyCanonicalGameIdentity, loadEditorialRegistry, resolveEditorialGame } from './lib/editorial-game-registry-adapter.mjs';

const root = process.cwd();
const write = process.argv.includes('--write');
const loaded = loadEditorialRegistry(root);
const directories = ['data/research', 'data/reviews', 'data/articles'];
const results = [];
const failures = [];

function candidateIdentity(document, file) {
  const game = document?.game && typeof document.game === 'object' ? document.game : {};
  const slug = document?.game_slug || game.slug || (/review-(.+)\.json$/.exec(path.basename(file))?.[1]) || null;
  const gameId = document?.game_id || game.game_id || null;
  if (!slug && !gameId) return null;
  return { game_id: gameId, slug, title: game.title || document?.game_title || null };
}

for (const directory of directories) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) continue;
  for (const name of fs.readdirSync(absolute).filter(name => name.endsWith('.json')).sort()) {
    const file = path.join(absolute, name);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const candidate = candidateIdentity(document, file);
    if (!candidate) continue;
    try {
      const identity = resolveEditorialGame(candidate, { root, loaded });
      const next = applyCanonicalGameIdentity(document, identity);
      const changed = JSON.stringify(document) !== JSON.stringify(next);
      if (write && changed) fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
      results.push({ file: path.relative(root, file), game_id: identity.game_id, slug: identity.slug, changed });
    } catch (error) {
      failures.push({ file: path.relative(root, file), error: error.message });
    }
  }
}

console.log(JSON.stringify({ mode: write ? 'write' : 'check', resolved: results.length, changed: results.filter(item => item.changed).length, failures }, null, 2));
if (failures.length) process.exitCode = 2;
