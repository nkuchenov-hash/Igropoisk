import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('features/news/content-api/index.js', 'utf8');
const version = 'test-v1';
const storageRoot = `https://storage.yandexcloud.net/igropoisk-content/news/snapshots/${version}/`;
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
  ...overrides
});

const curated = Array.from({ length: 12 }, (_, index) => item(`home-${index}`, `https://example.test/home/${index}`));
const storageFiles = {
  'data/news-events.json': [item('event', 'https://example.test/event')],
  'data/news.json': [item('legacy', 'https://example.test/legacy')],
  'data/publisher-news.json': [item('official', 'https://example.test/official', { type: 'official' })],
  'data/news-home-ru.json': curated
};
const manifest = {
  schemaVersion: 1,
  channel: 'news',
  version,
  files: Object.fromEntries(Object.keys(storageFiles).map(file => [file, { url: `${storageRoot}${file}` }]))
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
      const payload = storageFiles[file];
      return payload
        ? { ok: true, status: 200, json: async () => payload }
        : { ok: false, status: 404, json: async () => ({}) };
    }
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
const primary = await api.getAll({ lang: 'ru' });
assert.equal(primary.length, 3);
assert.equal(api.health().backend, 'object-storage');
assert.equal(api.health().version, version);
assert.ok(primary.every(entry => entry.image.startsWith('https://storage.yandexcloud.net/igropoisk-content/news/media/')));
assert.equal(requested.some(url => url.includes('/Igropoisk/data/')), false, 'Repository must not be read while the storage snapshot is complete.');
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

console.log('News Object Storage primary and repository fallback test passed.');
