#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const read = relative => {
  try { return fs.readFileSync(path.join(root, relative), 'utf8'); }
  catch { errors.push(`missing ${relative}`); return ''; }
};
const need = (text, needle, message) => { if (!text.includes(needle)) errors.push(message); };

const news = read('.github/workflows/news-pipeline.yml');
const workflow = read('.github/workflows/content-pipeline.yml');
const runner = read('scripts/run-content-pipeline.mjs');
const enrich = read('scripts/run-game-catalog-enrichment.mjs');
const similarity = read('scripts/build-similarity-index.mjs');
const dna = read('scripts/build-game-dna.mjs');
const review = read('scripts/orchestrate-content-v6.mjs');
const publish = read('scripts/materialize-news-production-pages.mjs');
const diff = read('scripts/validate-automation-publish-diff.mjs');

need(news, 'content-pipeline.yml', 'news must dispatch canonical lifecycle');
need(runner, 'build-game-dna.mjs', 'page/relation work must refresh persisted Game DNA');
need(enrich, 'build-game-dna.mjs', 'catalog enrichment must materialize Game DNA');
need(enrich, 'validate-game-dna.mjs', 'catalog enrichment must validate Game DNA');
need(similarity, 'game-dna-weighted-v1', 'similarity must use Game DNA');
need(dna, 'data/game-dna', 'Game DNA builder must persist canonical profiles');
need(review, 'review_score', 'released-game lifecycle must use canonical review score');
need(publish, 'data/game-dna', 'production promotion must include Game DNA');
need(diff, 'data/game-dna/', 'automation allowlist must includ Game DNA');
for (const required of ['prepare-guide-research.mjs','enrich-game-relations.mjs','quality-control-loop.mjs']) {
  need(workflow, required, `lifecycle missing ${required}`);
}
if (runner.includes('data/ratings/') || enrich.includes('data/ratings/')) errors.push('lifecycle must not use data/ratings as editorial score authority');

if (errors.length) {
  console.error(`New-game lifecycle contract failed (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('New-game lifecycle contract passed.');
