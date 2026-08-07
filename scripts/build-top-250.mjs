#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { bindPopularSnapshot, registerPopularCandidates } from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(250, Number(limitArg?.split('=')[1] || 250)));
const popularPath = path.join(root, 'data/popular/current.json');
const outputPath = path.join(root, 'data/top-250/current.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = relative => fs.existsSync(path.join(root, relative));

if (!fs.existsSync(popularPath)) {
  console.error('Missing data/popular/current.json');
  process.exit(2);
}

const popular = readJson(popularPath);
const migration = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
const discovery = registerPopularCandidates(migration.registry, [popular]);
const bound = bindPopularSnapshot(popular, discovery.registry);
const blocking = [...(discovery.issues || []), ...(bound.issues || [])]
  .filter(issue => issue.status === 'unresolved' || issue.status === 'mismatch');

if (blocking.length) {
  console.error(JSON.stringify({ blocking }, null, 2));
  process.exit(2);
}

const ranking = (bound.snapshot.ranking || []).slice(0, limit).map((item, index) => {
  const slug = item.canonical_slug || item.slug;
  const articleJson = `data/articles/${slug}.json`;
  const articlePage = `article/${slug}/index.html`;
  const gamePage = `game/${slug}/index.html`;
  const reviewPublished = exists(articleJson) && exists(articlePage);
  return {
    rank: index + 1,
    game_id: item.game_id,
    slug,
    title: item.title,
    year: item.year ?? null,
    image: item.image || '',
    score: item.score ?? null,
    confidence: item.confidence ?? null,
    delta: item.delta ?? null,
    game_url: exists(gamePage) ? `/Igropoisk/game/${encodeURIComponent(slug)}/` : null,
    review: {
      status: reviewPublished ? 'published' : exists(articleJson) ? 'ready_to_render' : 'pending',
      url: reviewPublished ? `/Igropoisk/article/${encodeURIComponent(slug)}/` : null
    }
  };
});

const output = {
  schema_version: 1,
  name: 'Игропоиск Топ-250',
  generated_at: new Date().toISOString(),
  source: 'data/popular/current.json',
  source_generated_at: popular.generated_at || null,
  capacity: 250,
  count: ranking.length,
  ranking
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ count: ranking.length, published_reviews: ranking.filter(item => item.review.status === 'published').length }, null, 2));
