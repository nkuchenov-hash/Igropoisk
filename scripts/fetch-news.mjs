import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const feeds = [
  { source: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { source: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' },
  { source: 'VGC', url: 'https://www.videogameschronicle.com/feed/' },
  { source: 'GamingOnLinux', url: 'https://www.gamingonlinux.com/article_rss.php' },
  { source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/gaming' }
];

const limit = 36;
const outputPath = path.resolve('data/news.json');
const userAgent = 'IgropoiskNewsBot/1.1 (+https://github.com/nkuchenov-hash/Igropoisk)';

function decodeEntities(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value = '') {
  return decodeEntities(value).replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeEntities(match[1]).trim();
  }
  return '';
}

function attr(block, tagName, attribute) {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function absoluteUrl(value, base) {
  try { return value ? new URL(value, base).href : ''; } catch { return ''; }
}

function isLikelyImage(url) {
  return Boolean(url) && !/\.(?:mp3|mp4|webm|ogg)(?:\?|$)/i.test(url);
}

function imageFromFeedBlock(block, base) {
  const raw = attr(block, 'media:content', 'url')
    || attr(block, 'media:thumbnail', 'url')
    || attr(block, 'enclosure', 'url')
    || tag(block, ['description', 'content:encoded', 'content']).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
    || '';
  const image = absoluteUrl(raw, base);
  return isLikelyImage(image) ? image : '';
}

function imageFromArticle(html, articleUrl) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i)?.[1]
  ];
  for (const candidate of candidates) {
    const image = absoluteUrl(decodeEntities(candidate || ''), articleUrl);
    if (isLikelyImage(image)) return image;
  }
  return '';
}

function parseFeed(xml, feed) {
  const blocks = [...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []), ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])];
  return blocks.map(block => {
    const title = stripHtml(tag(block, ['title']));
    const rawLink = tag(block, ['link']) || attr(block, 'link', 'href');
    const url = absoluteUrl(stripHtml(rawLink), feed.url);
    const description = stripHtml(tag(block, ['description', 'summary', 'content:encoded', 'content']));
    const dateText = stripHtml(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const publishedAt = new Date(dateText || Date.now()).toISOString();
    return {
      id: createHash('sha1').update(url || `${feed.source}-${title}`).digest('hex').slice(0, 16),
      title,
      summary: description.slice(0, 280),
      publishedAt,
      source: feed.source,
      url,
      image: imageFromFeedBlock(block, feed.url),
      imageSource: imageFromFeedBlock(block, feed.url) ? 'feed' : ''
    };
  }).filter(item => item.title && item.url);
}

async function fetchText(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': userAgent } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

async function fetchFeed(feed) {
  try { return parseFeed(await fetchText(feed.url), feed); }
  catch (error) { console.error(`[news] ${feed.source}: ${error.message}`); return []; }
}

async function enrichImage(item) {
  if (item.image) return item;
  try {
    const image = imageFromArticle(await fetchText(item.url, 12000), item.url);
    return { ...item, image, imageSource: image ? 'article-og' : '' };
  } catch (error) {
    console.error(`[news:image] ${item.url}: ${error.message}`);
    return { ...item, image: '', imageSource: '' };
  }
}

const fetched = (await Promise.all(feeds.map(fetchFeed))).flat();
const enriched = await Promise.all(fetched.slice(0, limit * 2).map(enrichImage));
const existing = await fs.readFile(outputPath, 'utf8').then(JSON.parse)
  .then(data => (Array.isArray(data) ? data : data.items || []).map(item => ({ ...item, image: '', imageSource: '' })))
  .catch(() => []);

const byUrl = new Map();
for (const item of [...enriched, ...existing]) {
  if (!item?.url || byUrl.has(item.url)) continue;
  byUrl.set(item.url, item);
}

const items = [...byUrl.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, limit);
if (!items.length) throw new Error('No news items were available from feeds or existing data.');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
console.log(`[news] wrote ${items.length} items; ${items.filter(item => item.image).length} have source-owned images`);
