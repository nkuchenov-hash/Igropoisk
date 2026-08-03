import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJSON = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = readJSON('config/parsers/popular.json');
const catalog = readJSON('data/catalog-visible.json');
const now = Date.now();
const checkedAt = new Date(now).toISOString();
const timeout = 25_000;

const canonical = value => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const slugify = value => canonical(value).replace(/\s+/g, '-').slice(0, 90);
const decode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

const fetchText = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskPopularityParser/3.0',
      'accept-language': 'en-US,en;q=0.9',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};
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
      image: input.image || '',
      aliases: [],
      in_catalog: Boolean(input.in_catalog)
    };
    games.push(game);
    bySlug.set(slug, game);
  }
  game.title = game.title || title;
  game.year = game.year || input.year || null;
  game.steam_appid = game.steam_appid || Number(input.steam_appid || input.appid) || null;
  game.image = game.image || input.image || '';
  game.in_catalog = game.in_catalog || Boolean(input.in_catalog);
  game.aliases = [...new Set([
    ...(game.aliases || []),
    title,
    ...(input.aliases || [])
  ].filter(Boolean).map(canonical))].sort((a, b) => b.length - a.length);
  byTitle.set(canonical(title), game);
  if (game.steam_appid) byAppid.set(Number(game.steam_appid), game);
  return game;
}

for (const item of catalog) {
  const draft = drafts.get(item.slug);
  registerGame({
    ...item,
    title: item.title || item.name,
    steam_appid: draft?.identity?.steam_appid || item.steam_appid,
    image: draft?.media?.cover || draft?.media?.hero || item.cover || item.hero || '',
    aliases: [item.slug.replace(/-/g, ' ')],
    in_catalog: true
  });
}
for (const alias of config.aliases || []) registerGame(alias);

const signals = new Map();
const statuses = [];
function ensure(game) {
  if (!signals.has(game.slug)) signals.set(game.slug, { game, families: {}, evidence: [], newsSources: new Set() });
  return signals.get(game.slug);
}
function add(game, family, value, evidence = {}) {
  if (!game || !Number.isFinite(value) || value <= 0) return;
  const row = ensure(game);
  row.families[family] = (row.families[family] || 0) + value;
  if (family === 'news' && evidence.source) row.newsSources.add(evidence.source);
  row.evidence.push({ ...evidence, family, value: Number(value.toFixed(3)) });
}

function resolveNews(title) {
  const source = canonical(title);
  let best = null;
  for (const game of games) {
    for (const alias of game.aliases || []) {
      const words = alias.split(' ').length;
      if (words === 1) {
        const raw = String(title || '').trim().toLowerCase();
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^${escaped}(?:\\s*[:—–-]|$)`, 'i').test(raw)) continue;
      } else if (!(` ${source} `).includes(` ${alias} `)) {
        continue;
      }
      if (!best || alias.length > best.alias.length) best = { game, alias };
    }
  }
  return best?.game || null;
}

function recency(date) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 0;
  const ageHours = Math.max(0, (now - time) / 3_600_000);
  const windowHours = Number(config.method?.window_hours || 72);
  if (ageHours > windowHours) return 0;
  return Math.pow(0.5, ageHours / Number(config.method?.recency_half_life_hours || 18));
}
function xmlTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decode(match[1]);
  }
  return '';
}
function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(block => ({
    title: xmlTag(block, ['title']),
    date: xmlTag(block, ['pubDate', 'published', 'updated']),
    url: block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || xmlTag(block, ['link', 'guid'])
  })).filter(item => item.title);
}

async function collectNews() {
  for (const source of (config.sources || []).filter(item => item.enabled !== false && item.type === 'rss')) {
    const started = Date.now();
    try {
      const items = parseFeed(await fetchText(source.url));
      let matched = 0;
      for (const item of items) {
        const freshness = recency(item.date);
        if (!freshness) continue;
        const game = resolveNews(item.title);
        if (!game) continue;
        add(game, 'news', freshness, { source: source.name, title: item.title, url: item.url, observed_at: item.date });
        matched++;
      }
      statuses.push({ id: source.id, status: 'success', items: items.length, matched, duration_ms: Date.now() - started, url: source.url });
    } catch (error) {
      statuses.push({ id: source.id, status: 'error', error: error.message, duration_ms: Date.now() - started, url: source.url });
    }
  }
}

function parseSteamSearch(html) {
  const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
  const result = [];
  for (const row of rows) {
    const appidText = row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '';
    const appid = Number(appidText.split(',')[0]);
    const title = decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '');
    const image = row.match(/<img[^>]+src="([^"]+)"/i)?.[1] || '';
    if (appid && title) result.push({ appid, title, image });
  }
  return result;
}

async function collectSteamChart(id, url, weight) {
  const started = Date.now();
  try {
    const payload = await fetchJSON(url);
    const items = parseSteamSearch(payload.results_html || '');
    items.slice(0, 50).forEach((item, index) => {
      const game = byAppid.get(item.appid) || registerGame({
        title: item.title,
        appid: item.appid,
        image: item.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`
      });
      if (!game.image) game.image = item.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`;
      const positionScore = Math.max(0.05, 1 - index / 50) * weight;
      add(game, 'steam_chart', positionScore, { source: id, title: item.title, url: `https://store.steampowered.com/app/${item.appid}/`, position: index + 1, appid: item.appid });
    });
    statuses.push({ id, status: 'success', items: items.length, matched: items.length, duration_ms: Date.now() - started, url });
  } catch (error) {
    statuses.push({ id, status: 'error', error: error.message, duration_ms: Date.now() - started, url });
  }
}

async function enrichImages() {
  const candidates = [...signals.values()].map(row => row.game).filter(game => game.steam_appid && !game.image).slice(0, 40);
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(candidates.slice(i, i + 8).map(async game => {
      try {
        const data = await fetchJSON(`https://store.steampowered.com/api/appdetails?appids=${game.steam_appid}&cc=us&l=english`);
        const details = data?.[game.steam_appid]?.data;
        game.image = details?.capsule_imagev5 || details?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steam_appid}/library_600x900.jpg`;
      } catch {
        game.image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steam_appid}/library_600x900.jpg`;
      }
    }));
  }
}

const started = Date.now();
await Promise.all([
  collectNews(),
  collectSteamChart('Steam Top Sellers', 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=topsellers&infinite=1&cc=us&l=english&json=1', 1.0),
  collectSteamChart('Steam Most Played', 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=globaltopsellers&infinite=1&cc=us&l=english&json=1', 0.85)
]);
await enrichImages();

const rows = [...signals.values()];
const maxChart = Math.max(...rows.map(row => row.families.steam_chart || 0), 1);
const maxNews = Math.max(...rows.map(row => row.families.news || 0), 1);
let previous = null;
try { previous = readJSON('data/popular/current.json'); } catch {}
const previousRank = new Map((previous?.ranking || []).map(item => [item.slug, item.score]));

const ranking = rows.map(row => {
  const chart = (row.families.steam_chart || 0) / maxChart;
  const news = (row.families.news || 0) / maxNews;
  const sourceBreadth = Math.min(1, row.newsSources.size / 3);
  const hasChart = chart > 0;
  const hasNewsTrend = row.newsSources.size >= 2 && news > 0.05;
  if (!hasChart && !hasNewsTrend) return null;
  const score = Math.min(100, 100 * (0.72 * chart + 0.22 * news + 0.06 * sourceBreadth));
  const confidence = Math.min(1, 0.55 + (hasChart ? 0.2 : 0) + 0.08 * Math.min(row.newsSources.size, 3));
  const game = row.game;
  return {
    slug: game.slug,
    title: game.title,
    year: game.year || null,
    image: game.image || (game.steam_appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steam_appid}/library_600x900.jpg` : ''),
    score: Number(score.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
    delta: previousRank.has(game.slug) ? Number((score - previousRank.get(game.slug)).toFixed(1)) : null,
    families: Object.keys(row.families),
    signals: row.families,
    news_sources: row.newsSources.size,
    in_catalog: game.in_catalog,
    evidence: row.evidence.sort((a, b) => b.value - a.value).slice(0, 12)
  };
}).filter(Boolean).sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, 30);

const output = {
  schema_version: 3,
  generated_at: checkedAt,
  window_hours: config.method?.window_hours || 72,
  method: {
    formula: '72% global Steam chart position + 22% fresh editorial trend + 6% independent-source breadth',
    chart_size: 50,
    family_weights: { steam_chart: 0.72, news: 0.22, breadth: 0.06 }
  },
  ranking,
  discovered_unmatched: [],
  source_statuses: statuses
};

fs.mkdirSync(path.join(root, 'data', 'popular'), { recursive: true });
fs.mkdirSync(path.join(root, 'data', 'parser-runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'popular', 'current.json'), `${JSON.stringify(output, null, 2)}\n`);
const run = {
  parser: 'popular',
  status: ranking.length >= 10 ? 'success' : 'warning',
  checked_at: checkedAt,
  duration_ms: Date.now() - started,
  ranked_count: ranking.length,
  sources_success: statuses.filter(item => item.status === 'success').length,
  sources_total: statuses.length,
  output: 'data/popular/current.json',
  note: ranking.length >= 10 ? 'Глобальный рейтинг сформирован по Steam-чартам и свежему редакционному тренду.' : 'Источники вернули слишком мало данных.',
  source_statuses: statuses
};
fs.writeFileSync(path.join(root, 'data', 'parser-runs', 'popular.json'), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify(run, null, 2));
