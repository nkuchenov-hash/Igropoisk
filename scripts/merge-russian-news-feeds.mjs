import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';

const defaultOutput = 'data/news.json';
const imageDirectory = 'assets/news';
const maxAgeHours = 96;
const maxPerSource = 4;
const imageConcurrency = 6;
const userAgent = 'IgropoiskNativeRussianNews/1.2 (+https://github.com/nkuchenov-hash/Igropoisk)';

export const nativeRussianFeeds = Object.freeze([
  { source: 'StopGame', url: 'https://rss.stopgame.ru/rss_news.xml', weight: 1.12 },
  { source: 'GoHa.Ru', url: 'https://www.goha.ru/rss/videogames', weight: 1.08 },
  { source: '3DNews', url: 'https://3dnews.ru/games/rss/', weight: 1.07 },
  { source: 'VGTimes', url: 'https://vgtimes.ru/rss.xml', weight: 1.06 },
  { source: 'Kanobu', url: 'https://kanobu.ru/rss/news.full.xml', weight: 1.05 },
  { source: 'App2Top', url: 'https://app2top.ru/rss', weight: 1.04 },
  { source: 'Игромания', url: 'https://www.igromania.ru/rss/news-game.rss', weight: 1.03 }
]);

function decode(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&minus;/g, '−').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function strip(value = '') {
  return decode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decode(match[1]).trim();
  }
  return '';
}

function attribute(text, name) {
  const match = String(text).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decode(match[1]).trim() : '';
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${search ? `?${search}` : ''}`;
  } catch {
    return String(value || '').trim();
  }
}

function feedImage(block, feedUrl) {
  const candidates = [];
  for (const name of ['media:content', 'media:thumbnail', 'enclosure']) {
    for (const match of String(block).matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))) {
      const tagText = match[0];
      const type = attribute(tagText, 'type').toLowerCase();
      const medium = attribute(tagText, 'medium').toLowerCase();
      if (name === 'enclosure' && type && !type.startsWith('image/')) continue;
      if (medium && medium !== 'image') continue;
      candidates.push(attribute(tagText, 'url') || attribute(tagText, 'href'));
    }
  }
  const description = tag(block, ['description', 'summary', 'content:encoded', 'content']);
  for (const match of String(description).matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) candidates.push(decode(match[1]));
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, feedUrl);
    if (url) return url;
  }
  return '';
}

export function parseNativeRussianFeed(xml, feed, { now = Date.now() } = {}) {
  const blocks = [
    ...(String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];
  const cutoff = now - maxAgeHours * 3600e3;

  return blocks.map(block => {
    const title = strip(tag(block, ['title']));
    const linkTag = block.match(/<link\b[^>]*>/i)?.[0] || '';
    const rawUrl = strip(tag(block, ['link'])) || attribute(linkTag, 'href');
    const url = absoluteUrl(rawUrl, feed.url);
    const summary = strip(tag(block, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 700);
    const rawDate = strip(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const timestamp = Date.parse(rawDate || '');
    if (!title || !url || !Number.isFinite(timestamp) || timestamp < cutoff || timestamp > now + 3600e3) return null;
    if (!isLikelyNewsContent({ title, summary, url })) return null;

    const publishedAt = new Date(timestamp).toISOString();
    const canonical = canonicalUrl(url);
    const id = createHash('sha1').update(canonical || `${feed.source}-${title}`).digest('hex').slice(0, 16);
    return {
      id,
      title,
      summary: summary || title,
      publishedAt,
      source: feed.source,
      language: 'ru',
      url,
      image: '',
      imageSourceUrl: feedImage(block, feed.url),
      imageCacheStatus: 'pending',
      trendScore: 110 * Number(feed.weight || 1),
      sourceCount: 1,
      sources: [feed.source],
      discussionMentions: 0,
      type: 'industry',
      official: false,
      titleRu: title,
      titleEn: title,
      summaryRu: summary || title,
      summaryEn: summary || title,
      localizationStatus: 'source-ru',
      regions: [],
      globalEligible: true,
      regionalEligible: false,
      globalScore: 350 * Number(feed.weight || 1),
      regionalScore: 0,
      mainEligible: true,
      superImportant: false,
      selectionReason: 'native-russian-professional-feed',
      homeUntil: new Date(timestamp + 72 * 3600e3).toISOString(),
      canonicalUrl: canonical,
      games: [],
      gameIds: [],
      gameCandidates: [],
      gameReviewStatus: 'unmatched',
      gameReviewReasons: []
    };
  }).filter(Boolean).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, maxPerSource);
}

async function fetchText(url, timeoutMs = 8000, accept = 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return { text: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

function articleImage(html, articleUrl) {
  const metas = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    for (const meta of metas) {
      const name = (attribute(meta, 'property') || attribute(meta, 'name')).toLowerCase();
      if (name !== key) continue;
      const candidate = absoluteUrl(attribute(meta, 'content'), articleUrl);
      if (candidate) return candidate;
    }
  }
  const links = String(html).match(/<link\b[^>]*>/gi) || [];
  for (const link of links) {
    if (attribute(link, 'rel').toLowerCase() !== 'image_src') continue;
    const candidate = absoluteUrl(attribute(link, 'href'), articleUrl);
    if (candidate) return candidate;
  }
  return '';
}

function imageExtension(contentType = '', imageUrl = '') {
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  const byType = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };
  if (byType[type]) return byType[type];
  try {
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {}
  return '';
}

async function downloadImage(imageUrl, item, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(imageUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    headers: {
      'user-agent': userAgent,
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
      referer: item.url
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`not an image: ${contentType || 'unknown'}`);
  const extension = imageExtension(contentType, response.url || imageUrl);
  if (!extension) throw new Error(`unsupported image type: ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes.length > 20 * 1024 * 1024) throw new Error(`invalid image size: ${bytes.length}`);
  const filename = `${item.id}${extension}`;
  await fs.writeFile(path.join(imageDirectory, filename), bytes);
  return { image: `assets/news/${filename}`, imageSourceUrl: response.url || imageUrl, imageCacheStatus: 'cached' };
}

async function hydrateImage(item, { fetchImpl = globalThis.fetch } = {}) {
  let finalUrl = item.url;
  let imageUrl = item.imageSourceUrl || '';
  try {
    if (!imageUrl) {
      const article = await fetchText(item.url, 8000, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      finalUrl = article.finalUrl;
      imageUrl = articleImage(article.text, finalUrl);
    }
    if (!imageUrl) throw new Error('article has no usable main image');
    return { ...item, url: finalUrl, ...(await downloadImage(imageUrl, { ...item, url: finalUrl }, fetchImpl)) };
  } catch (error) {
    console.error(`[news/native-ru/image] ${item.source} ${item.url}: ${error.message}`);
    return { ...item, url: finalUrl, image: '', imageSourceUrl: imageUrl, imageCacheStatus: 'failed' };
  }
}

async function mapLimit(values, concurrency, worker) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, () => run()));
  return results;
}

export async function mergeNativeRussianFeeds({ outputPath = defaultOutput, now = Date.now(), fetcher = fetchText, hydrateImages = null, fetchImpl = globalThis.fetch } = {}) {
  const payload = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  const existing = Array.isArray(payload) ? payload : (payload.items || []);
  const results = await Promise.all(nativeRussianFeeds.map(async feed => {
    try {
      const fetched = await fetcher(feed.url);
      const xml = typeof fetched === 'string' ? fetched : fetched?.text || '';
      const parsed = parseNativeRussianFeed(xml, feed, { now });
      console.log(`[news/native-ru] ${feed.source}: ${parsed.length} fresh professional items`);
      return { parsed, report: { source: feed.source, status: 'ok', items: parsed.length, url: feed.url } };
    } catch (error) {
      console.error(`[news/native-ru] ${feed.source}: ${error.message}`);
      return { parsed: [], report: { source: feed.source, status: 'error', items: 0, url: feed.url, error: error.message } };
    }
  }));

  const rawAdditions = results.flatMap(result => result.parsed);
  const report = results.map(result => result.report);
  const shouldHydrateImages = hydrateImages ?? fetcher === fetchText;
  await fs.mkdir(imageDirectory, { recursive: true });
  const additions = shouldHydrateImages
    ? await mapLimit(rawAdditions, imageConcurrency, item => hydrateImage(item, { fetchImpl }))
    : rawAdditions;

  const byUrl = new Map();
  for (const item of [...additions, ...existing]) {
    const key = canonicalUrl(item.canonicalUrl || item.url || item.primaryUrl || '') || String(item.id || '');
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, item);
  }
  const merged = [...byUrl.values()].sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  const output = Array.isArray(payload)
    ? merged
    : {
        ...payload,
        generatedAt: new Date(now).toISOString(),
        updateFrequency: 'hourly',
        evaluationWindow: 'rolling 96 hours; homepage requires 8/12 within 72 hours',
        sourceRussianItemCount: Number(payload.sourceRussianItemCount || 0) + additions.length,
        localizedItemCount: Number(payload.localizedItemCount || existing.length) + additions.length,
        nativeRussianProfessionalFeeds: report,
        nativeRussianProfessionalItemCount: additions.length,
        nativeRussianImagesCached: additions.filter(item => item.imageCacheStatus === 'cached').length,
        nativeRussianImagesFailed: additions.filter(item => item.imageCacheStatus === 'failed').length,
        items: merged
      };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return { report, additions: additions.length, imagesCached: additions.filter(item => item.imageCacheStatus === 'cached').length, total: merged.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await mergeNativeRussianFeeds();
  console.log(`[news/native-ru] merged ${result.additions} items; cached-images=${result.imagesCached}; total=${result.total}`);
}