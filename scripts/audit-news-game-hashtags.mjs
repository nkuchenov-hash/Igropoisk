import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalGameHashtag, hashtagKey } from './lib/news-game-hashtag.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const allowMissingPages = args.includes('--allow-missing-pages');
const refIndex = args.indexOf('--production-ref');
const productionRef = refIndex >= 0 ? String(args[refIndex + 1] || '').trim() : '';
const eventsPath = 'data/news-events.json';
const reportPath = 'tmp/news-game-hashtag-audit.json';
const explicitResolutionReasons = new Set([
  'unknown-explicit-game', 'ambiguous-explicit-name', 'ambiguous-alias', 'manual-game-not-found',
  'unverified-primary-game', 'ambiguous-primary-game-verification'
]);

const payload = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);
const hashtagOwner = new Map();
const gameHashtag = new Map();
const uniqueGames = new Map();
const collisions = [];
const inconsistent = [];
const temporary = [];
const unverified = [];
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

function readJsonAtRef(relative) {
  if (!productionRef) {
    try { return JSON.parse(fs.readFileSync(relative, 'utf8')); } catch { return null; }
  }
  const result = spawnSync('git', ['show', `${productionRef}:${relative.replaceAll('\\', '/')}`], { encoding: 'utf8' });
  if (result.status !== 0 || !String(result.stdout || '').trim()) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function isLinkableAtRef(slug) {
  if (!existsAtRef(`game/${slug}/index.html`) || !existsAtRef(`data/drafts/${slug}.json`)) return false;
  const draft = readJsonAtRef(`data/drafts/${slug}.json`);
  if (!draft) return false;
  const directNewsShell = draft?.publication?.creator_source === 'news';
  if (directNewsShell && draft?.publication?.editorial_ready !== true) return false;
  return true;
}

function isPendingRoute(game = {}) {
  return game.pageReady === false
    || game.assemblyRequired === true
    || /^game\/pending\/?\?/i.test(String(game.pageUrl || ''));
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
    const storedHashtag = String(game.hashtag || '').trim();
    const isTemporary = !gameId || gameId.startsWith('news_game_');
    const hashtag = storedHashtag || canonicalGameHashtag({ title, slug });
    const pendingRoute = isPendingRoute(game);
    const identity = gameId || slug;
    if (identity && seen.has(identity)) duplicateArticleGames.push({ news_id: item.id || null, game_id: gameId || null, slug });
    if (identity) seen.add(identity);

    if (game.identityVerified !== true) unverified.push({ news_id: item.id || null, game_id: gameId || null, slug, title, hashtag });
    if (isTemporary) temporary.push({
      news_id: item.id || null,
      game_id: gameId || null,
      slug,
      title,
      hashtag,
      verified_external: Boolean(game.verifiedExternal),
      identity_verified: game.identityVerified === true,
      pending_route: pendingRoute
    });

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

    const pageUrl = String(game.pageUrl || '');
    const expectedReadyUrl = `game/${slug}/`;
    const pendingUrlValid = /^game\/pending\/?\?/.test(pageUrl);
    if (pendingRoute || !fs.existsSync(path.join('game', slug, 'index.html'))) {
      missingPages.push({ news_id: item.id || null, game_id: gameId || null, slug, title, hashtag, pending_route: pendingRoute, page_url: pageUrl });
    }
    if (!pendingRoute && game.pageReady !== false && game.pageExists === true && pageUrl !== expectedReadyUrl) {
      badPageUrls.push({ news_id: item.id || null, game_id: gameId || null, slug, actual: pageUrl, expected: expectedReadyUrl });
    }
    if (pendingRoute && !pendingUrlValid) {
      badPageUrls.push({ news_id: item.id || null, game_id: gameId || null, slug, actual: pageUrl, expected: 'game/pending/?slug=<slug>&title=<title>' });
    }
    if (productionRef && !isLinkableAtRef(slug)) {
      productionMissingPages.push({ game_id: gameId || null, slug, title, hashtag, pending_route: pendingRoute, page_url: pageUrl });
    }
  }

  const reasons = Array.isArray(item?.gameReviewReasons) ? item.gameReviewReasons : [];
  if (reasons.some(reason => explicitResolutionReasons.has(reason))) {
    unresolvedExplicit.push({ news_id: item.id || null, title: item.titleRu || item.titleEn || item.title || '', reasons, candidates: item.gameCandidates || [] });
  }
}

const dedupeBy = (values, key) => [...new Map(values.map(value => [key(value), value])).values()];
const missingPageFindings = productionRef
  ? dedupeBy(productionMissingPages, item => item.game_id || item.slug).length
  : dedupeBy(missingPages, item => item.game_id || item.slug).length;
const blockingTemporary = temporary.filter(item => !(allowMissingPages && item.identity_verified && item.verified_external));
const deferredTemporary = temporary.filter(item => allowMissingPages && item.identity_verified && item.verified_external);
const blockingIntegrityFindings = collisions.length + inconsistent.length + duplicateArticleGames.length + unverified.length
  + blockingTemporary.length + badPageUrls.length + (allowMissingPages ? 0 : missingPageFindings);
const report = {
  schema_version: 6,
  generated_at: new Date().toISOString(),
  publication_policy: 'advisory-only-never-block-feed',
  production_ref: productionRef || null,
  allow_missing_pages: allowMissingPages,
  strict_requested: strict,
  articles: items.length,
  articles_with_games: articlesWithGames,
  game_references: gameReferences,
  unique_games: uniqueGames.size,
  unique_hashtags: hashtagOwner.size,
  collisions,
  inconsistent_game_hashtags: inconsistent,
  duplicate_article_games: duplicateArticleGames,
  unverified_game_references: dedupeBy(unverified, item => `${item.news_id}:${item.game_id || item.slug}`),
  temporary_game_references: dedupeBy(temporary, item => `${item.game_id}:${item.slug}`),
  blocking_temporary_game_references: dedupeBy(blockingTemporary, item => `${item.game_id}:${item.slug}`),
  deferred_verified_temporary_games: dedupeBy(deferredTemporary, item => `${item.game_id}:${item.slug}`),
  missing_staging_pages: dedupeBy(missingPages, item => item.game_id || item.slug),
  missing_production_pages: dedupeBy(productionMissingPages, item => item.game_id || item.slug),
  bad_page_urls: badPageUrls,
  unresolved_explicit_game_context: unresolvedExplicit,
  deferred_context_findings: unresolvedExplicit.length,
  missing_page_findings: missingPageFindings,
  blocking_integrity_findings: blockingIntegrityFindings,
  publication_blocked: false
};

fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[news/hashtag-audit] ${items.length} articles; ${uniqueGames.size} game identities; ${hashtagOwner.size} visible hashtags; ${report.unverified_game_references.length} unverified refs; ${report.deferred_verified_temporary_games.length} verified temporary games queued; ${report.missing_production_pages.length} production pages missing/incomplete; ${blockingIntegrityFindings} integrity findings; publication is never blocked.`);
if (strict && blockingIntegrityFindings) {
  console.warn(`[news/hashtag-audit] Strict diagnostics found ${blockingIntegrityFindings} issue(s), but the news feed remains fail-open by product policy.`);
}
