import fs from 'node:fs/promises';
import { canonicalGameHashtag, hashtagKey } from './lib/news-game-hashtag.mjs';
import { loadCanonicalNewsCatalog } from './lib/news-game-registry-adapter.mjs';
import { newsGameTitleLooksGeneric } from './lib/news-game-title-cleanup.mjs';

const eventsPath = 'data/news-events.json';
const reportPath = 'tmp/news-game-hashtag-normalization.json';

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);
const catalog = await loadCanonicalNewsCatalog();
const byId = new Map(catalog.games.map(game => [game.gameId, game]));
const bySlug = new Map(catalog.games.map(game => [game.slug, game]));
const hashtagOwners = new Map();
const collisions = [];
let gameReferences = 0;
let canonicalReferences = 0;
let temporaryReferences = 0;
let deferredTemporaryReferences = 0;
let missingPageReferences = 0;
let duplicateReferencesRemoved = 0;
let invalidGenericReferencesRemoved = 0;

function pendingGamePageUrl(game = {}) {
  const params = new URLSearchParams();
  const slug = String(game.slug || '').trim().toLowerCase();
  const title = String(game.title || '').trim();
  if (slug) params.set('slug', slug);
  if (title) params.set('title', title);
  return `game/pending/?${params.toString()}`;
}

function canonicalizeGame(raw = {}) {
  const gameId = String(raw.gameId || raw.game_id || '').trim();
  const slug = String(raw.slug || '').trim().toLowerCase();
  const canonical = byId.get(gameId) || bySlug.get(slug) || null;
  const pageReady = Boolean(canonical?.pageExists);
  const base = canonical
    ? {
        ...raw,
        gameId: canonical.gameId,
        slug: canonical.slug,
        title: canonical.title,
        pageExists: true,
        pageReady,
        assemblyRequired: !pageReady,
        pageUrl: pageReady ? canonical.pageUrl : pendingGamePageUrl(canonical)
      }
    : { ...raw, gameId: gameId || null, slug };
  base.hashtag = canonicalGameHashtag(base);
  return { game: base, canonical: Boolean(canonical) };
}

const normalizedItems = items.map(item => {
  const seen = new Set();
  const games = [];
  const reasons = new Set(Array.isArray(item?.gameReviewReasons) ? item.gameReviewReasons : []);

  for (const raw of Array.isArray(item?.games) ? item.games : []) {
    if (!raw || typeof raw !== 'object') continue;
    gameReferences += 1;
    const rawIdentity = String(raw.title || raw.slug || '').trim();
    if (newsGameTitleLooksGeneric(rawIdentity)) {
      invalidGenericReferencesRemoved += 1;
      reasons.add('invalid-generic-game-identity-removed');
      continue;
    }

    const { game, canonical } = canonicalizeGame(raw);
    if (newsGameTitleLooksGeneric(game.title || game.slug || '')) {
      invalidGenericReferencesRemoved += 1;
      reasons.add('invalid-generic-game-identity-removed');
      continue;
    }
    const temporary = !canonical && String(game.gameId || '').startsWith('news_game_');
    if (canonical) canonicalReferences += 1;

    const identity = String(game.gameId || game.slug || game.hashtag || '').trim();
    if (!identity || seen.has(identity)) {
      duplicateReferencesRemoved += 1;
      continue;
    }
    seen.add(identity);

    if (temporary) {
      temporaryReferences += 1;
      deferredTemporaryReferences += 1;
      game.pageExists = true;
      game.pageReady = false;
      game.assemblyRequired = true;
      game.pageUrl = pendingGamePageUrl(game);
      game.hashtag = canonicalGameHashtag(game);
      games.push(game);
      reasons.add('missing-game-page');
      continue;
    }

    if (canonical && game.pageReady === false) {
      missingPageReferences += 1;
      reasons.add('missing-game-page');
    } else if (!canonical && game.slug) {
      game.pageExists = true;
      game.pageReady = false;
      game.assemblyRequired = true;
      game.pageUrl = pendingGamePageUrl(game);
      game.hashtag = canonicalGameHashtag(game);
      missingPageReferences += 1;
      reasons.add('missing-game-page');
    }

    games.push(game);
    if (game.hashtag) {
      const key = hashtagKey(game.hashtag);
      const owner = hashtagOwners.get(key);
      if (owner && owner.gameId !== game.gameId) {
        collisions.push({ hashtag: game.hashtag, game_ids: [owner.gameId, game.gameId], slugs: [owner.slug, game.slug] });
      } else if (!owner) {
        hashtagOwners.set(key, { gameId: game.gameId, slug: game.slug, title: game.title });
      }
    }
  }

  if (games.some(game => game.assemblyRequired === true || game.pageReady === false)) reasons.add('missing-game-page');
  else reasons.delete('missing-game-page');
  return {
    ...item,
    games,
    gameIds: games.map(game => game.gameId).filter(Boolean),
    gameReviewReasons: [...reasons]
  };
});

const report = {
  schema_version: 6,
  generated_at: new Date().toISOString(),
  articles: normalizedItems.length,
  game_references: gameReferences,
  canonical_references: canonicalReferences,
  temporary_references: temporaryReferences,
  deferred_temporary_references: deferredTemporaryReferences,
  missing_page_references: missingPageReferences,
  preserved_temporary_references: deferredTemporaryReferences,
  unique_canonical_hashtags: hashtagOwners.size,
  duplicate_references_removed: duplicateReferencesRemoved,
  invalid_generic_references_removed: invalidGenericReferencesRemoved,
  collisions
};

await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(Array.isArray(payload) ? normalizedItems : { ...payload, items: normalizedItems }, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (collisions.length) console.warn(`[news/hashtags] ${collisions.length} hashtag collision(s) detected; publication remains fail-open and diagnostics will record them.`);
console.log(`[news/hashtags] ${normalizedItems.length} articles; ${hashtagOwners.size} visible game hashtags; ${temporaryReferences} temporary game references routed to preparing pages; ${missingPageReferences} canonical games routed to preparing pages until assembly completes; ${invalidGenericReferencesRemoved} invalid generic game references removed; ${duplicateReferencesRemoved} duplicates removed.`);
