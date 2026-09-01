import fs from 'node:fs/promises';
import { selectCommercialHomeNews } from './lib/news-home-selector.mjs';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { commercialNewsCopyIssues, sanitizeCommercialNewsCopy } from './lib/news-commercial-copy.mjs';

const eventsPayload = JSON.parse(await fs.readFile('data/news-events.json','utf8'));
const events = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload.items || []);

const importanceWeight = { critical: 3, major: 2, normal: 1 };
const homepageDisplayLimit = 12;
const preferredHomepageSources = 4;
const unresolvedGameReasons = new Set([
  'ambiguous-primary-game-verification',
  'unverified-primary-game',
  'unknown-explicit-game',
  'ambiguous-explicit-name',
  'ambiguous-alias',
  'manual-game-not-found'
]);
const pureScreenEntertainmentPattern = /(?:^|[^\p{L}\p{N}])(?:фильм\p{L}*|кинопрокат\p{L}*|сериал\p{L}*|кинотеатр\p{L}*|съ[её]мк\p{L}*|акт[её]р\p{L}*|режисс[её]р\p{L}*|картина\p{L}*)(?:$|[^\p{L}\p{N}])/iu;
const dealRoundupPattern = /(?:скидк\p{L}*|распродаж\p{L}*).{0,220}(?:промокод\p{L}*|можно\s+(?:купить|приобрести|забрать)|доступн\p{L}*\s+с\s+(?:увеличенн\p{L}*\s+)?скидк\p{L}*|выгодн\p{L}*\s+предложени\p{L}*)|(?:промокод\p{L}*|можно\s+(?:купить|приобрести|забрать)).{0,220}(?:скидк\p{L}*|распродаж\p{L}*)/iu;
const normalize = item => ({
  id:item.id,
  type:item.type || 'ranked',
  importance:item.importance || 'normal',
  publicEligible:Boolean(item.publicEligible ?? item.globalEligible ?? item.regionalEligible),
  globalEligible:Boolean(item.globalEligible),
  regionalEligible:Boolean(item.regionalEligible),
  regions:Array.isArray(item.regions) ? item.regions : [],
  titleRu:sanitizeCommercialNewsCopy(item.titleRu || (item.language === 'ru' ? item.title : '')),
  summaryRu:sanitizeCommercialNewsCopy(item.summaryRu || (item.language === 'ru' ? item.summary : '')),
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

function hasCommercialLocalImage(item) {
  return /^assets\/(?:news|publisher-news)\/[\w.-]+$/i.test(String(item.image || ''));
}

function isPureScreenEntertainmentWithoutGame(item) {
  if ((item.games || []).length) return false;
  if (!item.gameReviewReasons.includes('verified-no-primary-game')) return false;
  return pureScreenEntertainmentPattern.test(`${item.titleRu} ${item.summaryRu}`);
}

function isPromotionalDealRoundup(item) {
  return dealRoundupPattern.test(`${item.titleRu} ${item.summaryRu}`);
}

function passesFinalCommercialPolicy(item) {
  if (!['approved', 'source-ru'].includes(item.editorialStatus)) return false;
  if (!hasCommercialLocalImage(item)) return false;
  if (item.gameReviewReasons.some(reason => unresolvedGameReasons.has(reason))) return false;
  if (isPureScreenEntertainmentWithoutGame(item)) return false;
  if (isPromotionalDealRoundup(item)) return false;
  if (commercialNewsCopyIssues(`${item.titleRu}\n${item.summaryRu}`).length) return false;
  return isLikelyNewsContent({
    title: item.titleRu,
    summary: item.summaryRu,
    url: item.primaryUrl
  });
}

// Homepage is a bounded view over the complete news dataset, not a publication quota.
// Every valid event remains in data/news-events.json and the archive. This file may
// contain anywhere from 0 to homepageDisplayLimit cards depending on real news volume.
const normalized = events
  .map(normalize)
  .filter(item => item.titleRu && item.summaryRu && item.primaryUrl && item.publicEligible && passesFinalCommercialPolicy(item))
  .sort(newestFirst);

const selection = selectCommercialHomeNews(normalized, {
  limit: homepageDisplayLimit,
  maxAgeHours: 168,
  recentHours: 72,
  minRecent: 8,
  maxPerTopic: 2,
  // Preferred concentration limit only. The selector may exceed it to fill otherwise
  // empty homepage slots; it never rejects the entire news publication because of it.
  maxPerSource: 4
});
const items = selection.items;

if (items.length < homepageDisplayLimit) {
  console.warn(`[home-news] only ${items.length}/${homepageDisplayLimit} publishable homepage cards are currently available; publishing the available set without blocking the news pipeline.`);
}
if (selection.diagnostics.uniqueSources < preferredHomepageSources && items.length) {
  console.warn(`[home-news] source mix currently has ${selection.diagnostics.uniqueSources} source(s); diversity is advisory and does not block publication.`);
}

await fs.writeFile('data/news-home-ru.json', `${JSON.stringify({
  generatedAt:new Date().toISOString(),
  model:'editorial-global-feed',
  displayLimit:homepageDisplayLimit,
  commercialGate:{
    ...selection.diagnostics,
    preferredHomepageSources,
    volumeBlocking:false,
    sourceDiversityBlocking:false
  },
  items
},null,2)}\n`);
console.log(`[home-news] wrote ${items.length} commercially complete homepage cards from ${normalized.length} eligible events; recent=${selection.diagnostics.recentCount}; topics=${selection.diagnostics.uniqueTopics}; sources=${selection.diagnostics.uniqueSources}`);
