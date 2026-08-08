#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, isEmbeddedGameKind } from './lib/game-registry.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { bindPopularSnapshot, registerPopularCandidates } from './lib/system-game-registry-adapter.mjs';

const root = process.cwd();
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(250, Number(limitArg?.split('=')[1] || 250)));
const popularPath = path.join(root, 'data/popular/current.json');
const outputPath = path.join(root, 'data/top-250/current.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = relative => fs.existsSync(path.join(root, relative));
const recoverableStaleId = issue => issue?.status === 'mismatch' && issue?.reason === 'unknown_explicit_game_id' && Boolean(issue?.expected_game_id);

if (!fs.existsSync(popularPath)) {
  console.error('Missing data/popular/current.json');
  process.exit(2);
}

const popular = readJson(popularPath);
const migration = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
const discovery = registerPopularCandidates(migration.registry, [popular]);
const bound = bindPopularSnapshot(popular, discovery.registry);
const blocking = [...(discovery.issues || []), ...(bound.issues || [])]
  .filter(issue => !recoverableStaleId(issue) && (issue.status === 'unresolved' || issue.status === 'mismatch'));
const api = new GameRegistryApi(discovery.registry);

const candidates = (bound.snapshot.ranking || []).filter(item => {
  const entity = (item.game_id ? api.findById(String(item.game_id)) : null) || api.findBySlug(String(item.canonical_slug || item.slug || ''));
  if (!entity) return false;
  const kind = entity.identity?.kind?.value || 'unknown';
  if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false) return false;
  if (entity.workflow?.status === 'needs_review' || (entity.conflicts || []).length) return false;
  return true;
});

const ranking = candidates.slice(0, limit).map((item, index) => {
  const entity = (item.game_id ? api.findById(String(item.game_id)) : null) || api.findBySlug(String(item.canonical_slug || item.slug || ''));
  const slug = entity?.identity?.slug?.value || item.canonical_slug || item.slug;
  const gameId = entity?.id || item.game_id;
  const articleJson = `data/articles/${slug}.json`;
  const articlePage = `article/${slug}/index.html`;
  const gamePage = `game/${slug}/index.html`;
  const gamePublished = exists(gamePage);
  const strictReviewData = exists(articleJson);
  const reviewPublished = gamePublished && strictReviewData && exists(articlePage);
  return {
    rank: index + 1,
    game_id: gameId,
    slug,
    title: entity?.identity?.canonicalTitle?.value || item.title,
    year: item.year ?? null,
    image: item.image || '',
    score: item.score ?? null,
    confidence: item.confidence ?? null,
    delta: item.delta ?? null,
    game_url: gamePublished ? `/Igropoisk/game/${encodeURIComponent(slug)}/` : null,
    review: {
      status: reviewPublished ? 'published' : strictReviewData ? 'ready_to_render' : 'pending',
      url: reviewPublished ? `/Igropoisk/article/${encodeURIComponent(slug)}/` : null,
      pipeline: strictReviewData ? 'strict' : null
    }
  };
});

const output = {
  schema_version: 2,
  name: 'Игропоиск Топ-250',
  generated_at: new Date().toISOString(),
  source: 'data/popular/current.json',
  source_generated_at: popular.generated_at || null,
  capacity: 250,
  count: ranking.length,
  excluded_identity: (bound.snapshot.ranking || []).length - candidates.length,
  registry_issues: blocking.length,
  ranking
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  count: ranking.length,
  excluded_identity: output.excluded_identity,
  registry_issues: blocking.length,
  game_pages: ranking.filter(item => item.game_url).length,
  published_reviews: ranking.filter(item => item.review.status === 'published').length
}, null, 2));
