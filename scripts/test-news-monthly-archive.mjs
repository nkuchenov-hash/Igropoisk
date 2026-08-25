import assert from 'node:assert/strict';
import { buildLiveEventsPayload, buildMonthlyArchive, sanitizeImageReferences } from './publish-news-storage.mjs';

const items = [
  { id: 'new-a', publishedAt: '2026-08-19T08:00:00.000Z' },
  { id: 'new-b', publishedAt: '2026-08-18T08:00:00.000Z' },
  { id: 'july', publishedAt: '2026-07-10T08:00:00.000Z' },
  { id: 'old', publishedAt: '2025-08-19T08:00:00.000Z' }
];

const archive = buildMonthlyArchive({ generatedAt: 'fixture', items });
assert.deepEqual([...archive.keys()], ['2026-08', '2026-07', '2025-08']);
assert.deepEqual(archive.get('2026-08').map(item => item.id), ['new-a', 'new-b']);
assert.equal(archive.get('2025-08')[0].id, 'old', 'A previous-year article must remain in its stable month.');

const live = buildLiveEventsPayload(
  { generatedAt: 'fixture', model: 'fixture', items },
  new Date('2026-08-19T09:00:00.000Z'),
  30,
  2
);
assert.deepEqual(live.items.map(item => item.id), ['new-a', 'new-b']);
assert.equal(live.archiveTotalItems, 4);
assert.equal(live.liveWindowDays, 30);
assert.equal(live.storageModel, 'monthly-archive-v1');

const fallbackLive = buildLiveEventsPayload(
  { items },
  new Date('2027-08-19T09:00:00.000Z'),
  30,
  3
);
assert.equal(fallbackLive.items.length, 4, 'A sparse or stale archive must not publish an empty live feed.');
assert.equal(fallbackLive.items[0].id, 'new-a');

const storage = {
  publicUrl(key) { return `https://storage.yandexcloud.net/igropoisk-content/${key}`; }
};
const local = 'assets/news/1111111111111111.jpg';
const firstParty = 'https://storage.yandexcloud.net/igropoisk-content/news/media/abc.webp';
const fallbackUrl = 'https://storage.yandexcloud.net/igropoisk-content/news/media/fallback.svg';
const now = Date.parse('2026-08-25T12:00:00.000Z');
const sanitized = sanitizeImageReferences({ items: [
  { id: 'local', publishedAt: '2026-08-25T10:00:00.000Z', image: local },
  { id: 'first-party', publishedAt: '2026-08-25T09:00:00.000Z', image: firstParty },
  { id: 'third-party', publishedAt: '2026-08-25T08:00:00.000Z', image: 'https://images.example.com/news.jpg' },
  { id: 'missing', publishedAt: '2026-08-25T07:00:00.000Z', image: '' },
  { id: 'expired', publishedAt: '2026-08-10T07:00:00.000Z', image: firstParty }
] }, new Map([[local, '']]), { storage, mediaPrefix: 'news/media', now, mediaCacheDays: 7, fallbackUrl });
assert.equal(sanitized.items[0].image, fallbackUrl, 'A local cache miss must become first-party fallback media instead of blocking publication.');
assert.equal(sanitized.items[1].image, firstParty, 'Fresh first-party cache URLs remain valid during the seven-day window.');
assert.equal(sanitized.items[2].image, fallbackUrl, 'Third-party hotlinks must never leak into the public news snapshot.');
assert.equal(sanitized.items[3].image, fallbackUrl, 'Explicitly missing media becomes the permanent first-party fallback.');
assert.equal(sanitized.items[4].image, fallbackUrl, 'News older than seven days must stop referencing disposable cached media.');

console.log('News monthly archive partition, compact live-window, and media sanitization tests passed.');
