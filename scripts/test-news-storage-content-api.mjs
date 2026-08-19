import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('features/news/content-api/index.js', 'utf8');
const version = 'test-v2';
const storageRoot = `https://storage.yandexcloud.net/igropoisk-content/news/snapshots/${version}/`;
const archiveRoot = 'https://storage.yandexcloud.net/igropoisk-content/news/archive/';
const storageImage = `https://storage.yandexcloud.net/igropoisk-content/news/media/${'a'.repeat(64)}.webp`;
const requested = [];
let storageAvailable = true;

const item = (id, url, overrides = {}) => ({
  id,
  primaryUrl: url,
  publishedAt: '2026-08-05T07:00:00Z',
  titleRu: `Новость ${id}`,
  summaryRu: `Описание ${id}`,
  image: storageImage,
  mediaSourceCount: 3,
  primarySource: 'Example',
  sources: [{ name: 'Example' }],
  globalEligible: true,
  ...overrides
});

const curated = Array.from({ length: 12 }, (_, index) => item(`home-${index}`, `https://example.test/home/${index}`));
const storageFiles = {
  'data/news-events.json': [item('event', 'https://example.test/event')],
  'data/news.json': [item('legacy', 'https://example.test/legacy')],
  'data/publisher-news.json': [item('official', 'https://example.test/official', { type: 'official' })],
  'data/news-home-ru.json': curated
};
const archiveIndex = {
  schemaVersion: 1,
  channel: 'news-archive',
  totalItems: 2,
  months: [
    { month: '2026-08', url: `${archiveRoot}2026/08.json` },
    { month: '2025-08', url: `${archiveRoot}2025/08.json` }
  ]
};
const archiveMonths = {
  '/igropoisk-content/news/archive/2026/08.json': {
    schemaVersion: 1,
    channel: 'news-archive-month',
    month: '2026-08',
    items: [item('event', 'https://example.test/event')]
  },
  '/igropoisk-content/news/archive/2025/08.json': {
    schemaVersion: 1,
    channel: 'news-archive-month',
    month: '2025-08',
    items: [item('old-event', 'https://example.test/old-event', { publishedAt: '2025-08-19T07:00:00Z' })]
  }
};
const manifest = {
  schemaVersion: 2,
  channel: 'news',
  version,
  files: Object.fromEntries(Object.keys(storageFiles).map(file => [file, { url: `${storageRoot}${file}` }])),
  archive: {
    index: { url: `${storageRoot}archive-index.json` }
  }
};
const repositoryFiles = {
  '/Igropoisk/data/news-events.json': [item('fallback-event', 'https://example.test/fallback-event', { image: 'assets/news/1111111111111111.jpg' })],
  '/Igropoisk/data/news.json': [],
  '/Igropoisk/data/publisher-news.json': [],
  '/Igropoisk/data/news-home-ru.json': Array.from({ length: 12 }, (_, index) => item(
    `fallback-home-${index}`,
    `https://example.test/fallback-home/${index}`,
    { image: 'assets/news/1111111111111111.jpg' }
  ))
};

const context = {
  window: {},
  document: {
    currentScript: { src: 'https://example.test/Igropoisk/features/news/content-api/index.js' },
    baseURI: 'https://example.test/Igropoisk/',
    documentElement: { lang: 'ru' }
  },
  navigator: { languages: ['ru-RU'], language: 'ru-RU' },
  localStorage: { getItem() { return null; } },
  console: { log() {}, warn() {}, error() {} },
  URL, Intl, Date, Map, Set, Object, Array, String, Number, Boolean, RegExp, Promise,
  fetch: async input => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.pathname === '/igropoisk-content/news/manifests/current.json') {
      return storageAvailable
        ? { ok: true, status: 200, json: async () => manifest }
        : { ok: false, status: 503, json: async () => ({}) };
    }
    if (url.href.startsWith(storageRoot)) {
      const file = decodeURIComponent(url.pathname.split(`${version}/`)[1]);
      if (file === 'archive-index.json') return { ok: true, status: 200, json: async () => archiveIndex };
      const payload = storageFiles[file];
      return payload
        ? { ok: true, status: 200, json: async () => payload }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    if (archiveMonths[url.pathname]) return { ok: true, status: 200, json: async () => archiveMonths[url.pathname] };
    const payload = repositoryFiles[url.pathname];
    return payload
      ? { ok: true, status: 200, json: async () => payload }
      : { ok: false, status: 404, json: async () => ({}) };
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'features/news/content-api/index.js' });

const api = context.window.IgropoiskNewsContent;
const live = await api.getAll({ lang: 'ru' });
assert.equal(live.length, 1, 'The compact live event stream must stay authoritative for current-feed reads.');
assert.equal(live[0].id, 'event');
assert.equal(api.health().backend, 'object-storage');
assert.equal(api.health().version, version);
assert.ok(live.every(entry => entry.image.startsWith('https://storage.yandexcloud.net/igropoisk-content/news/media/')));
assert.equal(requested.some(url => url.includes('/Igropoisk/data/')), false, 'Repository must not be read while the storage snapshot is complete.');

const archive = await api.getArchive({ lang: 'ru' });
assert.equal(archive.length, 2, 'Monthly archive reads must include both current and historical months.');
assert.ok(archive.some(entry => entry.id === 'old-event'), 'A news item from the previous year must remain readable.');
assert.ok(requested.some(url => url.includes('/news/archive/2025/08.json')), 'Historical months must be loaded from stable archive objects.');

const home = await api.getHome({ lang: 'ru' });
assert.equal(home.length, 12);

storageAvailable = false;
api.invalidate();
requested.length = 0;
const fallback = await api.getAll({ lang: 'ru', force: true });
assert.equal(fallback.length, 1);
assert.equal(fallback[0].id, 'fallback-event');
assert.equal(api.health().backend, 'repository-fallback');
assert.match(api.health().fallbackReason, /news manifest: 503/);
assert.ok(requested.some(url => url.includes('/Igropoisk/data/news-events.json')));

console.log('News Object Storage compact live feed, monthly archive, and repository fallback test passed.');
