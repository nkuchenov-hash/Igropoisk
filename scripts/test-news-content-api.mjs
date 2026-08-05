import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const apiSource = fs.readFileSync('features/news/content-api/index.js', 'utf8');
const requested = [];
const failedPaths = new Set();

function item(id, url, overrides = {}) {
  return {
    id,
    primaryUrl: url,
    publishedAt: '2026-08-05T07:00:00Z',
    title: `English ${id}`,
    summary: `Summary ${id}`,
    image: `assets/news/${String(id).replace(/[^a-f0-9]/gi, 'a').padEnd(16, 'a').slice(0, 16)}.jpg`,
    mediaSourceCount: 1,
    primarySource: 'Example',
    sources: [{ name: 'Example' }],
    ...overrides
  };
}

const curated = Array.from({ length: 12 }, (_, index) => item(
  `curated${index}`,
  `https://example.test/curated/${index}`,
  {
    titleRu: `Подборка ${index}`,
    summaryRu: `Описание ${index}`,
    image: `assets/news/${index.toString(16).padStart(16, '0')}.jpg`
  }
));

const payloads = new Map([
  ['/Igropoisk/data/news-events.json', [
    item('eventa', 'https://example.test/story/a', { mediaSourceCount: 3, trendScore: 500 }),
    item('regional', 'https://example.test/story/regional', {
      titleRu: 'Региональная новость',
      summaryRu: 'Региональное описание',
      regionalEligible: true,
      regions: ['cis'],
      regionalScore: 250,
      image: 'assets/news/1111111111111111.jpg'
    }),
    item('invalid', 'https://example.test/story/invalid', { titleRu: 'Ошибка', image: 'remote.jpg' })
  ]],
  ['/Igropoisk/data/news.json', [
    item('legacya', 'https://example.test/story/a', {
      titleRu: 'Старая версия новости',
      summaryRu: 'Старое описание',
      mediaSourceCount: 1,
      image: 'assets/news/2222222222222222.jpg'
    })
  ]],
  ['/Igropoisk/data/publisher-news.json', [
    item('official', 'https://example.test/story/official', {
      titleRu: 'Официальная новость',
      summaryRu: 'Официальное описание',
      publisher: 'Studio',
      image: 'assets/publisher-news/3333333333333333.jpg'
    })
  ]],
  ['/Igropoisk/data/news-home-ru.json', curated]
]);

const quietConsole = Object.freeze({ log() {}, warn() {}, error() {} });
const context = {
  window: {
    IgropoiskNewsTranslationsRu: {
      eventa: ['Переведённая новость', 'Переведённое описание']
    }
  },
  document: {
    currentScript: { src: 'https://example.test/Igropoisk/features/news/content-api/index.js' },
    baseURI: 'https://example.test/Igropoisk/',
    documentElement: { lang: 'ru' }
  },
  navigator: { languages: ['ru-RU'], language: 'ru-RU' },
  localStorage: { getItem() { return null; } },
  console: quietConsole,
  URL,
  Intl,
  Date,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Promise,
  fetch: async input => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (failedPaths.has(url.pathname)) return { ok: false, status: 503, json: async () => ({}) };
    if (!payloads.has(url.pathname)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => payloads.get(url.pathname) };
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(apiSource, context, { filename: 'features/news/content-api/index.js' });

const api = context.window.IgropoiskNewsContent;
assert.ok(api, 'Content API must be published.');
assert.equal(api.version, 1);
assert.equal(api.sources.length, 3);
assert.ok(Object.isFrozen(api));
assert.ok(Object.isFrozen(api.sources));

const all = await api.getAll({ lang: 'ru' });
assert.equal(all.length, 3, 'Invalid records and duplicate URLs must be removed.');
assert.equal(all.find(entry => entry.primaryUrl.endsWith('/a')).titleRu, 'Переведённая новость');
assert.equal(all.find(entry => entry.primaryUrl.endsWith('/official')).type, 'official');
assert.ok(Object.isFrozen(all));
assert.equal(api.health().status, 'ready');
assert.equal(api.health().sources.length, 3);

const afterFirstLoad = requested.length;
await api.getAll({ lang: 'ru' });
assert.equal(requested.length, afterFirstLoad, 'Repeated reads must use the API cache.');

const home = await api.getHome({ lang: 'ru' });
assert.equal(home.length, 12, 'The existing curated home feed must remain authoritative.');
assert.equal(home[0].titleRu, 'Подборка 0');

failedPaths.add('/Igropoisk/data/news.json');
api.invalidate();
const degraded = await api.getAll({ lang: 'ru', force: true });
assert.equal(degraded.length, 3, 'One unavailable source must not disable the whole news feed.');
assert.equal(api.health().status, 'degraded');
assert.equal(api.health().sources.find(source => source.id === 'legacy-news').status, 'error');

failedPaths.add('/Igropoisk/data/news-events.json');
failedPaths.add('/Igropoisk/data/publisher-news.json');
api.invalidate();
await assert.rejects(() => api.getAll({ lang: 'ru', force: true }), /All news sources are unavailable/);
assert.equal(api.health().status, 'error');

console.log('News Content API contract test passed.');
