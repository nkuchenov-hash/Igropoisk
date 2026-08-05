import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJSON = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = readJSON('config/parsers/popular.json');
const catalog = readJSON('data/catalog-visible.json');
const now = Date.now();
const checkedAt = new Date(now).toISOString();
const timeout = 25_000;

const canonical = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/&amp;/g, ' and ').replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const slugify = value => canonical(value).replace(/\s+/g, '-').slice(0, 90);
const decode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskPopularityParser/7.0',
      'accept-language': 'en-US,en;q=0.9',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
const fetchJSON = async (url, options = {}) => JSON.parse(await fetchText(url, options));

const drafts = new Map();
const draftDir = path.join(root, 'data', 'drafts');
if (fs.existsSync(draftDir)) {
  for (const filename of fs.readdirSync(draftDir).filter(name => name.endsWith('.json'))) {
    try {
      const draft = readJSON(`data/drafts/${filename}`);
      if (draft?.identity?.slug) drafts.set(draft.identity.slug, draft);
    } catch {}
  }
}

const manualMedia = {
  'grand-theft-auto-vi': 'https://www.igrandtheftauto.com/content/images/grand-theft-auto-vi-official-cover-art-hi-res.jpg'
};
const games = [];
const bySlug = new Map();
const byTitle = new Map();
const byAppid = new Map();

function registerGame(input) {
  const title = String(input.title || input.name || '').trim();
  if (!title) return null;
  const slug = input.slug || slugify(title);
  let game = bySlug.get(slug) || byTitle.get(canonical(title));
  if (!game) {
    game = {
      slug,
      title,
      year: input.year || null,
      steam_appid: Number(input.steam_appid || input.appid) || null,
      image: input.image || manualMedia[slug] || '',
      aliases: [],
      in_catalog: Boolean(input.in_catalog),
      global_candidate: Boolean(input.global_candidate)
    };
    games.push(game);
    bySlug.set(slug, game);
  }
  game.year ||= input.year || null;
  game.steam_appid ||= Number(input.steam_appid || input.appid) || null;
  game.image ||= input.image || manualMedia[slug] || '';
  game.in_catalog ||= Boolean(input.in_catalog);
  game.global_candidate ||= Boolean(input.global_candidate);
  game.aliases = [...new Set([...(game.aliases || []), title, ...(input.aliases || [])]
    .filter(Boolean).map(canonical))].sort((a, b) => b.length - a.length);
  byTitle.set(canonical(title), game);
  if (game.steam_appid) byAppid.set(game.steam_appid, game);
  return game;
}

for (const item of catalog) {
  const draft = drafts.get(item.slug);
  registerGame({
    ...item,
    title: item.title || item.name,
    steam_appid: draft?.identity?.steam_appid || item.steam_appid,
    image: draft?.media?.cover || draft?.media?.hero || item.cover || item.hero || manualMedia[item.slug] || '',
    aliases: [item.slug.replace(/-/g, ' ')],
    in_catalog: true
  });
}
for (const candidate of config.global_candidates || []) registerGame({ ...candidate, global_candidate: true });
for (const alias of config.aliases || []) registerGame(alias);

const signals = new Map();
const statuses = [];
function ensure(game) {
  if (!signals.has(game.slug)) signals.set(game.slug, {
    game,
    families: { news: 0, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 },
    publishers: new Map(),
    evidence: []
  });
  return signals.get(game.slug);
}
function resolve(title) {
  const normalized = canonical(title);
  const exact = byTitle.get(normalized);
  if (exact) return exact;
  const value = ` ${normalized} `;
  let best = null;
  for (const game of games) {
    for (const alias of game.aliases || []) {
      const words = alias.split(' ').length;
      if (words === 1 && alias.length < 5) continue;
      if (value.includes(` ${alias} `) && (!best || alias.length > best.alias.length)) best = { game, alias };
    }
  }
  return best?.game || null;
}
function recency(date, windowHours = 96, halfLife = 24) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 0;
  const age = Math.max(0, (now - time) / 3_600_000);
  if (age > windowHours) return 0;
  return Math.pow(0.5, age / halfLife);
}
function xmlTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decode(match[1]);
  }
  return '';
}
function parseFeed(xml) {
  return (xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || []).map(block => ({
    title: xmlTag(block, ['title']),
    date: xmlTag(block, ['pubDate', 'published', 'updated']),
    url: block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || xmlTag(block, ['link', 'guid'])
  })).filter(item => item.title);
}
function publisherFrom(item, source) {
  if (String(source.id || '').startsWith('google-news-')) {
    return item.title.match(/\s+-\s+([^–—|]{2,100})$/)?.[1]?.trim() || source.name;
  }
  return source.name;
}

const newsFeeds = [
  ...(config.sources || []).filter(item => item.enabled !== false && item.type === 'rss'),
  { id: 'google-news-gaming', name: 'Google News Gaming', url: 'https://news.google.com/rss/search?q=gaming%20OR%20%22video%20game%22%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen' },
  { id: 'google-news-console-games', name: 'Google News Console Games', url: 'https://news.google.com/rss/search?q=PlayStation%20OR%20Xbox%20OR%20Nintendo%20OR%20Rockstar%20Games%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen' }
];

async function collectNews() {
  for (const source of newsFeeds) {
    const started = Date.now();
    try {
      const items = parseFeed(await fetchText(source.url));
      let matched = 0;
      for (const item of items) {
        const freshness = recency(item.date);
        if (!freshness) continue;
        const game = resolve(item.title);
        if (!game) continue;
        const row = ensure(game);
        if (row.evidence.some(e => e.url && e.url === item.url)) continue;
        const publisher = publisherFrom(item, source);
        const publisherId = canonical(publisher);
        row.families.news += freshness;
        if (publisherId) row.publishers.set(publisherId, publisher);
        row.evidence.push({ source: publisher, publisher_id: publisherId, title: item.title, url: item.url, observed_at: item.date, family: 'news', value: Number(freshness.toFixed(3)) });
        matched++;
      }
      statuses.push({ id: source.id, status: 'success', items: items.length, matched, duration_ms: Date.now() - started, url: source.url });
    } catch (error) {
      statuses.push({ id: source.id, status: 'error', error: error.message, duration_ms: Date.now() - started, url: source.url });
    }
  }
}

async function collectReddit() {
  const started = Date.now();
  const urls = [
    'https://www.reddit.com/r/Games/hot.json?limit=100',
    'https://www.reddit.com/r/gaming/hot.json?limit=100',
    'https://www.reddit.com/r/pcgaming/hot.json?limit=100',
    'https://www.reddit.com/r/PS5/hot.json?limit=100',
    'https://www.reddit.com/r/XboxSeriesX/hot.json?limit=100',
    'https://www.reddit.com/r/NintendoSwitch/hot.json?limit=100'
  ];
  let items = 0;
  let matched = 0;
  try {
    for (const url of urls) {
      const data = await fetchJSON(url, { headers: { accept: 'application/json' } });
      for (const child of data?.data?.children || []) {
        const post = child.data || {};
        items++;
        const game = resolve(`${post.title || ''} ${post.link_flair_text || ''}`);
        if (!game) continue;
        const observedAt = new Date(Number(post.created_utc || 0) * 1000).toISOString();
        const age = recency(observedAt, 72, 18);
        if (!age) continue;
        const engagement = Math.log1p(Math.max(0, Number(post.score || 0))) + 0.6 * Math.log1p(Number(post.num_comments || 0));
        const value = age * engagement;
        if (value <= 0) continue;
        const row = ensure(game);
        row.families.reddit += value;
        row.evidence.push({ source: `Reddit r/${post.subreddit}`, title: post.title, url: `https://www.reddit.com${post.permalink || ''}`, observed_at: observedAt, family: 'reddit', score: post.score, comments: post.num_comments, value: Number(value.toFixed(3)) });
        matched++;
      }
    }
    statuses.push({ id: 'reddit-public', status: 'success', items, matched, duration_ms: Date.now() - started, url: urls[0] });
  } catch (error) {
    statuses.push({ id: 'reddit-public', status: 'error', error: error.message, duration_ms: Date.now() - started, url: urls[0] });
  }
}

async function collectYouTube() {
  const key = process.env.YOUTUBE_API_KEY;
  const started = Date.now();
  if (!key) {
    statuses.push({ id: 'youtube-popular', status: 'skipped', error: 'YOUTUBE_API_KEY is not configured' });
    return;
  }
  try {
    let items = 0;
    let matched = 0;
    for (const region of ['US', 'GB', 'DE', 'FR', 'BR', 'JP']) {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&videoCategoryId=20&maxResults=50&regionCode=${region}&key=${encodeURIComponent(key)}`;
      const data = await fetchJSON(url);
      for (const video of data.items || []) {
        items++;
        const title = video.snippet?.title || '';
        const game = resolve(`${title} ${(video.snippet?.tags || []).join(' ')}`);
        if (!game) continue;
        const views = Number(video.statistics?.viewCount || 0);
        const comments = Number(video.statistics?.commentCount || 0);
        const value = Math.log1p(views) + 0.5 * Math.log1p(comments);
        const row = ensure(game);
        row.families.youtube += value;
        row.evidence.push({ source: `YouTube ${region}`, title, url: `https://www.youtube.com/watch?v=${video.id}`, observed_at: video.snippet?.publishedAt || checkedAt, family: 'youtube', views, comments, value: Number(value.toFixed(3)) });
        matched++;
      }
    }
    statuses.push({ id: 'youtube-popular', status: 'success', items, matched, duration_ms: Date.now() - started });
  } catch (error) {
    statuses.push({ id: 'youtube-popular', status: 'error', error: error.message, duration_ms: Date.now() - started });
  }
}

async function collectTwitch() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  const started = Date.now();
  if (!clientId || !secret) {
    statuses.push({ id: 'twitch-top-games', status: 'skipped', error: 'TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are not configured' });
    return;
  }
  try {
    const token = await fetchJSON(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { method: 'POST' });
    const data = await fetchJSON('https://api.twitch.tv/helix/games/top?first=100', { headers: { Authorization: `Bearer ${token.access_token}`, 'Client-Id': clientId } });
    let matched = 0;
    for (const [index, category] of (data.data || []).entries()) {
      const image = String(category.box_art_url || '').replace('{width}', '600').replace('{height}', '900');
      const game = resolve(category.name) || registerGame({ title: category.name, image, global_candidate: true });
      if (!game) continue;
      game.image ||= image;
      const value = Math.max(0.01, 1 - index / 100);
      const row = ensure(game);
      row.families.twitch = Math.max(row.families.twitch, value);
      row.evidence.push({ source: 'Twitch Top Games', title: category.name, url: `https://www.twitch.tv/directory/category/${slugify(category.name)}`, observed_at: checkedAt, position: index + 1, family: 'twitch', value: Number(value.toFixed(3)) });
      matched++;
    }
    statuses.push({ id: 'twitch-top-games', status: 'success', items: (data.data || []).length, matched, duration_ms: Date.now() - started });
  } catch (error) {
    statuses.push({ id: 'twitch-top-games', status: 'error', error: error.message, duration_ms: Date.now() - started });
  }
}

function parseSteam(html) {
  const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
  return rows.map(row => ({
    appid: Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]),
    title: decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || ''),
    image: row.match(/<img[^>]+src="([^"]+)"/i)?.[1] || ''
  })).filter(item => item.appid && item.title);
}
async function collectSteam() {
  const url = 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=topsellers&infinite=1&cc=us&l=english&json=1';
  const started = Date.now();
  try {
    const items = parseSteam((await fetchJSON(url)).results_html || '');
    items.slice(0, 50).forEach((item, index) => {
      const game = byAppid.get(item.appid) || registerGame({ title: item.title, appid: item.appid, image: item.image });
      const row = ensure(game);
      row.families.steam_chart = Math.max(row.families.steam_chart, 1 - index / 50);
      row.evidence.push({ source: 'Steam Top Sellers', title: item.title, url: `https://store.steampowered.com/app/${item.appid}/`, observed_at: checkedAt, position: index + 1, appid: item.appid, family: 'steam_chart', value: Number((1 - index / 50).toFixed(3)) });
    });
    statuses.push({ id: 'steam-top-sellers', status: 'success', items: items.length, matched: items.length, duration_ms: Date.now() - started, url });
  } catch (error) {
    statuses.push({ id: 'steam-top-sellers', status: 'error', error: error.message, duration_ms: Date.now() - started, url });
  }
}

async function imageCandidates(game) {
  const candidates = [];
  if (game.image) candidates.push(game.image);
  if (game.steam_appid) {
    const appid = game.steam_appid;
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
    );
    try {
      const data = await fetchJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
      const details = data?.[appid]?.data;
      if (details?.capsule_imagev5) candidates.push(details.capsule_imagev5);
      if (details?.header_image) candidates.push(details.header_image);
    } catch {}
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
    );
  }
  if (!candidates.length && game.global_candidate) {
    try {
      const summary = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(game.title.replace(/\s+/g, '_'))}`);
      if (summary?.originalimage?.source) candidates.push(summary.originalimage.source);
      if (summary?.thumbnail?.source) candidates.push(summary.thumbnail.source);
    } catch {}
  }
  return [...new Set(candidates.filter(Boolean))];
}

const started = Date.now();
await Promise.all([collectNews(), collectReddit(), collectYouTube(), collectTwitch(), collectSteam()]);
const rows = [...signals.values()];
const maxima = {};
for (const family of ['news', 'reddit', 'youtube', 'twitch', 'steam_chart']) {
  maxima[family] = Math.max(...rows.map(row => row.families[family] || 0), 1);
}
const weights = { news: 0.30, reddit: 0.15, youtube: 0.15, twitch: 0.20, steam_chart: 0.15, breadth: 0.05 };
const excluded = new Set(['steam-deck', 'steam-machine', 'valve-index', 'steam-controller', 'steam-link']);
const ranking = [];
for (const row of rows) {
  if (excluded.has(row.game.slug)) continue;
  const normalized = {};
  for (const family of ['news', 'reddit', 'youtube', 'twitch', 'steam_chart']) normalized[family] = (row.families[family] || 0) / maxima[family];
  const activeFamilies = ['news', 'reddit', 'youtube', 'twitch', 'steam_chart'].filter(family => normalized[family] > 0.01);
  if (!activeFamilies.length) continue;
  const activeCommunityFamilies = ['news', 'reddit', 'youtube', 'twitch'].filter(family => normalized[family] > 0.02);
  const hasPlatform = normalized.steam_chart > 0 || normalized.twitch > 0;
  const breadth = Math.min(1, (row.publishers.size + activeCommunityFamilies.length) / 8);
  const score = 100 * (
    weights.news * normalized.news +
    weights.reddit * normalized.reddit +
    weights.youtube * normalized.youtube +
    weights.twitch * normalized.twitch +
    weights.steam_chart * normalized.steam_chart +
    weights.breadth * breadth
  );
  const candidates = await imageCandidates(row.game);
  ranking.push({
    slug: row.game.slug,
    title: row.game.title,
    year: row.game.year || null,
    image: candidates[0] || '',
    image_candidates: candidates,
    score: Number(score.toFixed(1)),
    confidence: Number(Math.min(1, 0.35 + 0.09 * activeCommunityFamilies.length + 0.04 * Math.min(row.publishers.size, 6) + (hasPlatform ? 0.1 : 0)).toFixed(2)),
    delta: null,
    families: activeFamilies,
    signals: row.families,
    news_sources: row.publishers.size,
    news_publishers: [...row.publishers.values()],
    in_catalog: row.game.in_catalog,
    global_candidate: row.game.global_candidate,
    evidence: row.evidence.sort((a, b) => Number(b.value || 0) - Number(a.value || 0)).slice(0, 24)
  });
}
ranking.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.title.localeCompare(b.title, 'en'));

const output = {
  schema_version: 7,
  generated_at: checkedAt,
  window_hours: 96,
  method: {
    formula: '30% news + 15% Reddit + 15% YouTube + 20% Twitch chart + 15% Steam chart + 5% breadth',
    family_weights: weights,
    news_sources_are_publishers: true,
    candidate_universe: 'catalog + global candidates + Steam chart + Twitch chart',
    image_fallback: 'catalog/manual → Twitch box art → Steam vertical poster → Steam app details → Wikipedia image'
  },
  ranking: ranking.slice(0, 60),
  discovered_unmatched: [],
  source_statuses: statuses
};
fs.mkdirSync(path.join(root, 'data', 'popular'), { recursive: true });
fs.mkdirSync(path.join(root, 'data', 'parser-runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'popular', 'current.json'), `${JSON.stringify(output, null, 2)}\n`);
const run = {
  parser: 'popular',
  status: ranking.length >= 10 ? 'success' : ranking.length ? 'partial' : 'error',
  checked_at: checkedAt,
  duration_ms: Date.now() - started,
  ranked_count: ranking.length,
  sources_success: statuses.filter(item => item.status === 'success').length,
  sources_total: statuses.length,
  output: 'data/popular/current.json',
  note: 'Кандидаты рассчитаны по независимым изданиям, YouTube, Reddit и текущим чартам Twitch/Steam; финальный отбор выполняется отдельным куратором.',
  source_statuses: statuses
};
fs.writeFileSync(path.join(root, 'data', 'parser-runs', 'popular.json'), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify(run, null, 2));
