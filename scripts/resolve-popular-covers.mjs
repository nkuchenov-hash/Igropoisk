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
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; IgropoiskCoverResolver/2.0)',
        accept: 'image/avif,image/webp,image/png,image/jpeg,*/*'
      }
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 5000) return null;
    return { bytes, type };
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; IgropoiskCoverResolver/2.0)' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function steamAppIdByTitle(title) {
  const url = `https://store.steampowered.com/search/results/?query&term=${encodeURIComponent(title)}&start=0&count=20&dynamic_data=&force_infinite=1&cc=us&l=english&json=1`;
  const json = await fetchJson(url);
  const html = json?.results_html || '';
  const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
  for (const row of rows) {
    const appid = Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]);
    const foundTitle = (row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    if (appid && sameTitle(title, foundTitle)) return appid;
  }
  return null;
}

async function steamDetailsCandidates(appid) {
  if (!appid) return [];
  const json = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
  const row = json?.[appid];
  if (!row?.success) return [];
  const details = row.data || {};
  return [details.header_image, details.capsule_image, details.capsule_imagev5].filter(Boolean);
}

async function wikipediaCandidates(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`\"${title}\" video game`)}&gsrlimit=8&prop=pageimages&piprop=original|thumbnail&pithumbsize=1400&format=json&origin=*`;
  const json = await fetchJson(url);
  const pages = Object.values(json?.query?.pages || {});
  const ordered = pages.sort((a, b) => Number(sameTitle(title, b.title)) - Number(sameTitle(title, a.title)));
  return ordered.flatMap(page => [page?.original?.source, page?.thumbnail?.source]).filter(Boolean);
}

function steamPosterCandidates(appid) {
  if (!appid) return [];
  return [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
  ];
}

async function resolve(item) {
  const cached = cache[item.slug];
  if (cached?.local && fs.existsSync(path.join(root, cached.local))) return cached;

  let appid = (item.evidence || []).find(row => Number(row.appid))?.appid || null;
  if (!appid) appid = await steamAppIdByTitle(item.title);

  const candidates = [
    item.image,
    ...(item.image_candidates || []),
    ...steamPosterCandidates(appid),
    ...(await steamDetailsCandidates(appid)),
    ...(await wikipediaCandidates(item.title))
  ].filter(Boolean);

  for (const url of [...new Set(candidates)]) {
    const image = await fetchImage(url);
    if (!image) continue;
    const ext = extensionFrom(image.type, url);
    const relative = `assets/covers/popular/${item.slug}.${ext}`;
    fs.writeFileSync(path.join(root, relative), image.bytes);
    return {
      local: relative,
      source: url,
      resolved_at: new Date().toISOString(),
      appid: appid || null
    };
  }
  return null;
}

const top = (data.ranking || []).slice(0, REQUIRED_COUNT);
const unresolved = [];
let resolvedCount = 0;

for (const item of top) {
  const cover = await resolve(item);
  if (!cover) {
    unresolved.push(item.title);
    continue;
  }
  resolvedCount += 1;
  cache[item.slug] = cover;
  item.image = cover.local;
  item.image_candidates = [cover.local];
  item.cover_source = cover.source;
  item.cover_verified = true;
}

fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
data.cover_policy = {
  required_count: REQUIRED_COUNT,
  resolved_count: resolvedCount,
  unresolved,
  placeholders_allowed: false,
  ranking_affected_by_cover_status: false
};
fs.writeFileSync(rankingPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Stored ${resolvedCount}/${top.length} popular-game covers. Unresolved: ${unresolved.join(', ') || 'none'}.`);
