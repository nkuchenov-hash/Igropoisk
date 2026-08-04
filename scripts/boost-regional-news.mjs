import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const feedUrl = 'https://www.igromania.ru/rss/rss_all.xml';
const outputPath = 'data/news.json';
const imageDirectory = 'assets/news';
const maxAgeHours = 96;
const userAgent = 'IgropoiskRegionalNewsBot/1.0 (+https://github.com/nkuchenov-hash/Igropoisk)';

const impactPatterns = [
  /росси|казахстан|снг|рубл|регион/i,
  /steam|vk play|playstation store|xbox store|epic games store/i,
  /стал[аи]? доступ|вернул[аи]?|вышел|выпустил|начал[аи]? прода|снят[ао]? с продаж/i,
  /блокиров|ограничен|эксклюзив|локализац|русск/i
];
const gameSignals = /atomic heart|игр[аыеу]|шутер|rpg|стратег|симулятор|экшен|приключен/i;

const decode = (value='') => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = (value='') => decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => strip(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
const attr = (text, name) => decode(text.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '');

async function fetchText(url, accept='text/html,application/xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, { redirect:'follow', headers:{ 'user-agent':userAgent, accept } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { text:await response.text(), url:response.url || url };
}

function articleImage(html, articleUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of ['og:image:secure_url','og:image','twitter:image','twitter:image:src']) {
    for (const meta of metas) {
      const name = (attr(meta,'property') || attr(meta,'name')).toLowerCase();
      if (name !== key) continue;
      try { return new URL(attr(meta,'content'), articleUrl).href; } catch {}
    }
  }
  return '';
}

async function saveImage(imageUrl, id, articleUrl) {
  const response = await fetch(imageUrl, { redirect:'follow', headers:{ 'user-agent':userAgent, referer:articleUrl, accept:'image/avif,image/webp,image/png,image/jpeg,image/*' } });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';')[0];
  const ext = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : type === 'image/avif' ? '.avif' : '.jpg';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) throw new Error('image too small');
  await fs.mkdir(imageDirectory, { recursive:true });
  const file = `${id}${ext}`;
  await fs.writeFile(path.join(imageDirectory, file), bytes);
  return `assets/news/${file}`;
}

const payload = JSON.parse(await fs.readFile(outputPath, 'utf8'));
const existingUrls = new Set((payload.items || []).map(item => item.url));
const { text:xml } = await fetchText(feedUrl, 'application/rss+xml,application/xml,text/xml');
const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
const additions = [];

for (const block of blocks.slice(0, 80)) {
  const title = tag(block, 'title');
  const summary = tag(block, 'description').slice(0, 320);
  const url = tag(block, 'link');
  const rawDate = tag(block, 'pubDate') || tag(block, 'dc:date');
  const publishedAt = new Date(rawDate || Date.now()).toISOString();
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 36e5;
  const text = `${title} ${summary}`;
  if (!title || !url || existingUrls.has(url) || ageHours > maxAgeHours) continue;
  if (!gameSignals.test(text) || !impactPatterns.some(pattern => pattern.test(text))) continue;

  try {
    const article = await fetchText(url);
    const imageUrl = articleImage(article.text, article.url);
    if (!imageUrl) continue;
    const id = createHash('sha1').update(article.url).digest('hex').slice(0,16);
    const image = await saveImage(imageUrl, id, article.url);
    additions.push({
      id, title, summary, publishedAt, source:'Игромания', language:'ru', url:article.url,
      image, imageSourceUrl:imageUrl, trendScore:280, sourceCount:1, sources:['Игромания'],
      discussionMentions:0, type:'industry', official:false,
      titleRu:title, titleEn:title, summaryRu:summary, summaryEn:summary,
      mainEligible:true, superImportant:false,
      homeUntil:new Date(new Date(publishedAt).getTime() + 72*36e5).toISOString(),
      regionalImportance:'ru-cis'
    });
  } catch (error) {
    console.error(`[regional] ${url}: ${error.message}`);
  }
}

if (additions.length) {
  payload.items = [...additions, ...(payload.items || [])]
    .sort((a,b) => Number(b.trendScore||0)-Number(a.trendScore||0) || new Date(b.publishedAt)-new Date(a.publishedAt))
    .slice(0, 60);
  payload.generatedAt = new Date().toISOString();
  payload.regionalSafeguard = 'Recent high-impact Russia/CIS availability and distribution events are admitted even before broad international coverage appears.';
  await fs.writeFile(outputPath, `${JSON.stringify(payload,null,2)}\n`);
}
console.log(`[regional] added ${additions.length} high-impact Russia/CIS news items`);
