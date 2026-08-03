import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const feeds = [
  { source: 'Игромания', url: 'https://www.igromania.ru/rss/rss_all.xml', language: 'ru', weight: 1.05 },
  { source: 'StopGame', url: 'https://stopgame.ru/rss/news.xml', language: 'ru', weight: 1.05 },
  { source: 'PlayGround.ru', url: 'https://www.playground.ru/rss/news.xml', language: 'ru', weight: 0.9 },
  { source: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', language: 'en', weight: 1.1 },
  { source: 'IGN', url: 'https://feeds.feedburner.com/ign/games-all', language: 'en', weight: 1.15 },
  { source: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', language: 'en', weight: 1.1 },
  { source: 'Eurogamer', url: 'https://www.eurogamer.net/feed/news', language: 'en', weight: 1.15 },
  { source: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', language: 'en', weight: 1.05 },
  { source: 'VGC', url: 'https://www.videogameschronicle.com/feed/', language: 'en', weight: 1.15 },
  { source: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed', language: 'en', weight: 1.0 },
  { source: 'GamesRadar+', url: 'https://www.gamesradar.com/rss/', language: 'en', weight: 1.0 },
  { source: 'GamingOnLinux', url: 'https://www.gamingonlinux.com/article_rss.php', language: 'en', weight: 0.9 },
  { source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/gaming', language: 'en', weight: 1.0 }
];

const redditFeeds = [
  'https://www.reddit.com/r/Games/hot.json?limit=75',
  'https://www.reddit.com/r/gaming/hot.json?limit=75',
  'https://www.reddit.com/r/pcgaming/hot.json?limit=50',
  'https://www.reddit.com/r/PS5/hot.json?limit=40',
  'https://www.reddit.com/r/XboxSeriesX/hot.json?limit=40',
  'https://www.reddit.com/r/NintendoSwitch/hot.json?limit=40'
];

const limit = 36;
const perFeedLimit = 40;
const maxPerSource = 4;
const outputPath = path.resolve('data/news.json');
const imageDirectory = path.resolve('assets/news');
const userAgent = 'IgropoiskNewsBot/4.0 (+https://github.com/nkuchenov-hash/Igropoisk)';

const rejectPatterns = [
  /survey|опрос/i,
  /chance to win|win \$|giveaway|розыгрыш|выигра[йт]/i,
  /newsletter|subscribe|подписывайтесь|подписка/i,
  /audience|читател[ья]|редакци[яи]/i,
  /podcast|подкаст/i,
  /quiz|викторин/i,
  /job opening|we(?:'re| are) hiring|ваканси/i,
  /support us|donate|patreon|поддержать издание/i,
  /deal of the day|best deals|скидки дня|распродажа/i,
  /gift guide|подарочный гид/i,
  /letter from the editor|обращение редакции/i,
  /future of pc gamer|будущее pc gamer/i,
  /review|рецензи[яи]|обзор/i,
  /opinion|column|колонка|мнение/i,
  /movie|film|cinema|anime|сериал|кино|аниме/i
];

const gamingSignals = [
  /\bgame\b|\bgames\b|игр[аыеу]|геймпле/i,
  /release|launch|релиз|выходит|вышла|вышел/i,
  /announce|анонс|представил|показал|трейлер/i,
  /update|patch|hotfix|обновлен|патч/i,
  /dlc|expansion|дополнени/i,
  /developer|studio|publisher|разработчик|студи[яи]|издател/i,
  /steam|valve|playstation|xbox|nintendo|switch|game pass|epic games/i,
  /pc|console|консол/i,
  /rpg|shooter|strategy|simulator|survival|horror|action|adventure|mmorpg/i,
  /движок|unreal engine|unity|directx|vulkan|proton|steam deck/i,
  /gaming gpu|gaming driver|игровой драйвер|игровая видеокарта/i,
  /sales|copies sold|тираж|продаж/i,
  /acquisition|layoffs|закрытие студии|увольнен|поглощени/i,
  /beta|demo|early access|бета|демоверси|ранний доступ/i,
  /esports|киберспорт/i
];

const stopWords = new Set([
  'the','a','an','and','or','but','for','to','of','in','on','with','from','at','by','as','is','are','was','were','will','would','could','should','this','that','these','those','its','it','new','news','game','games','gaming',
  'и','в','во','на','с','со','к','ко','из','для','о','об','от','по','за','что','как','это','этот','эта','эти','новый','новая','новые','игра','игры','игровой'
]);

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

function editoriallyRelevant(item) {
  const text = `${item.title} ${item.summary} ${item.url}`;
  if (rejectPatterns.some(pattern => pattern.test(text))) return false;
  return gamingSignals.some(pattern => pattern.test(text));
}

function normalizeText(value = '') {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  return new Set(normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !stopWords.has(token)));
}

function tokenSimilarity(a, b) {
  const left = a.tokens || titleTokens(a.title);
  const right = b.tokens || titleTokens(b.title);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
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
      sourceWeight: feed.weight,
      language: feed.language,
      url,
      tokens: titleTokens(title)
    };
  }).filter(item => item.title && item.url && editoriallyRelevant(item));
}

async function fetchText(url, timeoutMs = 18000, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept }
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
    const items = parseFeed(text, feed);
    console.log(`[news/feed] ${feed.source}: ${items.length} relevant items`);
    return items;
  } catch (error) {
    console.error(`[news/feed] ${feed.source}: ${error.message}`);
    return [];
  }
}

async function fetchRedditSignals() {
  const signals = [];
  for (const url of redditFeeds) {
    try {
      const { text } = await fetchText(url, 12000, 'application/json');
      const payload = JSON.parse(text);
      const children = payload?.data?.children || [];
      for (const child of children) {
        const data = child?.data;
        if (!data?.title) continue;
        signals.push({
          title: data.title,
          tokens: titleTokens(data.title),
          score: Number(data.score || 0),
          comments: Number(data.num_comments || 0),
          url: data.url_overridden_by_dest || data.url || ''
        });
      }
    } catch (error) {
      console.error(`[news/reddit] ${url}: ${error.message}`);
    }
  }
  return signals;
}

function clusterTopics(items) {
  const clusters = [];
  const sorted = [...items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  for (const item of sorted) {
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const representative = cluster.items[0];
      const similarity = tokenSimilarity(item, representative);
      const hoursApart = Math.abs(new Date(item.publishedAt) - new Date(representative.publishedAt)) / 36e5;
      if (hoursApart <= 72 && similarity > bestScore) {
        best = cluster;
        bestScore = similarity;
      }
    }

    if (best && bestScore >= 0.58) best.items.push(item);
    else clusters.push({ items: [item] });
  }

  return clusters;
}

function redditMomentum(cluster, signals) {
  let score = 0;
  let comments = 0;
  let mentions = 0;
  for (const signal of signals) {
    const similarity = Math.max(...cluster.items.map(item => tokenSimilarity(item, signal)));
    if (similarity < 0.55) continue;
    mentions += 1;
    score += Math.log10(signal.score + 1) * 8;
    comments += Math.log10(signal.comments + 1) * 10;
  }
  return { mentions, value: Math.round(score + comments) };
}

function scoreClusters(clusters, redditSignals) {
  const now = Date.now();
  return clusters.map(cluster => {
    const sources = [...new Set(cluster.items.map(item => item.source))];
    const newest = Math.max(...cluster.items.map(item => new Date(item.publishedAt).getTime()));
    const ageHours = Math.max(0, (now - newest) / 36e5);
    const sourceAuthority = cluster.items.reduce((sum, item) => sum + Number(item.sourceWeight || 1), 0);
    const reddit = redditMomentum(cluster, redditSignals);
    const crossSource = Math.max(0, sources.length - 1);
    const velocity = Math.max(0, 36 - ageHours);
    const trendScore = Math.round(
      crossSource * 120 +
      sourceAuthority * 18 +
      reddit.value +
      velocity * 2
    );

    const representative = [...cluster.items].sort((a, b) => {
      const sourceDiff = Number(b.sourceWeight || 1) - Number(a.sourceWeight || 1);
      return sourceDiff || new Date(b.publishedAt) - new Date(a.publishedAt);
    })[0];

    return {
      ...cluster,
      representative,
      sourceCount: sources.length,
      sources,
      redditMentions: reddit.mentions,
      trendScore,
      newest
    };
  }).sort((a, b) => b.trendScore - a.trendScore || b.newest - a.newest);
}

function selectTopics(scoredClusters) {
  const selected = [];
  const sourceCounts = new Map();

  for (const cluster of scoredClusters) {
    if (selected.length >= limit) break;
    const source = cluster.representative.source;
    const used = sourceCounts.get(source) || 0;
    if (used >= maxPerSource) continue;
    selected.push(cluster);
    sourceCounts.set(source, used + 1);
  }
  return selected;
}

function extractOriginalArticleImage(html, articleUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];
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
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(extension)) return extension === '.jpeg' ? '.jpg' : extension;
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
    if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`not an image: ${contentType || 'unknown'}`);
    const extension = extensionFor(contentType, response.url || imageUrl);
    if (!extension) throw new Error(`unsupported image type: ${contentType}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024) throw new Error('image is too small');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('image exceeds 20 MB');
    const filename = `${id}${extension}`;
    await fs.writeFile(path.join(imageDirectory, filename), bytes);
    return { image: `assets/news/${filename}`, imageSourceUrl: response.url || imageUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function hydrateTopic(cluster) {
  const item = cluster.representative;
  try {
    const { text: html, finalUrl } = await fetchText(item.url);
    const originalImageUrl = extractOriginalArticleImage(html, finalUrl);
    if (!originalImageUrl) throw new Error('original article has no main image');
    const downloaded = await downloadOriginalImage(originalImageUrl, item.id, finalUrl);
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt,
      source: item.source,
      language: item.language,
      url: finalUrl,
      ...downloaded,
      trendScore: cluster.trendScore,
      sourceCount: cluster.sourceCount,
      sources: cluster.sources,
      discussionMentions: cluster.redditMentions
    };
  } catch (error) {
    console.error(`[news/article] ${item.url}: ${error.message}`);
    return null;
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(imageDirectory, { recursive: true });

const [feedItemsNested, redditSignals] = await Promise.all([
  Promise.all(feeds.map(fetchFeed)),
  fetchRedditSignals()
]);

const feedItems = feedItemsNested.flat();
const deduplicated = [...new Map(feedItems.map(item => [item.url, item])).values()];
const clusters = clusterTopics(deduplicated);
const scoredClusters = scoreClusters(clusters, redditSignals);
const selectedTopics = selectTopics(scoredClusters);

const items = [];
for (const topic of selectedTopics) {
  const hydrated = await hydrateTopic(topic);
  if (hydrated) items.push(hydrated);
}

items.sort((a, b) => b.trendScore - a.trendScore || new Date(b.publishedAt) - new Date(a.publishedAt));
if (!items.length) throw new Error('No globally ranked gaming news with original images were found.');

const usedFiles = new Set(items.map(item => path.basename(item.image)));
const existingFiles = await fs.readdir(imageDirectory).catch(() => []);
await Promise.all(existingFiles.filter(filename => !usedFiles.has(filename)).map(filename => fs.rm(path.join(imageDirectory, filename), { force: true })));

await fs.writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  rankingMethod: 'Cross-source topic clustering + source authority + recency + Reddit discussion signals. One representative article per global topic.',
  items
}, null, 2)}\n`);

console.log(`[news] wrote ${items.length} globally ranked topics from ${new Set(items.flatMap(item => item.sources)).size} sources`);
