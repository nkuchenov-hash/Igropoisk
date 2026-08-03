import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const registryPath = path.resolve('data/news-sources.json');
const outputPath = path.resolve('data/publisher-news.json');
const imageDirectory = path.resolve('assets/publisher-news');
const userAgent = 'IgropoiskOfficialSourceBot/2.0 (+https://github.com/nkuchenov-hash/Igropoisk)';
const maxItems = 180;
const maxAgeDays = 14;

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function strip(value = '') { return decode(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block, names) { for (const name of names) { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); if (match) return decode(match[1]).trim(); } return ''; }
function attr(text, name) { const match = text.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')); return match ? decode(match[1]).trim() : ''; }
function absolute(value, base) { try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; } }

async function fetchText(url, timeout = 20000, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': userAgent, accept } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return { text: await response.text(), finalUrl: response.url || url, contentType: response.headers.get('content-type') || '' };
  } finally { clearTimeout(timer); }
}

async function discoverFeed(source) {
  if (source.feedUrl) return source.feedUrl;
  try {
    const { text, finalUrl } = await fetchText(source.siteUrl, 15000);
    const links = text.match(/<link\b[^>]*>/gi) || [];
    for (const link of links) {
      const type = attr(link, 'type').toLowerCase();
      const rel = attr(link, 'rel').toLowerCase();
      if (!rel.includes('alternate') || !/(rss|atom|xml)/.test(type)) continue;
      const candidate = absolute(attr(link, 'href'), finalUrl);
      if (candidate) return candidate;
    }
  } catch (error) { console.error(`[official/discovery] ${source.name}: ${error.message}`); }
  return '';
}

function parseFeed(xml, source, feedUrl) {
  const blocks = [...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []), ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])];
  return blocks.slice(0, 40).map(block => {
    const title = strip(tag(block, ['title']));
    const linkTag = block.match(/<link\b[^>]*>/i)?.[0] || '';
    const url = absolute(strip(tag(block, ['link'])) || attr(linkTag, 'href'), feedUrl || source.siteUrl);
    const summary = strip(tag(block, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 420);
    const rawDate = strip(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const parsed = new Date(rawDate || Date.now());
    const publishedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    return {
      id: createHash('sha1').update(url || `${source.id}-${title}`).digest('hex').slice(0, 16),
      title, summary, url, publishedAt,
      sourceId: source.id, source: source.name, organization: source.organization,
      sourceKind: source.kind, game: source.game || '', sourceLanguage: source.language || 'en'
    };
  }).filter(item => item.title && item.url && Date.now() - new Date(item.publishedAt).getTime() <= maxAgeDays * 864e5);
}

async function translate(text, target) {
  if (!text) return '';
  const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
  const { text: body } = await fetchText(endpoint, 15000, 'application/json');
  const payload = JSON.parse(body);
  return (payload?.[0] || []).map(part => part?.[0] || '').join('').trim();
}

function extractImage(html, articleUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    for (const meta of metas) {
      const name = (attr(meta, 'property') || attr(meta, 'name')).toLowerCase();
      if (name === key) { const candidate = absolute(attr(meta, 'content'), articleUrl); if (candidate) return candidate; }
    }
  }
  return '';
}
function extension(type, url) {
  const mime = String(type || '').split(';')[0].toLowerCase();
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };
  if (map[mime]) return map[mime];
  try { const ext = path.extname(new URL(url).pathname).toLowerCase(); return ['.jpg','.jpeg','.png','.webp','.avif','.gif'].includes(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : ''; } catch { return ''; }
}
async function downloadImage(url, id, referer) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': userAgent, referer, accept: 'image/*' } });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const ext = extension(response.headers.get('content-type'), response.url || url); if (!ext) throw new Error('unsupported image');
  const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length < 1024 || bytes.length > 20 * 1024 * 1024) throw new Error('invalid image size');
  const filename = `${id}${ext}`; await fs.writeFile(path.join(imageDirectory, filename), bytes);
  return { image: `assets/publisher-news/${filename}`, imageSourceUrl: response.url || url };
}

async function hydrate(item) {
  try {
    const { text: html, finalUrl } = await fetchText(item.url);
    const imageUrl = extractImage(html, finalUrl); if (!imageUrl) throw new Error('no original image');
    const baseSummary = item.summary || item.title;
    const [titleRu, titleEn, summaryRu, summaryEn, downloaded] = await Promise.all([
      translate(item.title, 'ru'), translate(item.title, 'en'), translate(baseSummary, 'ru'), translate(baseSummary, 'en'), downloadImage(imageUrl, item.id, finalUrl)
    ]);
    if (!titleRu || !titleEn) throw new Error('translation unavailable');
    return {
      ...item, url: finalUrl, type: 'official', official: true,
      titleRu, titleEn, summaryRu, summaryEn, ...downloaded,
      homeUntil: new Date(new Date(item.publishedAt).getTime() + 36 * 3600e3).toISOString()
    };
  } catch (error) { console.error(`[official/article] ${item.url}: ${error.message}`); return null; }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(imageDirectory, { recursive: true });
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const sources = (registry.sources || []).filter(source => source.enabled !== false && source.siteUrl);
const raw = [];
const sourceReport = [];
for (const source of sources) {
  const feedUrl = await discoverFeed(source);
  if (!feedUrl) { sourceReport.push({ id: source.id, status: 'no-feed' }); continue; }
  try {
    const { text } = await fetchText(feedUrl, 15000);
    const parsed = parseFeed(text, source, feedUrl);
    raw.push(...parsed);
    sourceReport.push({ id: source.id, status: 'ok', feedUrl, items: parsed.length });
  } catch (error) {
    sourceReport.push({ id: source.id, status: 'error', feedUrl, error: error.message });
    console.error(`[official/feed] ${source.name}: ${error.message}`);
  }
}

const unique = [...new Map(raw.map(item => [item.url, item])).values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, maxItems);
const items = [];
for (const item of unique) { const hydrated = await hydrate(item); if (hydrated) items.push(hydrated); }
const used = new Set(items.map(item => path.basename(item.image)));
for (const file of await fs.readdir(imageDirectory).catch(() => [])) if (!used.has(file)) await fs.rm(path.join(imageDirectory, file), { force: true });
await fs.writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(), updateFrequency: 'hourly', sourceCount: sources.length,
  successfulSourceCount: sourceReport.filter(item => item.status === 'ok').length,
  sourceReport, items
}, null, 2)}\n`);
console.log(`[official] wrote ${items.length} items from ${sourceReport.filter(item => item.status === 'ok').length}/${sources.length} sources`);
