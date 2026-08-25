import assert from 'node:assert/strict';
import { buildMediaCacheRetentionPlan } from './prune-news-media-cache.mjs';

const now = Date.parse('2026-08-25T12:00:00.000Z');
const objects = [
  { key: 'news/media/fresh.webp', size: 100, lastModified: '2026-08-24T12:00:00.000Z' },
  { key: 'news/media/seven-days.webp', size: 200, lastModified: '2026-08-18T12:00:00.000Z' },
  { key: 'news/media/old.webp', size: 300, lastModified: '2026-08-17T11:59:59.000Z' },
  { key: 'news/media/protected-old.webp', size: 400, lastModified: '2026-08-01T00:00:00.000Z' },
  { key: 'news/media/unknown-date.webp', size: 500, lastModified: '' },
  { key: 'other-module/untouched.webp', size: 900, lastModified: '2020-01-01T00:00:00.000Z' }
];

const plan = buildMediaCacheRetentionPlan(objects, new Set(['news/media/protected-old.webp']), {
  mediaPrefix: 'news/media',
  maxAgeDays: 7,
  now
});

assert.equal(plan.cutoff, '2026-08-18T12:00:00.000Z');
assert.deepEqual(plan.removedObjects.map(item => item.key), ['news/media/old.webp']);
assert.ok(plan.retainedObjects.some(item => item.key === 'news/media/fresh.webp'));
assert.ok(plan.retainedObjects.some(item => item.key === 'news/media/seven-days.webp'));
assert.ok(plan.retainedObjects.some(item => item.key === 'news/media/protected-old.webp'), 'A fresh story may protect an older content-hash object that it reuses.');
assert.ok(plan.retainedObjects.some(item => item.key === 'news/media/unknown-date.webp'), 'Unknown timestamps must fail safe and remain cached.');
assert.ok(plan.removedObjects.every(item => item.key.startsWith('news/media/')), 'Media cache GC must never cross the news/media namespace.');
assert.equal(plan.totalBytes, 1500);
assert.equal(plan.removedBytes, 300);

console.log('Seven-day news media cache retention tests passed.');
