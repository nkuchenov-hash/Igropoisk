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
let cursor = 0;
let warmed = 0;
let skipped = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= queue.length) return;
    const url = queue[index];
    try {
      const response = await originalFetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36',
          'accept-language': 'en-US,en;q=.9,ru;q=.8',
        },
      });
      if (!response.ok) {
        skipped += 1;
        continue;
      }
      cache.set(url, {
        body: await response.text(),
        status: response.status,
        headers: [...response.headers.entries()],
      });
      warmed += 1;
    } catch {
      // Do not cache failures. The canonical v8 scanner will retry them normally,
      // preserving exhaustive discovery semantics rather than turning warmup errors
      // into false negatives.
      skipped += 1;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

globalThis.fetch = async (input, init) => {
  const key = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
  const cached = cache.get(key);
  if (!cached) return originalFetch(input, init);
  return new Response(cached.body, { status: cached.status, headers: cached.headers });
};

console.log(JSON.stringify({
  slug,
  prefetch: 'review-searches',
  exhaustive_query_urls: queue.length,
  warmed,
  retry_normally: skipped,
  concurrency,
  correctness_policy: 'cache-success-only; failures are retried by canonical scanner',
}, null, 2));
