import assert from 'node:assert/strict';
import { buildLiveEventsPayload, buildMonthlyArchive } from './publish-news-storage.mjs';

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

console.log('News monthly archive partition and compact live-window tests passed.');
