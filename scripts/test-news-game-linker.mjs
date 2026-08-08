import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildGameReviewQueue,
  canonicalSourceUrl,
  enrichNewsItems,
  loadGameCatalog,
  mergeExistingNewsItems,
  publicationFieldsInTimeZone,
  resolveNewsGames
} from './lib/news-game-linker.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-news-games-'));
await fs.mkdir(path.join(root, 'data'), { recursive: true });
for (const slug of ['alpha-game', 'beta-game', 'control', 'marathon', 'doom']) {
  await fs.mkdir(path.join(root, 'game', slug), { recursive: true });
  await fs.writeFile(path.join(root, 'game', slug, 'index.html'), '<!doctype html>');
}
await fs.writeFile(path.join(root, 'data/catalog-visible.json'), JSON.stringify([
  { slug: 'alpha-game', title: 'Alpha Game', steam_appid: 101 },
  { slug: 'beta-game', title: 'Beta Game', steam_appid: 202 },
  { slug: 'control', title: 'Control' },
  { slug: 'marathon', title: 'Marathon' },
  { slug: 'doom', title: 'DOOM' },
  { slug: 'future-game', title: 'Future Game' }
]));
await fs.writeFile(path.join(root, 'data/news-game-aliases.json'), JSON.stringify({
  schemaVersion: 1,
  games: {
    'alpha-game': { aliases: ['Alpha: The Game', 'Shared Alias'], abbreviations: ['AG1'] },
    'beta-game': { aliases: ['Shared Alias'] },
    'future-game': { aliases: ['Future Project'] }
  },
  series: { 'Shared Alias': ['alpha-game', 'beta-game'] }
}));
await fs.writeFile(path.join(root, 'data/news-game-overrides.json'), JSON.stringify({
  schemaVersion: 1,
  items: { manual: { games: ['beta-game'], status: 'linked', reviewedAt: '2026-08-06T00:00:00Z' } }
}));

const catalog = await loadGameCatalog({ root });
assert.equal(catalog.canonicalRegistry, true, 'News catalog must come from the canonical Game Registry.');
assert.equal(catalog.games.length, 6);
assert.equal(new Set(catalog.games.map(game => game.gameId)).size, 6, 'Every news target must have one canonical game ID.');

const one = resolveNewsGames({ id: 'one', title: 'Alpha Game получила обновление' }, catalog);
assert.deepEqual(one.games.map(game => game.slug), ['alpha-game']);
assert.equal(one.gameIds[0], one.games[0].gameId);
assert.match(one.games[0].gameId, /^game_/);
assert.equal(one.games[0].pageUrl, 'game/alpha-game/');

const multiple = resolveNewsGames({ id: 'multiple', title: 'Alpha Game и Beta Game появятся на выставке' }, catalog);
assert.deepEqual(multiple.games.map(game => game.slug).sort(), ['alpha-game', 'beta-game']);
assert.equal(multiple.gameIds.length, 2);

const abbreviation = resolveNewsGames({ id: 'abbr', title: 'AG1 выйдет осенью' }, catalog);
assert.deepEqual(abbreviation.games.map(game => game.slug), ['alpha-game']);

const external = resolveNewsGames({ id: 'external', title: 'Большое обновление', externalGameIds: { steam: 202 } }, catalog);
assert.deepEqual(external.games.map(game => game.slug), ['beta-game']);
assert.equal(external.games[0].gameId, catalog.games.find(game => game.slug === 'beta-game').gameId);

const ambiguous = resolveNewsGames({ id: 'ambiguous', title: 'Новости Shared Alias' }, catalog);
assert.equal(ambiguous.games.length, 0, 'Ambiguous series/alias must not create a false public link.');
assert.equal(ambiguous.gameReviewStatus, 'needs-review');
assert.equal(ambiguous.gameCandidates.some(candidate => candidate.possibleGameIds.length === 2), true, 'Review candidates must carry canonical IDs.');

const singleWordHeadline = resolveNewsGames({ id: 'headline-word', title: 'Marathon получила новый трейлер' }, catalog);
assert.deepEqual(singleWordHeadline.games.map(game => game.slug), ['marathon'], 'A distinctive canonical one-word game title in the headline should link automatically.');
assert.equal(singleWordHeadline.games[0].matchedBy, 'headline-single-word');

const doomHeadline = resolveNewsGames({
  id: 'doom-headline',
  title: '«Они принципиально не понимают искусство» — разработчики Doom раскритиковали Xbox после увольнений'
}, catalog);
assert.deepEqual(doomHeadline.games.map(game => game.slug), ['doom'], 'The Doom article must resolve to the canonical DOOM game, not to a quoted prose fragment.');
assert.equal(doomHeadline.games[0].matchedBy, 'headline-single-word');

const singleWordSummary = resolveNewsGames({ id: 'summary-word', title: 'Разработчики рассказали о тренировках', summary: 'В интервью упомянули Marathon.' }, catalog);
assert.equal(singleWordSummary.games.length, 0, 'A one-word title mentioned only in summary text must stay conservative.');

const singleWord = resolveNewsGames({ id: 'word', title: 'Developers improve control settings' }, catalog);
assert.equal(singleWord.games.length, 0, 'A generic one-word occurrence must not link the game Control.');

const missingPage = resolveNewsGames({ id: 'missing', game: 'Future Game', title: 'Future Project announced' }, catalog);
assert.equal(missingPage.games[0].pageExists, false);
assert.equal(missingPage.games[0].pageUrl, '', 'Missing game pages must never produce public links.');
assert.match(missingPage.games[0].gameId, /^game_/);
assert.equal(missingPage.gameReviewStatus, 'needs-review');

const manual = resolveNewsGames({ id: 'manual', title: 'Unclear project' }, catalog, {
  items: { manual: { games: ['beta-game'], status: 'linked' } }
});
assert.deepEqual(manual.games.map(game => game.slug), ['beta-game']);
assert.equal(manual.games[0].manual, true);
assert.match(manual.games[0].gameId, /^game_/);
assert.equal(manual.gameReviewStatus, 'manual');

const enriched = await enrichNewsItems([
  { id: 'manual', primaryUrl: 'https://example.test/manual', publishedAt: '2026-08-05T22:30:00Z', title: 'Unclear project' },
  { id: 'missing', primaryUrl: 'https://example.test/missing', publishedAt: '2026-08-05T10:00:00Z', game: 'Future Game', title: 'Future Project announced' }
], { root, catalog });
assert.equal(enriched[0].publishedDay, '2026-08-06');
assert.deepEqual(enriched[0].games.map(game => game.slug), ['beta-game'], 'Repository override must survive every enrichment run.');
assert.deepEqual(enriched[0].gameIds, [enriched[0].games[0].gameId]);
assert.equal(buildGameReviewQueue(enriched).count, 1);
assert.equal(buildGameReviewQueue(enriched).items[0].gameIds.length, 1);

const merged = mergeExistingNewsItems(
  [{ id: 'stable', url: 'https://example.test/story?id=7&utm_source=old', title: 'Old', firstSeenAt: '2026-08-01T00:00:00Z' }],
  [
    { id: 'stable', url: 'https://example.test/story?id=7', title: 'Updated', publishedAt: '2026-08-06T10:00:00Z' },
    { id: 'duplicate', url: 'https://example.test/story?id=7#copy', title: 'Duplicate', publishedAt: '2026-08-06T09:00:00Z' }
  ],
  { now: '2026-08-06T11:00:00Z' }
);
assert.equal(merged.length, 1, 'Tracking and fragment variants must update one record, not create duplicates.');
assert.equal(merged[0].title, 'Updated');
assert.equal(merged[0].firstSeenAt, '2026-08-01T00:00:00Z');
assert.equal(canonicalSourceUrl('https://example.test/story?utm_source=x&id=7#top'), 'https://example.test/story?id=7');
assert.deepEqual(publicationFieldsInTimeZone('2026-08-05T22:30:00Z', { timeZone: 'Europe/Moscow' }).publishedDay, '2026-08-06');

await fs.rm(root, { recursive: true, force: true });
console.log('News canonical Game Registry linking, headline matching, ambiguity, page existence, deduplication and manual override tests passed.');
