import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';

const defaultOutput = 'data/news.json';
const maxAgeHours = 96;
const maxPerSource = 4;
const userAgent = 'IgropoiskNativeRussianNews/1.1 (+https://github.com/nkuchenov-hash/Igropoisk)';

export const nativeRussianFeeds = Object.freeze([
  { source: 'StopGame', url: 'https://rss.stopgame.ru/rss_news.xml', weight: 1.12 },
  { source: 'GoHa.Ru', url: 'https://www.goha.ru/rss/videogames', weight: 1.08 },
  { source: '3DNews', url: 'https://3dnews.ru/games/rss/', weight: 1.07 },
  { source: 'VGTimes', url: 'https://vgtimes.ru/rss.xml', weight: 1.06 },
  { source: 'Kanobu', url: 'https://kanobu.ru/rss/news.full.xml', weight: 1.05 },
  { source: 'App2Top', url: 'https://app2top.ru/rss', weight: 1.04 },
  // Kept as a non-blocking source because its historical endpoint can disappear;
  // failures never block the Russian pool.
  { source: 'Игромания', url: 'https://www.igromania.ru/rss/news-game.rss', weight: 1.03 }
]);

function decode(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
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

async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5' }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function mergeNativeRussianFeeds({ outputPath = defaultOutput, now = Date.now(), fetcher = fetchText } = {}) {
  const payload = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  const existing = Array.isArray(payload) ? payload : (payload.items || []);

  // Independent professional feeds are fetched concurrently. A dead publisher can
  // cost at most one short timeout, not serialize the entire hourly refresh.
  const results = await Promise.all(nativeRussianFeeds.map(async feed => {
    try {
      const xml = await fetcher(feed.url);
      const parsed = parseNativeRussianFeed(xml, feed, { now });
      console.log(`[news/native-ru] ${feed.source}: ${parsed.length} fresh professional items`);
      return { feed, parsed, report: { source: feed.source, status: 'ok', items: parsed.length, url: feed.url } };
    } catch (error) {
      console.error(`[news/native-ru] ${feed.source}: ${error.message}`);
      return { feed, parsed: [], report: { source: feed.source, status: 'error', items: 0, url: feed.url, error: error.message } };
    }
  }));

  const additions = results.flatMap(result => result.parsed);
  const report = results.map(result => result.report);
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
        items: merged
      };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return { report, additions: additions.length, total: merged.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await mergeNativeRussianFeeds();
  console.log(`[news/native-ru] merged ${result.additions} items; total=${result.total}`);
}
