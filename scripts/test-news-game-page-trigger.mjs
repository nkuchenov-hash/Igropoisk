import assert from 'node:assert/strict';
import { collectNewsGamePageReferences, selectRunnablePageTasks } from './lib/news-game-page-trigger.mjs';

const alpha = { id: 'game_alpha', identity: { slug: { value: 'alpha' }, canonicalTitle: { value: 'Alpha' } } };
const beta = { id: 'game_beta', identity: { slug: { value: 'beta' }, canonicalTitle: { value: 'Beta' } } };
const gamma = { id: 'game_gamma', identity: { slug: { value: 'gamma' }, canonicalTitle: { value: 'Gamma' } } };
const entities = [alpha, beta, gamma];
const api = {
  findById: id => entities.find(entity => entity.id === id) || null,
  findBySlug: slug => entities.find(entity => entity.identity.slug.value === slug) || null
};

const references = collectNewsGamePageReferences({ items: [
  { publishedAt: '2026-08-10T10:00:00Z', games: [{ gameId: 'game_alpha', slug: 'alpha' }], gameIds: ['game_alpha'] },
  { publishedAt: '2026-08-11T10:00:00Z', games: [{ game_id: 'game_alpha', slug: 'alpha' }, { slug: 'beta' }] },
  { publishedAt: '2026-08-12T10:00:00Z', gameIds: ['game_beta'] }
] }, api, { requestedGameIds: ['game_gamma'] });

assert.deepEqual([...references.keys()].sort(), ['game_alpha', 'game_beta', 'game_gamma']);
assert.equal(references.get('game_alpha').mentions, 2, 'A story carrying both games[] and gameIds[] must count once.');
assert.equal(references.get('game_alpha').latestPublishedAt, '2026-08-11T10:00:00Z');
assert.equal(references.get('game_beta').mentions, 2);
assert.equal(references.get('game_gamma').mentions, 0, 'Explicit workflow requests are not additional news mentions.');

const queue = [
  { type: 'build_page', slug: 'regular-high', priority: 900, news_reference: false },
  { type: 'build_page', slug: 'news-a', priority: 500, news_reference: true },
  { type: 'enrich_game', slug: 'news-b', priority: 450, news_reference: true },
  { type: 'build_page', slug: 'regular-low', priority: 100, news_reference: false },
  { type: 'build_review', slug: 'news-review', priority: 999, news_reference: true }
];
const runnable = selectRunnablePageTasks(queue, { regularLimit: 1 });
assert.deepEqual(runnable.map(item => item.slug), ['regular-high', 'news-a', 'news-b']);
assert.equal(runnable.filter(item => item.news_reference).length, 2, 'All news-triggered page tasks must be included alongside the regular page limit.');

console.log('News game-page trigger tests passed.');
