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
const perFeedLimit = 14;
const outputPath = path.resolve('data/news.json');
const imageDirectory = path.resolve('assets/news');
const userAgent = 'IgropoiskNewsBot/2.0 (+https://github.com/nkuchenov-hash/Igropoisk)';

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

function attrFromTag(tagText, attribute) {
  const match = tagText.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

function feedAttr(block, tagName, attribute) {
  const tagMatch = block.match(new RegExp(`<${tagName}\\b[^>]*>`, 'i'));
  return tagMatch ? attrFromTag(tagMatch[0], attribute) : '';
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function parseFeed(xml, feed) {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];

  return blocks.slice(0, perFeedLimit).map(block => {
    const title = stripHtml(tag(block, ['title']));
    const rawLink = tag(block, ['link']) || feedAttr(block, 'link', 'href');
    const url = absoluteUrl(stripHtml(rawLink), feed.url);
    const description = stripHtml(tag(block, ['description', 'summary', 'content:encoded', 'content']));
    const dateText = stripHtml(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const parsedDate = new Date(dateText || Date.now());
    const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    const id = createHash('sha1').update(url || `${feed.source}-${title}`).digest('hex').slice(0, 16);

    return {
      id,
      title,
      summary: description.slice(0, 280),
      publishedAt,
      source: feed.source,
      url
    };
  }).filter(item => item.title && item.url);
}

async function fetchText(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return { text: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(feed) {
  try {
    const { text } = await fetchText(feed.url, 15000);
    return parseFeed(text, feed);
  } catch (error) {
    console.error(`[news/feed] ${feed.source}: ${error.message}`);
    return [];
  }
}

function extractOriginalArticleImage(html, articleUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = [
    'og:image:secure_url',
    'og:image',
    'twitter:image',
    'twitter:image:src'
  ];

  for (const key of wanted) {
    for (const metaTag of metaTags) {
      const name = (attrFromTag(metaTag, 'property') || attrFromTag(metaTag, 'name')).toLowerCase();
      if (name !== key) continue;
      const candidate = absoluteUrl(attrFromTag(metaTag, 'content'), articleUrl);
      if (candidate) return candidate;
    }
  }

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const linkTag of linkTags) {
    if (attrFromTag(linkTag, 'rel').toLowerCase() !== 'image_src') continue;
    const candidate = absoluteUrl(attrFromTag(linkTag, 'href'), articleUrl);
    if (candidate) return candidate;
  }

  return '';
}

function extensionFor(contentType, imageUrl) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/gif': '.gif'
  };
  if (byType[normalized]) return byType[normalized];

  try {
    const extension = path.extname(new URL(imageUrl).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(extension)) {
      return extension === '.jpeg' ? '.jpg' : extension;
    }
  } catch {}
  return '';
}

async function downloadOriginalImage(imageUrl, id, articleUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(imageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
        referer: articleUrl
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`not an image: ${contentType || 'unknown content type'}`);
    }

    const extension = extensionFor(contentType, response.url || imageUrl);
    if (!extension) throw new Error(`unsupported image type: ${contentType}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024) throw new Error('image is too small');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('image exceeds 20 MB');

    const filename = `${id}${extension}`;
    await fs.writeFile(path.join(imageDirectory, filename), bytes);
    return {
      image: `assets/news/${filename}`,
      imageSourceUrl: response.url || imageUrl
    };
  } finally {
    clearTimeout(timer);
  }
}

async function hydrateArticle(item) {
  try {
    const { text: html, finalUrl } = await fetchText(item.url);
    const originalImageUrl = extractOriginalArticleImage(html, finalUrl);
    if (!originalImageUrl) throw new Error('original article has no og:image or twitter:image');

    const downloaded = await downloadOriginalImage(originalImageUrl, item.id, finalUrl);
    return {
      ...item,
      url: finalUrl,
      ...downloaded
    };
  } catch (error) {
    console.error(`[news/article] ${item.url}: ${error.message}`);
    return null;
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(imageDirectory, { recursive: true });

const feedItems = (await Promise.all(feeds.map(fetchFeed))).flat();
const deduplicated = [...new Map(feedItems.map(item => [item.url, item])).values()]
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

const items = [];
for (const item of deduplicated) {
  if (items.length >= limit) break;
  const hydrated = await hydrateArticle(item);
  if (hydrated) items.push(hydrated);
}

if (!items.length) throw new Error('No news articles with downloadable original images were found.');

const usedFiles = new Set(items.map(item => path.basename(item.image)));
const existingFiles = await fs.readdir(imageDirectory).catch(() => []);
await Promise.all(existingFiles
  .filter(filename => !usedFiles.has(filename))
  .map(filename => fs.rm(path.join(imageDirectory, filename), { force: true })));

await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
console.log(`[news] wrote ${items.length} articles with downloaded original images`);
