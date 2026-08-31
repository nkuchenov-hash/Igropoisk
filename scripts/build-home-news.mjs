import fs from 'node:fs/promises';
import { selectCommercialHomeNews } from './lib/news-home-selector.mjs';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';

const eventsPayload = JSON.parse(await fs.readFile('data/news-events.json','utf8'));
const events = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload.items || []);

const importanceWeight = { critical: 3, major: 2, normal: 1 };
const unresolvedGameReasons = new Set([
  'ambiguous-primary-game-verification',
  'unverified-primary-game',
  'unknown-explicit-game',
  'ambiguous-explicit-name',
  'ambiguous-alias',
  'manual-game-not-found'
]);
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
  homeUntil:item.homeUntil || '',
  primarySource:item.primarySource || item.source || item.organization || '',
  primaryUrl:item.primaryUrl || item.url || '',
  image:item.image || '',
  trendScore:Number(item.trendScore || 0),
  globalScore:Number(item.globalScore || 0),
  regionalScore:Number(item.regionalScore || 0),
  editorialScore:Number(item.editorialScore || 0),
  editorialStatus:String(item.editorialStatus || ''),
  mediaSourceCount:Number(item.mediaSourceCount || item.sourceCount || 0),
  discussionMentions:Number(item.discussionMentions || 0),
  official:Boolean(item.official),
  games:Array.isArray(item.games) ? item.games : [],
  gameReviewStatus:String(item.gameReviewStatus || ''),
  gameReviewReasons:Array.isArray(item.gameReviewReasons) ? item.gameReviewReasons.map(String) : [],
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

function passesFinalCommercialPolicy(item) {
  if (!['approved', 'source-ru'].includes(item.editorialStatus)) return false;
  if (item.gameReviewReasons.some(reason => unresolvedGameReasons.has(reason))) return false;
  return isLikelyNewsContent({
    title: item.titleRu,
    summary: item.summaryRu,
    url: item.primaryUrl
  });
}

// Images are explicitly non-blocking. Missing/local image failures are rewritten to
// the permanent first-party branded fallback by publish-news-storage.mjs.
// Copy quality and unresolved specific-game identities are blocking: only editor-approved
// items that still pass the current commercial policy can enter the homepage selector.
const normalized = events
  .map(normalize)
  .filter(item => item.titleRu && item.summaryRu && item.primaryUrl && item.publicEligible && passesFinalCommercialPolicy(item))
  .sort(newestFirst);

const selection = selectCommercialHomeNews(normalized, {
  limit: 12,
  maxAgeHours: 168,
  recentHours: 72,
  minRecent: 8,
  maxPerTopic: 2,
  maxPerSource: 3
});
const items = selection.items;

if (!selection.ok) {
  const d = selection.diagnostics;
  throw new Error(
    `Homepage commercial gate failed: selected ${d.selected}/12; ${d.recentCount}/${d.minRecent} required cards are <=${d.recentHours}h; `
    + `unique topics=${d.uniqueTopics}; unique sources=${d.uniqueSources}; rejected=${JSON.stringify(d.rejected)}. `
    + 'Previous live snapshot must remain active instead of publishing stale, malformed, unresolved-game or repetitive news.'
  );
}

await fs.writeFile('data/news-home-ru.json', `${JSON.stringify({
  generatedAt:new Date().toISOString(),
  model:'editorial-global-feed',
  commercialGate:selection.diagnostics,
  items
},null,2)}\n`);
console.log(`[home-news] wrote ${items.length} cards; recent=${selection.diagnostics.recentCount}; topics=${selection.diagnostics.uniqueTopics}; sources=${selection.diagnostics.uniqueSources}`);
