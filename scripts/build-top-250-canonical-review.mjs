#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, isEmbeddedGameKind } from './lib/game-registry.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';

const root = process.cwd();
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = Math.max(1, Math.min(250, Number(limitArg?.split('=')[1] || 250)));
const read = relative => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  } catch {
    return null;
  }
};
const exists = relative => fs.existsSync(path.join(root, relative));
const now = new Date();
const currentYear = now.getUTCFullYear();
const catalog = read('data/catalog-visible.json') || [];
const api = new GameRegistryApi(migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' }).registry);
const records = new Map();

const gameContentDir = path.join(root, 'data/game-content');
if (fs.existsSync(gameContentDir)) {
  for (const file of fs.readdirSync(gameContentDir).filter(name => name.endsWith('.json'))) {
    const payload = JSON.parse(fs.readFileSync(path.join(gameContentDir, file), 'utf8'));
    for (const [slug, game] of Object.entries(payload.games || {})) records.set(slug, game);
  }
}

const popular = read('data/popular/current.json');
const popularImages = new Map((popular?.ranking || []).map(item => [item.canonical_slug || item.slug, item.image || '']));

function released(game, catalogEntry) {
  const release = game?.release || {};
  const status = String(release.status || '').toLowerCase();
  if (/upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида/i.test(status)) return false;
  const exactDate = Date.parse(String(release.date || ''));
  if (Number.isFinite(exactDate) && exactDate > now.getTime()) return false;
  const year = Number(String(release.date_text || catalogEntry?.year || '').match(/(?:19|20)\d{2}/)?.[0] || catalogEntry?.year || 0);
  return !year || year <= currentYear;
}

function reviewFor(slug) {
  const article = read(`data/articles/${slug}.json`);
  const review = read(`data/reviews/${slug}.json`);
  if (!article || !review || String(article.publication_status || '').toLowerCase() !== 'published' || !exists(`article/${slug}/index.html`)) return null;
  if (String(article.game_slug || article.slug || '') !== slug || String(review.game_slug || '') !== slug) return null;
  if (review.publication_gate?.status !== 'green' || review.review_score?.status !== 'green') return null;
  const score = Number(review.review_score?.calculation?.score_10);
  return Number.isFinite(score) && score > 0 && score <= 10 && Number(article.score) === score
    ? { score, article, review }
    : null;
}

function compactSummary(value, max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const splitAt = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf(' '));
  return `${cut.slice(0, splitAt > 120 ? splitAt : max).trim().replace(/[.,;:!?-]+$/, '')}…`;
}

function presentation(slug, game, draft, article) {
  const appid = Number(draft?.identity?.steam_appid || game?.identity?.steam_appid || 0);
  const media = read(`data/article-media/${slug}.json`);
  const articleShot = (media?.sections || []).flatMap(section => section.images || []).find(image => image?.url)?.url || '';
  const imageCandidates = [...new Set([
    draft?.media?.cover,
    game?.media?.cover,
    appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg` : '',
    popularImages.get(slug),
    draft?.media?.hero,
    game?.media?.hero,
    media?.cover?.url,
    media?.hero?.url,
    articleShot
  ].filter(Boolean))];
  const hero = [
    draft?.media?.hero,
    game?.media?.hero,
    media?.hero?.url,
    article?.hero,
    popularImages.get(slug),
    articleShot,
    imageCandidates[0]
  ].find(Boolean) || '';
  const summary = compactSummary(
    game?.editorial?.short_description ||
    game?.editorial?.integrated_description ||
    draft?.editorial?.short_description ||
    draft?.editorial?.integrated_description ||
    article?.dek ||
    article?.lead ||
    article?.verdict?.summary ||
    ''
  );
  return {
    image: imageCandidates[0] || '',
    image_candidates: imageCandidates,
    hero,
    summary,
    steam_appid: appid || null
  };
}

const eligible = [];
let excludedIdentity = 0;
let excludedUnreleased = 0;
let excludedUnreviewed = 0;
let excludedMissingPage = 0;

for (const catalogEntry of catalog) {
  const entity = (catalogEntry.game_id ? api.findById(String(catalogEntry.game_id)) : null) || api.findBySlug(String(catalogEntry.slug || ''));
  if (
    !entity ||
    isEmbeddedGameKind(entity.identity?.kind?.value || 'unknown') ||
    entity.presentation?.standalonePage === false ||
    entity.workflow?.status === 'needs_review' ||
    (entity.conflicts || []).length
  ) {
    excludedIdentity += 1;
    continue;
  }

  const slug = entity.identity?.slug?.value || catalogEntry.slug;
  const game = records.get(slug) || read(`data/drafts/${slug}.json`);
  const draft = read(`data/drafts/${slug}.json`);
  if (!game || !released(game, catalogEntry)) {
    excludedUnreleased += 1;
    continue;
  }

  const review = reviewFor(slug);
  if (!review) {
    excludedUnreviewed += 1;
    continue;
  }
  if (!exists(`game/${slug}/index.html`)) {
    excludedMissingPage += 1;
    continue;
  }

  const year = Number(String(game.release?.date || game.release?.date_text || catalogEntry.year || '').match(/(?:19|20)\d{2}/)?.[0] || catalogEntry.year || 0) || null;
  const genres = [...new Set([
    ...(game?.classification?.genres || []),
    ...(draft?.classification?.genres || [])
  ].map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
  const displayTitle = String(catalogEntry.title || entity.identity?.canonicalTitle?.value || game?.identity?.title || slug).trim();
  const presentationData = presentation(slug, game, draft, review.article);

  eligible.push({
    game_id: entity.id,
    slug,
    title: displayTitle,
    year,
    genres,
    ...presentationData,
    score: review.score,
    rating_source: 'published_review',
    game_url: `/Igropoisk/game/${encodeURIComponent(slug)}/`,
    review: {
      status: 'published',
      url: `/Igropoisk/article/${encodeURIComponent(slug)}/`,
      pipeline: 'canonical-review-score'
    }
  });
}

eligible.sort((a, b) => b.score - a.score || Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title, 'ru'));
const ranking = eligible.slice(0, limit).map((item, index) => ({ rank: index + 1, ...item }));
const output = {
  schema_version: 6,
  name: 'Игропоиск Топ-250',
  generated_at: new Date().toISOString(),
  source: 'published canonical reviews only',
  capacity: 250,
  count: ranking.length,
  excluded_identity: excludedIdentity,
  excluded_unreleased: excludedUnreleased,
  excluded_unreviewed: excludedUnreviewed,
  excluded_missing_page: excludedMissingPage,
  ranking
};

const target = path.join(root, 'data/top-250/current.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  count: ranking.length,
  excluded_unreviewed: excludedUnreviewed,
  first: ranking.slice(0, 10).map(item => ({ rank: item.rank, slug: item.slug, title: item.title, score: item.score }))
}, null, 2));
