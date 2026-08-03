import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rankingPath = path.join(root, 'data/popular/current.json');
const cachePath = path.join(root, 'data/popular/covers.json');
const coverDir = path.join(root, 'assets/covers/popular');
const data = JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
fs.mkdirSync(coverDir, { recursive: true });

const REQUIRED_COUNT = 20;
const clean = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const sameTitle = (a, b) => {
  const aa = clean(a), bb = clean(b);
  return aa === bb || aa.includes(bb) || bb.includes(aa);
};
const extensionFrom = (type, url) => {
  if (/png/i.test(type) || /\.png(?:\?|$)/i.test(url)) return 'png';
  if (/webp/i.test(type) || /\.webp(?:\?|$)/i.test(url)) return 'webp';
  return 'jpg';
};

async function fetchImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskCoverResolver/1.1', accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' }
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 20000) return null;
    return { bytes, type };
  } catch { return null; }
}

async function steamAppIdByTitle(title) {
  const url = `https://store.steampowered.com/search/results/?query&term=${encodeURIComponent(title)}&start=0&count=20&dynamic_data=&force_infinite=1&cc=us&l=english&json=1`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const json = await response.json();
    const html = json.results_html || '';
    const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
    for (const row of rows) {
      const appid = Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]);
      const foundTitle = (row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
      if (appid && sameTitle(title, foundTitle)) return appid;
    }
  } catch {}
  return null;
}

async function wikipediaImage(title) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`\"${title}\" video game`)}&gsrlimit=5&prop=pageimages&piprop=original|thumbnail&pithumbsize=1200&format=json&origin=*`;
  try {
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'IgropoiskCoverResolver/1.1' } });
    if (!response.ok) return null;
    const json = await response.json();
    const pages = Object.values(json.query?.pages || {});
    const page = pages.find(item => sameTitle(title, item.title)) || pages[0];
    return page?.original?.source || page?.thumbnail?.source || null;
  } catch { return null; }
}

function hashedSteamPosterCandidates(url) {
  const value = String(url || '');
  if (!/store_item_assets\/steam\/apps\/\d+\//i.test(value)) return [];
  const base = value.replace(/\/[^/?]+(?:\?.*)?$/, '');
  return [`${base}/library_600x900_2x.jpg`, `${base}/library_600x900.jpg`];
}

async function resolve(item) {
  const cached = cache[item.slug];
  if (cached?.local && fs.existsSync(path.join(root, cached.local))) return cached;

  let appid = (item.evidence || []).find(row => Number(row.appid))?.appid || null;
  if (!appid) appid = await steamAppIdByTitle(item.title);

  const candidates = [];
  for (const url of [item.image, ...(item.image_candidates || [])]) {
    candidates.push(...hashedSteamPosterCandidates(url));
  }
  if (appid) {
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900_2x.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`
    );
  }
  for (const url of item.image_candidates || []) {
    if (/600x900|cover|poster/i.test(url)) candidates.push(url);
  }
  if (item.image && /600x900|cover|poster/i.test(item.image)) candidates.push(item.image);
  const wiki = await wikipediaImage(item.title);
  if (wiki) candidates.push(wiki);

  for (const url of [...new Set(candidates)]) {
    const image = await fetchImage(url);
    if (!image) continue;
    const ext = extensionFrom(image.type, url);
    const relative = `assets/covers/popular/${item.slug}.${ext}`;
    fs.writeFileSync(path.join(root, relative), image.bytes);
    return { local: relative, source: url, resolved_at: new Date().toISOString(), appid: appid || null };
  }
  return null;
}

const top = (data.ranking || []).slice(0, REQUIRED_COUNT);
if (top.length < REQUIRED_COUNT) {
  console.error(`Refusing to publish incomplete ranking: expected ${REQUIRED_COUNT}, received ${top.length}.`);
  process.exit(2);
}

const unresolved = [];
for (const item of top) {
  const cover = await resolve(item);
  if (!cover) {
    unresolved.push(item.title);
    continue;
  }
  cache[item.slug] = cover;
  item.image = cover.local;
  item.image_candidates = [cover.local];
  item.cover_source = cover.source;
  item.cover_verified = true;
}

fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
if (unresolved.length) {
  console.error(`Refusing to publish top ${REQUIRED_COUNT} without verified covers: ${unresolved.join(', ')}`);
  process.exit(2);
}
data.ranking = top;
data.cover_policy = { required_count: REQUIRED_COUNT, verified_count: REQUIRED_COUNT, placeholders_allowed: false };
fs.writeFileSync(rankingPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Verified and stored ${REQUIRED_COUNT} popular-game covers.`);
