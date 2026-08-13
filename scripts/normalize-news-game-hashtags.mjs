import fs from 'node:fs/promises';
import { canonicalGameHashtag, hashtagKey } from './lib/news-game-hashtag.mjs';
import { loadCanonicalNewsCatalog } from './lib/news-game-registry-adapter.mjs';

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
let duplicateReferencesRemoved = 0;

function canonicalizeGame(raw = {}) {
  const gameId = String(raw.gameId || raw.game_id || '').trim();
  const slug = String(raw.slug || '').trim().toLowerCase();
  const canonical = byId.get(gameId) || bySlug.get(slug) || null;
  const base = canonical
    ? {
        ...raw,
        gameId: canonical.gameId,
        slug: canonical.slug,
        title: canonical.title,
        pageExists: canonical.pageExists,
        pageUrl: canonical.pageExists ? canonical.pageUrl : ''
      }
    : { ...raw, gameId: gameId || null, slug };
  base.hashtag = canonicalGameHashtag(base);
  return { game: base, canonical: Boolean(canonical) };
}

const normalizedItems = items.map(item => {
  const seen = new Set();
  const games = [];
  for (const raw of Array.isArray(item?.games) ? item.games : []) {
    if (!raw || typeof raw !== 'object') continue;
    gameReferences += 1;
    const { game, canonical } = canonicalizeGame(raw);
    if (canonical) canonicalReferences += 1;
    else if (String(game.gameId || '').startsWith('news_game_')) temporaryReferences += 1;
    const identity = String(game.gameId || game.slug || game.hashtag || '').trim();
    if (!identity || seen.has(identity)) {
      duplicateReferencesRemoved += 1;
      continue;
    }
    seen.add(identity);
    games.push(game);

    if (canonical && game.hashtag) {
      const key = hashtagKey(game.hashtag);
      const owner = hashtagOwners.get(key);
      if (owner && owner.gameId !== game.gameId) {
        collisions.push({ hashtag: game.hashtag, game_ids: [owner.gameId, game.gameId], slugs: [owner.slug, game.slug] });
      } else if (!owner) {
        hashtagOwners.set(key, { gameId: game.gameId, slug: game.slug, title: game.title });
      }
    }
  }

  const reasons = new Set(Array.isArray(item?.gameReviewReasons) ? item.gameReviewReasons : []);
  if (games.some(game => game.pageExists === false)) reasons.add('missing-game-page');
  else reasons.delete('missing-game-page');
  return {
    ...item,
    games,
    gameIds: games.map(game => game.gameId).filter(Boolean),
    gameReviewReasons: [...reasons]
  };
});

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  articles: normalizedItems.length,
  game_references: gameReferences,
  canonical_references: canonicalReferences,
  temporary_references: temporaryReferences,
  unique_canonical_hashtags: hashtagOwners.size,
  duplicate_references_removed: duplicateReferencesRemoved,
  collisions
};

await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(Array.isArray(payload) ? normalizedItems : { ...payload, items: normalizedItems }, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (collisions.length) throw new Error(`Canonical news hashtag collision detected: ${collisions.map(item => item.hashtag).join(', ')}`);
console.log(`[news/hashtags] ${normalizedItems.length} articles; ${hashtagOwners.size} unique canonical game hashtags; ${temporaryReferences} temporary game references; ${duplicateReferencesRemoved} duplicates removed.`);
