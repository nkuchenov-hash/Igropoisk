import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const registryPath = path.resolve('data/news-sources.json');
const outputPath = path.resolve('data/publisher-news.json');
const imageDirectory = path.resolve('assets/publisher-news');
const userAgent = 'IgropoiskOfficialSourceBot/3.1 (+https://github.com/nkuchenov-hash/Igropoisk)';
const maxItems = 180;
const maxAgeDays = 14;
const localModel = process.env.NEWS_LOCAL_TRANSLATION_MODEL || 'Xenova/opus-mt-en-ru';
const localCacheDir = process.env.NEWS_LOCAL_TRANSLATION_CACHE || '/tmp/igropoisk-news-translation-models';
const localRuntimeDir = process.env.NEWS_LOCAL_TRANSLATION_RUNTIME || '/tmp/igropoisk-news-translator-runtime';
let googleUnavailable = false;
let memoryUnavailable = false;
let localTranslatorPromise = null;
let localTranslatorUnavailable = false;
let localTranslatedItems = 0;
let remoteTranslatedItems = 0;
let sourceRussianItems = 0;
let untranslatedDroppedItems = 0;
let imageFallbackItems = 0;

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function strip(value = '') { return decode(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block, names) { for (const name of names) { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); if (match) return decode(match[1]).trim(); } return ''; }
function attr(text, name) { const match = text.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')); return match ? decode(match[1]).trim() : ''; }
function absolute(value, base) { try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; } }
function hasCyrillic(value = '') { return /[А-Яа-яЁё]/.test(value); }

async function fetchText(url, timeout = 20000, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': userAgent, accept } });
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
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

function translatedText(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return String(first?.translation_text || first?.generated_text || '').trim();
}

async function loadTransformersRuntime() {
  try {
    return await import('@huggingface/transformers');
  } catch {
    const requireFromRuntime = createRequire(`${localRuntimeDir}/package.json`);
    const modulePath = requireFromRuntime.resolve('@huggingface/transformers');
    return import(pathToFileURL(modulePath).href);
  }
}

async function getLocalTranslator() {
  if (localTranslatorUnavailable) return null;
  if (!localTranslatorPromise) {
    localTranslatorPromise = (async () => {
      const { env, pipeline } = await loadTransformersRuntime();
      env.cacheDir = localCacheDir;
      env.allowLocalModels = true;
      env.useFSCache = true;
      return pipeline('translation', localModel, { dtype: 'q8' });
    })().catch(error => {
      localTranslatorUnavailable = true;
      console.error(`[official/translate/local] unavailable: ${error.message}`);
      return null;
    });
  }
  return localTranslatorPromise;
}

async function translateLocalEnRu(text) {
  if (!text) return '';
  const translator = await getLocalTranslator();
  if (!translator) return '';
  try {
    return translatedText(await translator(text));
  } catch (error) {
    console.error(`[official/translate/local] ${error.message}`);
    return '';
  }
}

async function translateGoogle(text, target) {
  if (googleUnavailable || !text) return '';
  try {
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const { text: body } = await fetchText(endpoint, 15000, 'application/json');
    const payload = JSON.parse(body);
    return (payload?.[0] || []).map(part => part?.[0] || '').join('').trim();
  } catch (error) {
    if ([403, 429].includes(Number(error.status))) googleUnavailable = true;
    console.error(`[official/translate/google] ${error.message}`);
    return '';
  }
}

async function translateMyMemory(text, source, target) {
  if (memoryUnavailable || !text || !['en', 'ru'].includes(source) || source === target) return '';
  try {
    const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}%7C${target}`;
    const { text: body } = await fetchText(endpoint, 15000, 'application/json');
    const payload = JSON.parse(body);
    const translated = String(payload?.responseData?.translatedText || '').trim();
    const status = Number(payload?.responseStatus || 200);
    if (status >= 400) {
      const error = new Error(`MyMemory ${status}`);
      error.status = status;
      throw error;
    }
    return translated;
  } catch (error) {
    if ([403, 429].includes(Number(error.status))) memoryUnavailable = true;
    console.error(`[official/translate/mymemory] ${error.message}`);
    return '';
  }
}

async function translateEnRu(text) {
  if (!text) return { text: '', provider: 'none' };
  const local = await translateLocalEnRu(text);
  if (local && hasCyrillic(local)) return { text: local, provider: 'local-opus' };
  const google = await translateGoogle(text, 'ru');
  if (google && hasCyrillic(google)) return { text: google, provider: 'google-fallback' };
  const memory = await translateMyMemory(text, 'en', 'ru');
  if (memory && hasCyrillic(memory)) return { text: memory, provider: 'mymemory-fallback' };
  return { text: '', provider: 'unavailable' };
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
  return { image: `assets/publisher-news/${filename}`, imageSourceUrl: response.url || url, imageCacheStatus: 'cached' };
}

async function hydrate(item) {
  let finalUrl = item.url;
  let downloaded = { image: '', imageSourceUrl: '', imageCacheStatus: 'fallback' };
  try {
    const { text: html, finalUrl: resolvedUrl } = await fetchText(item.url);
    finalUrl = resolvedUrl;
    const imageUrl = extractImage(html, finalUrl);
    if (imageUrl) {
      try {
        downloaded = await downloadImage(imageUrl, item.id, finalUrl);
      } catch (error) {
        imageFallbackItems += 1;
        console.error(`[official/image] ${item.url}: ${error.message}; using branded fallback`);
      }
    } else {
      imageFallbackItems += 1;
      console.error(`[official/image] ${item.url}: no original image; using branded fallback`);
    }
  } catch (error) {
    imageFallbackItems += 1;
    console.error(`[official/article] ${item.url}: ${error.message}; continuing without cached image`);
  }

  try {
    const baseSummary = item.summary || item.title;
    const sourceIsRussian = item.sourceLanguage === 'ru' || hasCyrillic(item.title || '');
    let titleRu;
    let summaryRu;
    let localizationStatus;

    if (sourceIsRussian) {
      titleRu = item.title;
      summaryRu = baseSummary;
      localizationStatus = 'source-ru';
      sourceRussianItems += 1;
    } else {
      const titleTranslation = await translateEnRu(item.title);
      const summaryTranslation = await translateEnRu(baseSummary);
      titleRu = titleTranslation.text;
      summaryRu = summaryTranslation.text || titleRu;
      localizationStatus = titleTranslation.provider;
      if (!titleRu || !hasCyrillic(titleRu)) {
        untranslatedDroppedItems += 1;
        throw new Error('Russian translation unavailable; English fallback is forbidden on the Russian site');
      }
      if (localizationStatus === 'local-opus') localTranslatedItems += 1;
      else remoteTranslatedItems += 1;
    }

    const titleEn = item.title;
    const summaryEn = baseSummary;
    if (!titleRu || !titleEn) throw new Error('usable title unavailable');
    return {
      ...item, url: finalUrl, type: 'official', official: true,
      titleRu, titleEn, summaryRu, summaryEn, localizationStatus, ...downloaded,
      homeUntil: new Date(new Date(item.publishedAt).getTime() + 36 * 3600e3).toISOString()
    };
  } catch (error) {
    console.error(`[official/localization] ${item.url}: ${error.message}`);
    return null;
  }
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
const used = new Set(items.map(item => path.basename(item.image || '')).filter(Boolean));
for (const file of await fs.readdir(imageDirectory).catch(() => [])) if (!used.has(file)) await fs.rm(path.join(imageDirectory, file), { force: true });
await fs.writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(), updateFrequency: 'hourly', sourceCount: sources.length,
  successfulSourceCount: sourceReport.filter(item => item.status === 'ok').length,
  localTranslatedItemCount: localTranslatedItems,
  remoteTranslatedItemCount: remoteTranslatedItems,
  sourceRussianItemCount: sourceRussianItems,
  untranslatedDroppedItemCount: untranslatedDroppedItems,
  imageFallbackItemCount: imageFallbackItems,
  sourceLanguageFallbackItemCount: 0,
  localTranslationModel: localModel,
  sourceReport, items
}, null, 2)}\n`);
console.log(`[official] wrote ${items.length} Russian-ready items from ${sourceReport.filter(item => item.status === 'ok').length}/${sources.length} sources; local=${localTranslatedItems}; remote=${remoteTranslatedItems}; source-ru=${sourceRussianItems}; image-fallback=${imageFallbackItems}; untranslated-dropped=${untranslatedDroppedItems}; source-language-fallback=0`);
