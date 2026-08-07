import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildGameReviewQueue, canonicalSourceUrl, enrichNewsItems } from './lib/news-game-linker.mjs';

const rankedPath = 'data/news.json';
const officialPath = 'data/publisher-news.json';
const outputPath = 'data/news-events.json';
const reviewPath = 'data/news-game-review.json';
const mergeWindowHours = 96;

const stopWords = new Set(['the','a','an','and','or','for','to','of','in','on','with','from','at','by','is','are','was','were','will','this','that','new','news','game','games','gaming','и','в','на','с','к','из','для','о','от','по','за','что','как','это','новый','новая','новые','игра','игры']);
function normalize(value = '') { return String(value).toLowerCase().normalize('NFKD').replace(/[’'“”"`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(value = '') { return new Set(normalize(value).split(' ').filter(token => token.length >= 3 && !stopWords.has(token))); }
function similarity(a, b) {
  const left = a._tokens || tokens(a.titleEn || a.titleRu || a.title);
  const right = b._tokens || tokens(b.titleEn || b.titleRu || b.title);
  if (!left.size || !right.size) return 0;
  let common = 0; for (const token of left) if (right.has(token)) common += 1;
  return common / Math.min(left.size, right.size);
}
function cleanSummary(value = '') {
  let text = String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\[\s*(?:…|\.\.\.)\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text
    .replace(/\s+The post\s+[\s\S]*?\s+appeared first on\s+[\s\S]*$/i, '')
    .replace(/\s+(?:Сообщение|Публикация)\s+[\s\S]*?\s+впервые\s+появил(?:ось|ась)\s+на\s+[\s\S]*$/i, '')
    .trim();
  if (text.length <= 520) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let result = '';
  for (const sentence of sentences.slice(0, 3)) {
    if ((result + sentence).trim().length > 520) break;
    result = `${result} ${sentence}`.trim();
  }
  if (result.length >= 120) return result;
  return `${text.slice(0, 517).trimEnd()}…`;
}
async function readItems(path) { try { const payload = JSON.parse(await fs.readFile(path, 'utf8')); return Array.isArray(payload) ? payload : payload.items || []; } catch { return []; } }
function sourceRef(item) {
  return {
    name: item.source || item.organization || 'Source', organization: item.organization || '', kind: item.sourceKind || (item.official ? 'official' : 'media'),
    url: item.url, official: Boolean(item.official), publishedAt: item.publishedAt
  };
}
function itemGameSlugs(item) {
  return new Set((Array.isArray(item?.games) ? item.games : []).map(game => typeof game === 'string' ? game : game?.slug).filter(Boolean));
}
function sharesGame(left, right) {
  const a = itemGameSlugs(left);
  const b = itemGameSlugs(right);
  for (const slug of a) if (b.has(slug)) return true;
  return Boolean(left.game && right.game && normalize(left.game) === normalize(right.game));
}
function uniqueGames(items) {
  const games = new Map();
  items.flatMap(item => Array.isArray(item.games) ? item.games : []).forEach(game => {
    const normalized = typeof game === 'string' ? { slug: game, title: game } : game;
    if (normalized?.slug) games.set(normalized.slug, normalized);
  });
  return [...games.values()];
}

const [ranked, official] = await Promise.all([readItems(rankedPath), readItems(officialPath)]);
const all = [
  ...ranked.map(item => ({ ...item, stream: 'ranked', _tokens: tokens(item.titleEn || item.titleRu || item.title) })),
  ...official.map(item => ({ ...item, stream: 'official', _tokens: tokens(item.titleEn || item.titleRu || item.title) }))
].filter(item => item.url && item.publishedAt);
all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

const events = [];
for (const item of all) {
  let best = null; let bestScore = 0;
  for (const event of events) {
    const hours = Math.abs(new Date(item.publishedAt) - new Date(event.publishedAt)) / 36e5;
    if (hours > mergeWindowHours) continue;
    const score = similarity(item, event.representative);
    const sameGame = sharesGame(item, event.representative);
    const threshold = sameGame ? 0.42 : 0.58;
    if (score >= threshold && score > bestScore) { best = event; bestScore = score; }
  }
  if (!best) {
    events.push({ representative: item, publishedAt: item.publishedAt, game: item.game || '', items: [item] });
  } else {
    best.items.push(item);
    if (new Date(item.publishedAt) > new Date(best.publishedAt)) best.publishedAt = item.publishedAt;
    if (!best.game && item.game) best.game = item.game;
  }
}

const output = events.map(event => {
  const officialItems = event.items.filter(item => item.official);
  const mediaItems = event.items.filter(item => !item.official);
  const rankedRepresentative = mediaItems.sort((a, b) => Number(b.globalScore || b.trendScore || 0) - Number(a.globalScore || a.trendScore || 0))[0];
  const officialRepresentative = officialItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  const representative = rankedRepresentative || officialRepresentative || event.representative;
  const newestItem = [...event.items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  const sources = [...new Map(event.items.map(item => [canonicalSourceUrl(item.url), sourceRef(item)])).values()];
  const mediaSourceCount = new Set(mediaItems.flatMap(item => item.sources || [item.source]).filter(Boolean)).size;
  const discussionMentions = Math.max(0, ...event.items.map(item => Number(item.discussionMentions || 0)));
  const trendScore = Math.max(0, ...event.items.map(item => Number(item.trendScore || 0)));
  const globalScore = Math.max(0, ...event.items.map(item => Number(item.globalScore || 0)));
  const regionalScore = Math.max(0, ...event.items.map(item => Number(item.regionalScore || 0)));
  const regions = [...new Set(event.items.flatMap(item => Array.isArray(item.regions) ? item.regions : []))];
  const mediaSignal = mediaSourceCount >= 2 || discussionMentions >= 3 || trendScore >= 450 || globalScore >= 450;
  const confirmedOfficialSignal = officialItems.length > 0 && (mediaSourceCount >= 1 || discussionMentions >= 2 || trendScore >= 300 || globalScore >= 300);
  const rankedGlobalSignal = event.items.some(item => !item.official && item.globalEligible === true);
  const globalEligible = mediaSignal || confirmedOfficialSignal || rankedGlobalSignal;
  const regionalEligible = regions.length > 0 && event.items.some(item => item.regionalEligible) && regionalScore > 0;
  const publicEligible = globalEligible || regionalEligible;
  const importance = trendScore >= 700 || mediaSourceCount >= 6 || discussionMentions >= 7 || globalScore >= 700
    ? 'critical'
    : globalEligible || regionalScore >= 250
      ? 'major'
      : 'normal';
  const editorialScore = globalScore + trendScore + mediaSourceCount * 120 + discussionMentions * 80 + regionalScore + (officialItems.length ? 80 : 0);
  const type = officialItems.length && mediaItems.length ? 'confirmed' : officialItems.length ? 'official' : 'ranked';
  const id = createHash('sha1').update(event.items.map(item => canonicalSourceUrl(item.url)).sort().join('|')).digest('hex').slice(0, 16);
  return {
    id, type, importance, official: officialItems.length > 0, publicEligible, editorialScore,
    titleRu: representative.titleRu || representative.title || '', titleEn: representative.titleEn || representative.title || '',
    summaryRu: cleanSummary(representative.summaryRu || representative.summary || ''), summaryEn: cleanSummary(representative.summaryEn || representative.summary || ''),
    publishedAt: event.publishedAt,
    publishedDay: newestItem?.publishedDay,
    publishedLocalTime: newestItem?.publishedLocalTime,
    publicationTimeZone: newestItem?.publicationTimeZone,
    game: event.game || representative.game || '',
    games: uniqueGames(event.items),
    image: representative.image, imageSourceUrl: representative.imageSourceUrl,
    primaryUrl: (officialRepresentative || representative).url,
    primarySource: (officialRepresentative || representative).source,
    trendScore, globalScore, regionalScore, globalEligible, regionalEligible, regions,
    mediaSourceCount, discussionMentions, sources,
    homeUntil: publicEligible ? new Date(new Date(event.publishedAt).getTime() + (importance === 'critical' ? 168 : globalEligible ? 72 : 48) * 3600e3).toISOString() : null
  };
}).sort((a, b) => {
  const importance = { critical: 3, major: 2, normal: 1 };
  return Number(b.publicEligible) - Number(a.publicEligible)
    || importance[b.importance] - importance[a.importance]
    || b.editorialScore - a.editorialScore
    || new Date(b.publishedAt) - new Date(a.publishedAt);
});

const enriched = await enrichNewsItems(output);
const generatedAt = new Date().toISOString();
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt, model: 'event-first-editorial-selection-plus-region', mergeWindowHours, globalMinimumIndependentSources: 2, items: enriched }, null, 2)}\n`);
await fs.writeFile(reviewPath, `${JSON.stringify(buildGameReviewQueue(enriched, { generatedAt }), null, 2)}\n`);
console.log(`[events] built ${enriched.length} events; ${enriched.filter(item => item.publicEligible).length} passed public editorial selection; ${enriched.filter(item => item.gameReviewStatus === 'needs-review').length} require game review`);
