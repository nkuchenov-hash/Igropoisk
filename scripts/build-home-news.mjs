import fs from 'node:fs/promises';

const eventsPayload = JSON.parse(await fs.readFile('data/news-events.json','utf8'));
const events = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload.items || []);

const importanceWeight = { critical: 3, major: 2, normal: 1 };
const normalize = item => ({
  id:item.id,
  type:item.type || 'ranked',
  importance:item.importance || 'normal',
  publicEligible:Boolean(item.publicEligible ?? item.globalEligible ?? item.regionalEligible),
  globalEligible:Boolean(item.globalEligible),
  regionalEligible:Boolean(item.regionalEligible),
  regions:Array.isArray(item.regions) ? item.regions : [],
  titleRu:item.titleRu || (item.language === 'ru' ? item.title : ''),
  summaryRu:item.summaryRu || (item.language === 'ru' ? item.summary : ''),
  titleEn:item.titleEn || item.title || '',
  summaryEn:item.summaryEn || item.summary || '',
  publishedAt:item.publishedAt,
  publishedDay:item.publishedDay,
  publishedLocalTime:item.publishedLocalTime,
  publicationTimeZone:item.publicationTimeZone,
  primarySource:item.primarySource || item.source || item.organization || '',
  primaryUrl:item.primaryUrl || item.url || '',
  image:item.image || '',
  trendScore:Number(item.trendScore || 0),
  globalScore:Number(item.globalScore || 0),
  regionalScore:Number(item.regionalScore || 0),
  editorialScore:Number(item.editorialScore || 0),
  mediaSourceCount:Number(item.mediaSourceCount || item.sourceCount || 0),
  discussionMentions:Number(item.discussionMentions || 0),
  official:Boolean(item.official),
  games:Array.isArray(item.games) ? item.games : [],
  sources:(item.sources || []).map(source => typeof source === 'string' ? {name:source} : source)
});

function rank(a,b) {
  return importanceWeight[b.importance] - importanceWeight[a.importance]
    || b.editorialScore - a.editorialScore
    || b.globalScore - a.globalScore
    || b.trendScore - a.trendScore
    || b.mediaSourceCount - a.mediaSourceCount
    || new Date(b.publishedAt)-new Date(a.publishedAt);
}

function publishedTimestamp(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(a,b) {
  return publishedTimestamp(b) - publishedTimestamp(a) || rank(a,b);
}

const normalized = events.map(normalize).filter(item => item.titleRu && item.primaryUrl && item.image);
const selected = normalized.filter(item => item.publicEligible).sort(newestFirst);
const fallback = normalized.filter(item => !item.publicEligible).sort(newestFirst);
const seen = new Set();
const items = [...selected, ...fallback]
  .filter(item => {
    const key = item.primaryUrl.replace(/[?#].*$/,'');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0,12);

await fs.writeFile('data/news-home-ru.json', `${JSON.stringify({generatedAt:new Date().toISOString(),model:'editorial-global-feed',items},null,2)}\n`);
console.log(`[home-news] wrote ${items.length} Russian cards selected newest-first; ${items.filter(item => item.publicEligible).length} passed public editorial selection`);
