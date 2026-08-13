import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalGameHashtag, hashtagKey } from './lib/news-game-hashtag.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const refIndex = args.indexOf('--production-ref');
const productionRef = refIndex >= 0 ? String(args[refIndex + 1] || '').trim() : '';
const eventsPath = 'data/news-events.json';
const reportPath = 'tmp/news-game-hashtag-audit.json';
const explicitResolutionReasons = new Set(['unknown-explicit-game', 'ambiguous-explicit-name', 'ambiguous-alias', 'manual-game-not-found']);

const payload = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);
const hashtagOwner = new Map();
const gameHashtag = new Map();
const uniqueGames = new Map();
const collisions = [];
const inconsistent = [];
const temporary = [];
const missingPages = [];
const productionMissingPages = [];
const badPageUrls = [];
const duplicateArticleGames = [];
const unresolvedExplicit = [];
let articlesWithGames = 0;
let gameReferences = 0;

function existsAtRef(relative) {
  if (!productionRef) return fs.existsSync(relative);
  const result = spawnSync('git', ['cat-file', '-e', `${productionRef}:${relative.replaceAll('\\', '/')}`], { stdio: 'ignore' });
  return result.status === 0;
}

for (const item of items) {
  const games = Array.isArray(item?.games) ? item.games.filter(game => game && typeof game === 'object') : [];
  if (games.length) articlesWithGames += 1;
  const seen = new Set();
  for (const game of games) {
    gameReferences += 1;
    const gameId = String(game.gameId || game.game_id || '').trim();
    const slug = String(game.slug || '').trim().toLowerCase();
    const title = String(game.title || '').trim();
    const hashtag = String(game.hashtag || canonicalGameHashtag({ title, slug })).trim();
    const identity = gameId || slug;
    if (identity && seen.has(identity)) duplicateArticleGames.push({ news_id: item.id || null, game_id: gameId || null, slug });
    if (identity) seen.add(identity);

    if (!gameId || gameId.startsWith('news_game_')) temporary.push({ news_id: item.id || null, game_id: gameId || null, slug, title, hashtag });
    if (!slug || !title || !hashtag) continue;
    uniqueGames.set(gameId || slug, { game_id: gameId || null, slug, title, hashtag });

    const hashtagNormalized = hashtagKey(hashtag);
    const previousOwner = hashtagOwner.get(hashtagNormalized);
    if (previousOwner && previousOwner.game_id !== gameId) {
      collisions.push({ hashtag, first: previousOwner, second: { game_id: gameId, slug, title } });
    } else if (!previousOwner) {
      hashtagOwner.set(hashtagNormalized, { game_id: gameId, slug, title });
    }
    const previousHashtag = gameHashtag.get(gameId);
    if (gameId && previousHashtag && hashtagKey(previousHashtag) !== hashtagNormalized) {
      inconsistent.push({ game_id: gameId, slug, first_hashtag: previousHashtag, second_hashtag: hashtag, news_id: item.id || null });
    } else if (gameId && !previousHashtag) {
      gameHashtag.set(gameId, hashtag);
    }

    const expectedUrl = `game/${slug}/`;
    if (game.pageExists !== true || !fs.existsSync(path.join('game', slug, 'index.html'))) {
      missingPages.push({ news_id: item.id || null, game_id: gameId || null, slug, title, hashtag });
    }
    if (game.pageExists === true && String(game.pageUrl || '') !== expectedUrl) {
      badPageUrls.push({ news_id: item.id || null, game_id: gameId || null, slug, actual: game.pageUrl || '', expected: expectedUrl });
    }
    if (productionRef && (!existsAtRef(`game/${slug}/index.html`) || !existsAtRef(`data/drafts/${slug}.json`))) {
      productionMissingPages.push({ game_id: gameId || null, slug, title, hashtag });
    }
  }

  const reasons = Array.isArray(item?.gameReviewReasons) ? item.gameReviewReasons : [];
  if (reasons.some(reason => explicitResolutionReasons.has(reason))) {
    unresolvedExplicit.push({ news_id: item.id || null, title: item.titleRu || item.titleEn || item.title || '', reasons, candidates: item.gameCandidates || [] });
  }
}

const dedupeBy = (values, key) => [...new Map(values.map(value => [key(value), value])).values()];
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  production_ref: productionRef || null,
  articles: items.length,
  articles_with_games: articlesWithGames,
  game_references: gameReferences,
  unique_games: uniqueGames.size,
  unique_hashtags: hashtagOwner.size,
  collisions,
  inconsistent_game_hashtags: inconsistent,
  duplicate_article_games: duplicateArticleGames,
  temporary_game_references: dedupeBy(temporary, item => `${item.game_id}:${item.slug}`),
  missing_staging_pages: dedupeBy(missingPages, item => item.game_id || item.slug),
  missing_production_pages: dedupeBy(productionMissingPages, item => item.game_id || item.slug),
  bad_page_urls: badPageUrls,
  unresolved_explicit_game_context: unresolvedExplicit
};

fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const blocking = collisions.length + inconsistent.length + duplicateArticleGames.length + temporary.length + badPageUrls.length + unresolvedExplicit.length
  + (productionRef ? report.missing_production_pages.length : report.missing_staging_pages.length);
console.log(`[news/hashtag-audit] ${items.length} articles; ${uniqueGames.size} canonical games; ${hashtagOwner.size} unique hashtags; ${report.missing_staging_pages.length} staging pages missing; ${report.missing_production_pages.length} production pages missing; ${blocking} blocking findings.`);
if (strict && blocking) process.exit(1);
