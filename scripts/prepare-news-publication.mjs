#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { filterNewsPayload, hasMissingGamePage } from './lib/news-publication-gate.mjs';

const root = process.cwd();
const files = ['data/news.json', 'data/publisher-news.json', 'data/news-events.json', 'data/news-home-ru.json'];
const summary = [];
for (const relative of files) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  const payload = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
  const deferred = items.filter(hasMissingGamePage);
  const filtered = filterNewsPayload(payload);
  fs.writeFileSync(absolute, `${JSON.stringify(filtered, null, 2)}\n`);
  summary.push({ file: relative, before: items.length, deferred: deferred.length, published: items.length - deferred.length });
}
console.log(JSON.stringify({ publication_gate: 'game-page-required', files: summary }, null, 2));
