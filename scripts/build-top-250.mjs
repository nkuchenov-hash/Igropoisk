#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, isEmbeddedGameKind } from './lib/game-registry.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';

const root = process.cwd();
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(250, Number(limitArg?.split('=')[1] || 250)));
const outputPath = path.join(root, 'data/top-250/current.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readOptional = relative => {
  try { return readJson(path.join(root, relative)); } catch { return null; }
};
const exists = relative => fs.existsSync(path.join(root, relative));
const now = new Date();
const currentYear = now.getUTCFullYear();

const catalog = readOptional('data/catalog-visible.json') || [];
const migration = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
const api = new GameRegistryApi(migration.registry);
const records = new Map();

const gameContentDir = path.join(root, 'data/game-content');
if (fs.existsSync(gameContentDir)) {
  for (const file of fs.readdirSync(gameContentDir).filter(name => name.endsWith('.json')).sort()) {
    const payload = readJson(path.join(gameContentDir, file));
    for (const [slug, game] of Object.entries(payload.games || {})) records.set(slug, game);
  }
}

const popular = readOptional('data/popular/current.json');
const popularImages = new Map((popular?.ranking || []).map(item => [item.canonical_slug || item.slug, item.image || '']));

function releaseState(game, catalogEntry) {
  const release = game?.release || {};
  const status = String(release.status || '').trim().toLowerCase();
  if (/(upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида)/i.test(status)) return { released: false, reason: 'status' };

  const exact = String(release.date || '').trim();
  if (exact) {
    const parsed = Date.parse(exact);
    if (Number.isFinite(parsed) && parsed > now.getTime()) return { released: false, reason: 'future_date' };
  }

  const text = String(release.date_text || catalogEntry?.year || '').trim();
  const year = Number(text.match(/(?:19|20)\d{2}/)?.[0] || catalogEntry?.year || 0);
  if (year > currentYear) return { released: false, reason: 'future_year' };
  return { released: true, reason: 'released_or_historical' };
}

function scoreFor(slug, game) {
  const rating = readOptional(`data/ratings/${slug}.json`);
  const calculated = Number(rating?.calculation?.score_10);
  if (Number.isFinite(calculated) && calculated > 0 && calculated <= 10) return { score: calculated, source: 'rating_research' };
  const editorial = Number(game?.ratings?.igropoisk);
  if (Number.isFinite(editorial) && editorial > 0 && editorial <= 10) return { score: editorial, source: 'game_content' };
  return null;
}

const eligible = [];
let excludedIdentity = 0;
let excludedUnreleased = 0;
let excludedUnrated = 0;
let excludedMissingPage = 0;

for (const item of catalog) {
  const entity = (item.game_id ? api.findById(String(item.game_id)) : null) || api.findBySlug(String(item.slug || ''));
  if (!entity) { excludedIdentity += 1; continue; }
  const kind = entity.identity?.kind?.value || 'unknown';
  if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false || entity.workflow?.status === 'needs_review' || (entity.conflicts || []).length) {
    excludedIdentity += 1;
    continue;
  }

  const slug = entity.identity?.slug?.value || item.slug;
  const game = records.get(slug) || readOptional(`data/drafts/${slug}.json`);
  if (!game) { excludedUnrated += 1; continue; }

  const release = releaseState(game, item);
  if (!release.released) { excludedUnreleased += 1; continue; }

  const rating = scoreFor(slug, game);
  if (!rating) { excludedUnrated += 1; continue; }

  const gamePage = `game/${slug}/index.html`;
  if (!exists(gamePage)) { excludedMissingPage += 1; continue; }

  const articleJson = `data/articles/${slug}.json`;
  const articlePage = `article/${slug}/index.html`;
  const strictReviewData = exists(articleJson);
  const reviewPublished = strictReviewData && exists(articlePage);
  const year = Number(String(game.release?.date || game.release?.date_text || item.year || '').match(/(?:19|20)\d{2}/)?.[0] || item.year || 0) || null;
  const image = game.media?.cover || game.media?.hero || popularImages.get(slug) || '';

  eligible.push({
    game_id: entity.id,
    slug,
    title: entity.identity?.canonicalTitle?.value || game.identity?.title || item.title || slug,
    year,
    image,
    score: rating.score,
    rating_source: rating.source,
    game_url: `/Igropoisk/game/${encodeURIComponent(slug)}/`,
    review: {
      status: reviewPublished ? 'published' : strictReviewData ? 'ready_to_render' : 'pending',
      url: reviewPublished ? `/Igropoisk/article/${encodeURIComponent(slug)}/` : null,
      pipeline: strictReviewData ? 'strict' : null
    }
  });
}

eligible.sort((a, b) => b.score - a.score || Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title, 'ru'));
const ranking = eligible.slice(0, limit).map((item, index) => ({ rank: index + 1, ...item }));

const output = {
  schema_version: 3,
  name: 'Игропоиск Топ-250',
  generated_at: new Date().toISOString(),
  source: 'released games with valid Игропоиск rating',
  capacity: 250,
  count: ranking.length,
  excluded_identity: excludedIdentity,
  excluded_unreleased: excludedUnreleased,
  excluded_unrated: excludedUnrated,
  excluded_missing_page: excludedMissingPage,
  ranking
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  count: ranking.length,
  excluded_identity: excludedIdentity,
  excluded_unreleased: excludedUnreleased,
  excluded_unrated: excludedUnrated,
  excluded_missing_page: excludedMissingPage,
  first: ranking.slice(0, 10).map(item => ({ rank: item.rank, slug: item.slug, score: item.score }))
}, null, 2));
