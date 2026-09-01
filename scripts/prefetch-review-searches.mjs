import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slug = String(process.argv[2] || '').trim();
if (!slug) throw new Error('Missing game slug for review-search prefetch');

const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};
const host = value => {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
};
const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[®™©]/g, '')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const tokens = value => normalize(value).split(' ').filter(token => token.length > 1 || /^\d+$/.test(token));

const draft = read(`data/drafts/${slug}.json`);
if (!draft) throw new Error(`Missing data/drafts/${slug}.json`);
const reviewConfig = read('config/parsers/review-synthesis.json', {});
const title = String(draft.identity?.title || slug).trim();
const year = Number(String(draft.release?.date || draft.release?.date_text || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
const aliases = [...new Set([
  ...(Array.isArray(draft.identity?.aliases) ? draft.identity.aliases : []),
  title,
  title.split(':')[0],
  slug.replace(/-/g, ' '),
].map(value => normalize(value)).filter(value => value.length >= 3))]
  .sort((a, b) => tokens(a).length - tokens(b).length || a.length - b.length);
const queryAlias = aliases[0] || normalize(title);

const extras = [
  { id: 'dtf', name: 'DTF', url: 'https://dtf.ru/games' },
  { id: 'dzen', name: 'Дзен', url: 'https://dzen.ru/' },
  { id: 'vgtimes', name: 'VGTimes', url: 'https://vgtimes.ru/games/' },
  { id: 'vk-play', name: 'VK Play Media', url: 'https://media.vkplay.ru/' },
  { id: 'ixbt-games', name: 'iXBT.games', url: 'https://ixbt.games/' },
  { id: 'gamemag', name: 'GameMAG.ru', url: 'https://gamemag.ru/' },
  { id: 'shazoo', name: 'Shazoo', url: 'https://shazoo.ru/' },
];
const registry = (reviewConfig.sources || [])
  .filter(source => source.enabled !== false && source.family === 'editorial')
  .map(source => ({ id: String(source.id || source.name), name: String(source.name || source.id), url: String(source.url || '') }));
for (const extra of extras) if (!registry.some(source => source.id === extra.id)) registry.push(extra);
const sourceDomain = source => {
  const domain = host(source.url);
  return domain === 'web.archive.org' ? '' : domain;
};

const urls = new Set();
function addSearchUrls(query) {
  const bing = new URL('https://www.bing.com/search');
  bing.searchParams.set('format', 'rss');
  bing.searchParams.set('count', '50');
  bing.searchParams.set('q', query);
  urls.add(bing.href);

  const ddg = new URL('https://html.duckduckgo.com/html/');
  ddg.searchParams.set('q', query);
  urls.add(ddg.href);

  const google = new URL('https://www.google.com/search');
  google.searchParams.set('num', '30');
  google.searchParams.set('q', query);
  urls.add(google.href);
}

for (const source of registry) {
  const domain = sourceDomain(source);
  const queries = domain
    ? [`"${queryAlias}" review site:${domain}`, year ? `"${queryAlias}" ${year} review site:${domain}` : '', `"${queryAlias}" обзор site:${domain}`].filter(Boolean)
    : [`"${queryAlias}" review "${source.name}"`, year ? `"${queryAlias}" ${year} "${source.name}" review` : '', `"${queryAlias}" обзор "${source.name}"`].filter(Boolean);
  for (const query of queries) addSearchUrls(query);

  if (source.id === 'gamespot') urls.add(`https://www.gamespot.com/games/${slug}/reviews/`);
  if (source.id === 'rpgfan') urls.add(`https://www.rpgfan.com/game/${slug}/`);
  if (source.id === 'gamepressure') urls.add(`https://www.gamepressure.com/games/${slug}/z9`);
}

const broadQueries = [...new Set(aliases.slice(0, 3).flatMap(alias => [
  `"${alias}" review`,
  `"${alias}" retrospective`,
  `"${alias}" обзор`,
  `"${alias}" рецензия`,
  year ? `"${alias}" review ${year}` : '',
]).filter(Boolean))].slice(0, 12);
for (const query of broadQueries) addSearchUrls(query);

const originalFetch = globalThis.fetch.bind(globalThis);
const cache = new Map();
const queue = [...urls];
const concurrency = Math.max(1, Math.min(18, Number(process.env.REVIEW_SEARCH_PREFETCH_CONCURRENCY || 18)));
const timeoutMs = Math.max(1000, Math.min(12000, Number(process.env.REVIEW_SEARCH_PREFETCH_TIMEOUT_MS || 6000)));
let warmed = 0;
let initialFailed = 0;
let retryRecovered = 0;
let exhaustedFailures = 0;

function requestOptions() {
  return {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36',
      'accept-language': 'en-US,en;q=.9,ru;q=.8',
    },
  };
}

async function attempt(url) {
  try {
    const response = await originalFetch(url, requestOptions());
    if (!response.ok) return { ok: false, status: response.status || 503, headers: [...response.headers.entries()] };
    return {
      ok: true,
      body: await response.text(),
      status: response.status,
      headers: [...response.headers.entries()],
    };
  } catch (error) {
    return { ok: false, status: 504, headers: [], error: String(error?.message || error || 'network failure') };
  }
}

async function runWave(items, handler) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await handler(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
}

const failed = new Map();
await runWave(queue, async url => {
  const result = await attempt(url);
  if (result.ok) {
    cache.set(url, result);
    warmed += 1;
  } else {
    failed.set(url, result);
    initialFailed += 1;
  }
});

// The canonical scanner previously retried every prefetch failure one-by-one.
// Preserve that second attempt exactly, but execute the retry wave concurrently.
// If both attempts fail, replay the real failed status to v8 instead of making a
// third network request. Coverage and attempt count stay unchanged; only latency
// from serialized timeouts/rate-limits is removed.
await runWave([...failed.keys()], async url => {
  const result = await attempt(url);
  if (result.ok) {
    cache.set(url, result);
    retryRecovered += 1;
    return;
  }
  const status = Number(result.status) >= 400 && Number(result.status) <= 599 ? Number(result.status) : 504;
  cache.set(url, {
    ok: false,
    body: '',
    status,
    headers: [
      ...(result.headers || []),
      ['x-igropoisk-prefetch-exhausted', '1'],
    ],
  });
  exhaustedFailures += 1;
});

globalThis.fetch = async (input, init) => {
  const key = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
  const cached = cache.get(key);
  if (!cached) return originalFetch(input, init);
  return new Response(cached.body || '', { status: cached.status, headers: cached.headers });
};

console.log(JSON.stringify({
  slug,
  prefetch: 'review-searches',
  exhaustive_query_urls: queue.length,
  initial_warmed: warmed,
  initial_failed: initialFailed,
  retry_recovered: retryRecovered,
  exhausted_failures: exhaustedFailures,
  total_network_attempts: queue.length + initialFailed,
  concurrency,
  timeout_ms: timeoutMs,
  correctness_policy: 'all URLs get initial attempt; every initial failure gets the same second attempt as before, concurrently; twice-failed statuses are replayed to canonical scanner without a third request',
}, null, 2));
