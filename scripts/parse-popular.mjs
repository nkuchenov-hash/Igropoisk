import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameIndex, matchGame, normalizeTitle, slugify } from './lib/game-matcher.mjs';
import { fetchText, fetchJSON, fetchWithRetry, parseRSS, parseHTMLMeta, writeJSON, readJSON, sleep } from './lib/parser-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const checkedAt = new Date().toISOString();
const windowHours = 96;
const cutoff = Date.now() - windowHours * 3600 * 1000;
const catalog = loadGameIndex(root);
const youtubeSignals = readJSON(path.join(root, 'data', 'youtube-signals.json'), { videos: [] });
const sourceConfig = readJSON(path.join(root, 'data', 'news-sources.json'), { sources: [] });
const redditToken = process.env.REDDIT_ACCESS_TOKEN || '';
const twitchClientId = process.env.TWITCH_CLIENT_ID || '';
const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET || '';
const youtubeKey = process.env.YOUTUBE_API_KEY || '';

const signals = new Map();
const statuses = [];

function addSignal(title, family, value, evidence = {}, options = {}) {
  const matched = matchGame(catalog, title, options);
  const game = matched.game || {
    slug: slugify(title),
    title: String(title || '').trim(),
    year: null,
    image: '',
    in_catalog: false
  };
  if (!game.slug || !game.title) return;
  const row = signals.get(game.slug) || {
    game,
    families: { news: 0, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 },
    evidence: [],
    publishers: new Set(),
    steam_appid: null
  };
  row.families[family] += Math.max(0, Number(value) || 0);
  row.evidence.push({ ...evidence, family, value: Number((Number(value) || 0).toFixed(3)) });
  if (family === 'news' && evidence.source) row.publishers.add(evidence.source);
  if (evidence.appid) row.steam_appid = evidence.appid;
  if ((!row.game.image || !row.game.in_catalog) && matched.game?.image) row.game.image = matched.game.image;
  signals.set(game.slug, row);
}

async function runSource(id, fn, extra = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    statuses.push({ id, status: 'success', ...detail, duration_ms: Date.now() - started, ...extra });
  } catch (error) {
    statuses.push({ id, status: 'error', error: String(error.message || error), duration_ms: Date.now() - started, ...extra });
  }
}

function recentDate(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

async function collectNews() {
  const sources = (sourceConfig.sources || []).filter(source => source.type === 'rss' && source.enabled !== false).slice(0, 8);
  for (const source of sources) {
    await runSource(source.id, async () => {
      const xml = await fetchText(source.url, { timeoutMs: 20000 });
      const items = parseRSS(xml).filter(item => recentDate(item.pubDate) >= cutoff).slice(0, 100);
      let matched = 0;
      for (const item of items) {
        const title = String(item.title || '').replace(/\s+-\s+[^-]+$/, '');
        const match = matchGame(catalog, title);
        if (!match.game) continue;
        const age = Math.max(0, (Date.now() - recentDate(item.pubDate)) / 3600000);
        const freshness = Math.max(0.08, 1 - age / windowHours);
        addSignal(match.game.title, 'news', freshness, {
          source: source.name || source.id,
          title: item.title,
          url: item.link,
          observed_at: item.pubDate
        });
        matched++;
      }
      return { items: items.length, matched, url: source.url };
    });
  }
  for (const source of [
    { id: 'google-news-gaming', name: 'Google News', url: 'https://news.google.com/rss/search?q=gaming%20OR%20%22video%20game%22%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen' },
    { id: 'google-news-console-games', name: 'Google News', url: 'https://news.google.com/rss/search?q=PlayStation%20OR%20Xbox%20OR%20Nintendo%20OR%20Rockstar%20Games%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen' }
  ]) {
    await runSource(source.id, async () => {
      const xml = await fetchText(source.url, { timeoutMs: 20000 });
      const items = parseRSS(xml).filter(item => recentDate(item.pubDate) >= cutoff).slice(0, 100);
      let matched = 0;
      for (const item of items) {
        const title = String(item.title || '').replace(/\s+-\s+[^-]+$/, '');
        const match = matchGame(catalog, title);
        if (!match.game) continue;
        const age = Math.max(0, (Date.now() - recentDate(item.pubDate)) / 3600000);
        addSignal(match.game.title, 'news', Math.max(0.08, 1 - age / windowHours), {
          source: String(item.title || '').split(' - ').pop() || source.name,
          title: item.title,
          url: item.link,
          observed_at: item.pubDate
        });
        matched++;
      }
      return { items: items.length, matched, url: source.url };
    });
  }
}

async function collectReddit() {
  if (!redditToken) {
    await runSource('reddit-public', async () => {
      const payload = await fetchJSON('https://www.reddit.com/r/Games/hot.json?limit=100', {
        headers: { 'user-agent': 'IgropoiskParser/1.0' },
        timeoutMs: 20000
      });
      const posts = payload?.data?.children?.map(item => item.data) || [];
      let matched = 0;
      for (const post of posts) {
        const created = Number(post.created_utc || 0) * 1000;
        if (created < cutoff) continue;
        const match = matchGame(catalog, post.title);
        if (!match.game) continue;
        const value = Math.log1p(Math.max(0, post.score || 0)) + 0.7 * Math.log1p(Math.max(0, post.num_comments || 0));
        addSignal(match.game.title, 'reddit', value, {
          source: `r/${post.subreddit}`,
          title: post.title,
          url: `https://www.reddit.com${post.permalink}`,
          score: post.score || 0,
          comments: post.num_comments || 0
        });
        matched++;
      }
      return { items: posts.length, matched, url: 'https://www.reddit.com/r/Games/hot.json?limit=100' };
    });
    return;
  }
  await runSource('reddit-oauth', async () => {
    const payload = await fetchJSON('https://oauth.reddit.com/r/Games+gaming+pcgaming+PS5+XboxSeriesX+NintendoSwitch/hot?limit=100', {
      headers: { authorization: `Bearer ${redditToken}`, 'user-agent': 'IgropoiskParser/1.0' },
      timeoutMs: 20000
    });
    const posts = payload?.data?.children?.map(item => item.data) || [];
    let matched = 0;
    for (const post of posts) {
      const created = Number(post.created_utc || 0) * 1000;
      if (created < cutoff) continue;
      const match = matchGame(catalog, post.title);
      if (!match.game) continue;
      const value = Math.log1p(Math.max(0, post.score || 0)) + 0.7 * Math.log1p(Math.max(0, post.num_comments || 0));
      addSignal(match.game.title, 'reddit', value, {
        source: `r/${post.subreddit}`,
        title: post.title,
        url: `https://www.reddit.com${post.permalink}`,
        score: post.score || 0,
        comments: post.num_comments || 0
      });
      matched++;
    }
    return { items: posts.length, matched };
  });
}

async function collectYouTube() {
  const videos = (youtubeSignals.videos || []).filter(video => recentDate(video.publishedAt) >= cutoff);
  let matched = 0;
  for (const video of videos) {
    const match = matchGame(catalog, video.title);
    if (!match.game) continue;
    const views = Number(video.viewCount || 0);
    const comments = Number(video.commentCount || 0);
    const value = Math.log1p(views) + 0.6 * Math.log1p(comments);
    addSignal(match.game.title, 'youtube', value, {
      source: video.channelTitle || 'YouTube',
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      views,
      comments
    });
    matched++;
  }
  statuses.push({ id: 'youtube-popular', status: 'success', items: videos.length, matched, duration_ms: 0 });
}

async function collectTwitch() {
  if (!twitchClientId || !twitchClientSecret) {
    statuses.push({ id: 'twitch-top-games', status: 'skipped', reason: 'TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET not configured', duration_ms: 0 });
    return;
  }
  await runSource('twitch-top-games', async () => {
    const tokenResponse = await fetchJSON(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(twitchClientId)}&client_secret=${encodeURIComponent(twitchClientSecret)}&grant_type=client_credentials`, { method: 'POST', timeoutMs: 20000 });
    const token = tokenResponse.access_token;
    const headers = { 'Client-Id': twitchClientId, Authorization: `Bearer ${token}` };
    const games = await fetchJSON('https://api.twitch.tv/helix/games/top?first=50', { headers, timeoutMs: 20000 });
    let matched = 0;
    for (const [index, game] of (games.data || []).entries()) {
      const match = matchGame(catalog, game.name);
      if (!match.game) continue;
      addSignal(match.game.title, 'twitch', Math.max(1, 50 - index), {
        source: 'Twitch Top Games',
        title: game.name,
        url: `https://www.twitch.tv/directory/category/${slugify(game.name)}`,
        position: index + 1
      });
      matched++;
    }
    return { items: (games.data || []).length, matched };
  });
}

async function collectSteam() {
  const url = 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=topsellers&infinite=1&cc=us&l=english&json=1';
  await runSource('steam-top-sellers', async () => {
    const payload = await fetchJSON(url, { timeoutMs: 20000 });
    const html = payload.results_html || '';
    const regex = /<a[^>]+data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    let position = 0;
    let matched = 0;
    while ((match = regex.exec(html))) {
      position++;
      const appid = Number(match[1]);
      const titleMatch = match[2].match(/<span class="title">([\s\S]*?)<\/span>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!title) continue;
      const found = matchGame(catalog, title, { allowUnmatched: true });
      const canonicalTitle = found.game?.title || title;
      addSignal(canonicalTitle, 'steam_chart', Math.max(0.1, 1 - (position - 1) / 50), {
        source: 'Steam Top Sellers', title, url: `https://store.steampowered.com/app/${appid}/`, position, appid
      }, { allowUnmatched: true });
      const key = found.game?.slug || slugify(title);
      const row = signals.get(key);
      if (row) row.steam_appid = appid;
      matched++;
    }
    return { items: position, matched, url };
  });
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
  return [...new Set(candidates.filter(Boolean))];
}

const started = Date.now();
await Promise.all([collectNews(), collectReddit(), collectYouTube(), collectTwitch(), collectSteam()]);
const rows = [...signals.values()];
const maxima = {};
for (const family of ['news', 'reddit', 'youtube', 'twitch', 'steam_chart']) {
  maxima[family] = Math.max(...rows.map(row => row.families[family] || 0), 1);
}
const weights = { news: 0.35, reddit: 0.20, youtube: 0.15, twitch: 0.10, steam_chart: 0.15, breadth: 0.05 };
const excluded = new Set(['steam-deck', 'steam-machine', 'valve-index', 'steam-controller', 'steam-link']);
const ranking = [];
for (const row of rows) {
  if (excluded.has(row.game.slug)) continue;
  const normalized = {};
  for (const family of ['news', 'reddit', 'youtube', 'twitch', 'steam_chart']) normalized[family] = (row.families[family] || 0) / maxima[family];
  const activeCommunityFamilies = ['news', 'reddit', 'youtube', 'twitch'].filter(family => normalized[family] > 0.02);
  const discussed = row.publishers.size >= 2 || activeCommunityFamilies.length >= 2;
  const hasDemand = normalized.steam_chart > 0;
  const hasFreshCommunitySignal = ['news', 'reddit', 'youtube', 'twitch'].some(family => row.families[family] > 0);
  if (!discussed && !hasDemand && !hasFreshCommunitySignal) continue;
  const breadth = Math.min(1, (row.publishers.size + activeCommunityFamilies.length) / 7);
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
    confidence: Number(Math.min(1, 0.45 + 0.08 * activeCommunityFamilies.length + 0.04 * Math.min(row.publishers.size, 5) + (hasDemand ? 0.08 : 0)).toFixed(2)),
    delta: null,
    families: ['news', 'reddit', 'youtube', 'twitch', 'steam_chart'].filter(family => row.families[family] > 0),
    signals: row.families,
    news_sources: row.publishers.size,
    in_catalog: row.game.in_catalog,
    evidence: row.evidence.sort((a, b) => b.value - a.value).slice(0, 20)
  });
}
ranking.sort((a, b) => b.score - a.score || b.confidence - a.confidence);

const output = {
  schema_version: 6,
  generated_at: checkedAt,
  window_hours: 96,
  method: {
    formula: '35% news + 20% Reddit + 15% YouTube + 10% Twitch + 15% Steam demand + 5% breadth',
    family_weights: weights,
    image_fallback: 'catalog/manual → Steam vertical poster → Steam app details → header/capsule',
    candidate_pool: 80
  },
  ranking: ranking.slice(0, 80),
  discovered_unmatched: [],
  source_statuses: statuses
};
fs.mkdirSync(path.join(root, 'data', 'popular'), { recursive: true });
fs.mkdirSync(path.join(root, 'data', 'parser-runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'popular', 'current.json'), `${JSON.stringify(output, null, 2)}\n`);
const run = {
  parser: 'popular',
  status: ranking.length >= 20 ? 'success' : 'warning',
  checked_at: checkedAt,
  duration_ms: Date.now() - started,
  ranked_count: ranking.length,
  candidate_count: Math.min(80, ranking.length),
  sources_success: statuses.filter(item => item.status === 'success').length,
  sources_total: statuses.length,
  output: 'data/popular/current.json',
  note: 'Рейтинг рассчитан по свежим новостям, Reddit, YouTube, Twitch, Steam и широте независимых сигналов; quality filter публикует только 20–30 пригодных позиций.',
  source_statuses: statuses
};
fs.writeFileSync(path.join(root, 'data', 'parser-runs', 'popular.json'), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify(run, null, 2));
