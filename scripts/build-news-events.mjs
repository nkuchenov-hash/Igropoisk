import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const rankedPath = 'data/news.json';
const officialPath = 'data/publisher-news.json';
const outputPath = 'data/news-events.json';
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
async function readItems(path) { try { const payload = JSON.parse(await fs.readFile(path, 'utf8')); return Array.isArray(payload) ? payload : payload.items || []; } catch { return []; } }
function sourceRef(item) {
  return {
    name: item.source || item.organization || 'Source', organization: item.organization || '', kind: item.sourceKind || (item.official ? 'official' : 'media'),
    url: item.url, official: Boolean(item.official), publishedAt: item.publishedAt
  };
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
    const sameGame = item.game && event.game && normalize(item.game) === normalize(event.game);
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
  const rankedRepresentative = mediaItems.sort((a, b) => Number(b.trendScore || 0) - Number(a.trendScore || 0))[0];
  const officialRepresentative = officialItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  const representative = rankedRepresentative || officialRepresentative || event.representative;
  const sources = [...new Map(event.items.map(item => [item.url, sourceRef(item)])).values()];
  const mediaSourceCount = new Set(mediaItems.flatMap(item => item.sources || [item.source]).filter(Boolean)).size;
  const discussionMentions = Math.max(0, ...event.items.map(item => Number(item.discussionMentions || 0)));
  const trendScore = Math.max(0, ...event.items.map(item => Number(item.trendScore || 0)));
  const importance = trendScore >= 400 || mediaSourceCount >= 5 || discussionMentions >= 8 ? 'critical' : mediaSourceCount >= 2 || trendScore >= 180 ? 'major' : 'normal';
  const type = officialItems.length && mediaItems.length ? 'confirmed' : officialItems.length ? 'official' : 'ranked';
  const id = createHash('sha1').update(event.items.map(item => item.url).sort().join('|')).digest('hex').slice(0, 16);
  return {
    id, type, importance, official: officialItems.length > 0,
    titleRu: representative.titleRu || representative.title || '', titleEn: representative.titleEn || representative.title || '',
    summaryRu: representative.summaryRu || representative.summary || '', summaryEn: representative.summaryEn || representative.summary || '',
    publishedAt: event.publishedAt, game: event.game || representative.game || '',
    image: representative.image, imageSourceUrl: representative.imageSourceUrl,
    primaryUrl: (officialRepresentative || representative).url,
    primarySource: (officialRepresentative || representative).source,
    trendScore, mediaSourceCount, discussionMentions, sources,
    homeUntil: new Date(new Date(event.publishedAt).getTime() + (importance === 'critical' ? 168 : importance === 'major' ? 72 : type === 'official' ? 36 : 48) * 3600e3).toISOString()
  };
}).sort((a, b) => {
  const importance = { critical: 3, major: 2, normal: 1 };
  return importance[b.importance] - importance[a.importance] || b.trendScore - a.trendScore || new Date(b.publishedAt) - new Date(a.publishedAt);
});

await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: 'event-first', mergeWindowHours, items: output }, null, 2)}\n`);
console.log(`[events] built ${output.length} events from ${all.length} articles`);
