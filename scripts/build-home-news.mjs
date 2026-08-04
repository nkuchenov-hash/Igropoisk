import fs from 'node:fs/promises';

const ranked = JSON.parse(await fs.readFile('data/news.json','utf8'));
let official = { items:[] };
try { official = JSON.parse(await fs.readFile('data/publisher-news.json','utf8')); } catch {}

const normalize = item => ({
  id:item.id,
  titleRu:item.titleRu || (item.language === 'ru' ? item.title : ''),
  summaryRu:item.summaryRu || (item.language === 'ru' ? item.summary : ''),
  titleEn:item.titleEn || item.title || '',
  summaryEn:item.summaryEn || item.summary || '',
  publishedAt:item.publishedAt,
  primarySource:item.primarySource || item.source || item.organization || '',
  primaryUrl:item.primaryUrl || item.url || '',
  image:item.image || '',
  trendScore:Number(item.trendScore || 0),
  mediaSourceCount:Number(item.mediaSourceCount || item.sourceCount || 1),
  sources:(item.sources || []).map(source => typeof source === 'string' ? {name:source} : source),
  regionalImportance:item.regionalImportance || null
});

const seen = new Set();
const items = [...(ranked.items || []), ...(official.items || [])]
  .map(normalize)
  .filter(item => item.titleRu && item.primaryUrl && item.image)
  .sort((a,b) => {
    const regional = Number(Boolean(b.regionalImportance)) - Number(Boolean(a.regionalImportance));
    if (regional) return regional;
    return b.trendScore-a.trendScore || new Date(b.publishedAt)-new Date(a.publishedAt);
  })
  .filter(item => {
    const key = item.primaryUrl.replace(/[?#].*$/,'');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0,12);

await fs.writeFile('data/news-home-ru.json', `${JSON.stringify({generatedAt:new Date().toISOString(),items},null,2)}\n`);
console.log(`[home-news] wrote ${items.length} current Russian cards`);
