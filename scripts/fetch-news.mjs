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
const fallbackImages = [
  'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_hero.jpg',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/library_hero.jpg',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/1174180/library_hero.jpg',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_hero.jpg',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/553850/library_hero.jpg'
];

function decodeEntities(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value = '') {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  try { return new URL(value, base).href; } catch { return ''; }
}

function parseFeed(xml, feed) {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];

  return blocks.map((block, index) => {
    const title = stripHtml(tag(block, ['title']));
    const rawLink = tag(block, ['link']) || attr(block, 'link', 'href');
    const url = absoluteUrl(stripHtml(rawLink), feed.url);
    const description = stripHtml(tag(block, ['description', 'summary', 'content:encoded', 'content']));
    const dateText = stripHtml(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const publishedAt = new Date(dateText || Date.now()).toISOString();
    const image = absoluteUrl(
      attr(block, 'media:content', 'url') ||
      attr(block, 'media:thumbnail', 'url') ||
      attr(block, 'enclosure', 'url') ||
      (tag(block, ['description', 'content:encoded', 'content']).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || ''),
      feed.url
    );
    const id = createHash('sha1').update(url || `${feed.source}-${title}`).digest('hex').slice(0, 16);

    return {
      id,
      title,
      summary: description.slice(0, 280),
      publishedAt,
      source: feed.source,
      url,
      image: image || fallbackImages[index % fallbackImages.length]
    };
  }).filter(item => item.title && item.url);
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'IgropoiskNewsBot/1.0 (+https://github.com/nkuchenov-hash/Igropoisk)' }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return parseFeed(await response.text(), feed);
  } catch (error) {
    console.error(`[news] ${feed.source}: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const existing = await fs.readFile(outputPath, 'utf8')
  .then(JSON.parse)
  .then(data => Array.isArray(data) ? data : data.items || [])
  .catch(() => []);

const fetched = (await Promise.all(feeds.map(fetchFeed))).flat();
const byUrl = new Map();
for (const item of [...fetched, ...existing]) {
  if (!item?.url || byUrl.has(item.url)) continue;
  byUrl.set(item.url, item);
}

const items = [...byUrl.values()]
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .slice(0, limit);

if (!items.length) throw new Error('No news items were available from feeds or existing data.');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
console.log(`[news] wrote ${items.length} items to ${outputPath}`);
