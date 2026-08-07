import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('features/news/archive-page/model.js', 'utf8');
const context = { window: {}, globalThis: {}, URL, URLSearchParams, Intl, Date, Map, Set, Object, Array, String, Number };
context.globalThis = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'features/news/archive-page/model.js' });
const model = context.window.IgropoiskNewsArchiveModel;
assert.ok(model, 'Archive model must be published.');

const items = [
  { id: 'old', primaryUrl: 'https://example.test/old', publishedAt: '2025-12-31T20:00:00Z', publishedDay: '2025-12-31', games: [{ slug: 'older-game' }] },
  { id: 'morning', primaryUrl: 'https://example.test/a', publishedAt: '2026-08-06T07:00:00Z', publishedDay: '2026-08-06', games: [{ slug: 'gta-vi' }] },
  { id: 'evening', primaryUrl: 'https://example.test/b', publishedAt: '2026-08-06T18:00:00Z', publishedDay: '2026-08-06', games: [{ slug: 'gta-vi' }, { slug: 'max-payne-3' }] },
  { id: 'previous-day', primaryUrl: 'https://example.test/c', publishedAt: '2026-08-05T14:00:00Z', publishedDay: '2026-08-05', games: [{ slug: 'max-payne-3' }] },
  { id: 'duplicate', primaryUrl: 'https://example.test/b?utm_source=copy#top', publishedAt: '2026-08-06T18:00:00Z', publishedDay: '2026-08-06', games: [{ slug: 'gta-vi' }] }
];

const groups = model.groupByCalendarDay(items);
assert.deepEqual(Array.from(groups, group => group.key), ['2026-08-06', '2026-08-05', '2025-12-31'], 'Days must be reverse chronological.');
assert.deepEqual(Array.from(groups[0].items, item => item.id), ['evening', 'morning'], 'Items inside a day must be ordered by publication time.');
assert.equal(groups.flatMap(group => group.items).length, 4, 'Canonical duplicate URLs must appear once.');
assert.equal(model.formatDayHeading('2026-08-06', { currentYear: 2026, lang: 'ru' }), '6 августа');
assert.equal(model.formatDayHeading('2025-12-31', { currentYear: 2026, lang: 'ru' }), '31 декабря 2025');
assert.deepEqual(Array.from(model.filterByGame(items, 'gta-vi'), item => item.id), ['morning', 'evening', 'duplicate']);
assert.equal(model.filterFromSearch('?page=news&game=GTA-VI'), 'gta-vi');
assert.equal(model.calendarDayKey({ publishedAt: '2026-08-05T22:30:00Z' }), '2026-08-06', 'Fallback grouping must use the fixed editorial timezone.');

console.log('News archive chronology, grouping, deduplication and game filter tests passed.');
