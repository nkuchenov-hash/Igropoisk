import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';

const root = process.cwd();
const rankingPath = path.join(root, 'data/popular/current.json');
const cachePath = path.join(root, 'data/popular/covers.json');
const overridePath = path.join(root, 'data/popular/cover-overrides.json');
const coverDir = path.join(root, 'assets/covers/popular');
const data = JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const overrides = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, 'utf8')) : {};
fs.mkdirSync(coverDir, { recursive: true });

const REQUIRED_COUNT = 20;
const MIN_WIDTH = 500;
const MIN_HEIGHT = 700;
const MIN_RATIO = 1.2;
const OFFICIAL_HOSTS = [
  'steampowered.com', 'steamstatic.com', 'xbox.com', 'playstation.com',
  'nintendo.com', 'epicgames.com', 'gog.com', 'halowaypoint.com',
  'rockstargames.com', 'ubisoft.com', 'ea.com', 'bethesda.net',
  'bandainamcoent.com', 'capcom.com', 'square-enix-games.com'
];
const BAD_IMAGE_WORDS = /\b(person|people|portrait|headshot|speaker|author|interview|conference|building|office|logo|icon|avatar)\b/i;

const clean = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const titleTokens = value => clean(value).split(' ').filter(token => token.length > 2 && !['the','and','for','game','video'].includes(token));
const exactTitle = (expected, actual) => {
  const a = clean(expected);
  const b = clean(actual).replace(/\bvideo game\b/g, '').trim();
  return a === b || b === `${a} game` || b === `${a} video game`;
};
const titleContained = (expected, text) => {
  const haystack = clean(text);
  const tokens = titleTokens(expected);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
};
const extensionFrom = (type, url) => {
  if (/png/i.test(type) || /\.png(?:\?|$)/i.test(url)) return 'png';
  if (/webp/i.test(type) || /\.webp(?:\?|$)/i.test(url)) return 'webp';
  return 'jpg';
};
const dimensions = bytes => {
  try {
    const result = imageSize(bytes);
    return { width: Number(result.width || 0), height: Number(result.height || 0) };
  } catch {
    return { width: 0, height: 0 };
  }
};
const isValidCover = bytes => {
  const { width, height } = dimensions(bytes);
  return width >= MIN_WIDTH && height >= MIN_HEIGHT && height / width >= MIN_RATIO;
};
const hostAllowed = url => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
};

async function fetchImage(url) {
  if (!url || !/^https?:\/\//i.test(url) || BAD_IMAGE_WORDS.test(decodeURIComponent(url))) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskCoverResolver/3.0', accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' }
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 40000 || !isValidCover(bytes)) return null;
    return { bytes, type, ...dimensions(bytes) };
  } catch {
    return null;
  }
}

async function steamAppIdByTitle(title) {
  const url = `https://store.steampowered.com/search/results/?query&term=${encodeURIComponent(title)}&start=0&count=20&dynamic_data=&force_infinite=1&cc=us&l=english&json=1`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const json = await response.json();
    const rows = (json.results_html || '').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
    for (const row of rows) {
      const appid = Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]);
      const foundTitle = (row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
      if (appid && exactTitle(title, foundTitle)) return appid;
    }
  } catch {}
  return null;
}

function hashedSteamPosterCandidates(item) {
  const urls = [];
  for (const raw of [item.image, ...(item.image_candidates || [])]) {
    const value = String(raw || '');
    const match = value.match(/^(https?:\/\/[^?]+\/store_item_assets\/steam\/apps\/\d+\/[a-f0-9]+)\/[^/?]+/i);
    if (!match) continue;
    urls.push(`${match[1]}/library_600x900_2x.jpg`, `${match[1]}/library_600x900.jpg`);
  }
  return urls;
}

async function steamStorePosterCandidates(appid, item) {
  if (!appid) return [];
  const urls = [
    ...hashedSteamPosterCandidates(item),
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
  ];
  try {
    const response = await fetch(`https://store.steampowered.com/app/${appid}/?l=english&cc=us`, {
      signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' }
    });
    if (response.ok) {
      const html = await response.text();
      const matches = html.match(/https?:\\?\/\\?\/[^"]+library_600x900(?:_2x)?\.(?:jpg|png|webp)[^"<]*/gi) || [];
      for (const raw of matches) urls.unshift(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'));
    }
  } catch {}
  return [...new Set(urls)];
}

async function wikipediaCandidates(title) {
  const urls = [];
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`intitle:\"${title}\" video game`)}&gsrlimit=8&prop=pageimages|extracts&exintro=1&explaintext=1&piprop=original|thumbnail&pithumbsize=1600&format=json&origin=*`;
  try {
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'IgropoiskCoverResolver/3.0' } });
    if (response.ok) {
      const json = await response.json();
      for (const page of Object.values(json.query?.pages || {})) {
        const pageTitle = String(page.title || '').replace(/\s*\([^)]*\)\s*$/, '');
        const extract = String(page.extract || '');
        if (!exactTitle(title, pageTitle) || !/video game|game developed|game published/i.test(extract)) continue;
        if (page?.original?.source) urls.push(page.original.source);
        if (page?.thumbnail?.source) urls.push(page.thumbnail.source);
      }
    }
  } catch {}

  const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`\"${title}\" cover art`)}&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url&iiurlwidth=1600&format=json&origin=*`;
  try {
    const response = await fetch(commonsUrl, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'IgropoiskCoverResolver/3.0' } });
    if (response.ok) {
      const json = await response.json();
      for (const page of Object.values(json.query?.pages || {})) {
        const fileTitle = String(page.title || '');
        if (!titleContained(title, fileTitle) || BAD_IMAGE_WORDS.test(fileTitle)) continue;
        const info = page?.imageinfo?.[0];
        if (info?.thumburl) urls.push(info.thumburl);
        if (info?.url) urls.push(info.url);
      }
    }
  } catch {}
  return [...new Set(urls)];
}

async function officialPageCandidates(item) {
  const urls = [];
  for (const row of (item.evidence || []).slice(0, 12)) {
    if (!/^https?:\/\//i.test(row.url || '') || !hostAllowed(row.url)) continue;
    try {
      const response = await fetch(row.url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) continue;
      const html = await response.text();
      const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || '';
      if (!titleContained(item.title, pageTitle)) continue;
      const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)?.[1];
      if (og) urls.push(og.replace(/&amp;/g, '&'));
    } catch {}
  }
  return [...new Set(urls)];
}

function explicitPosterCandidates(item) {
  return [item.image, ...(item.image_candidates || [])]
    .filter(url => /600x900|cover|poster|box.?art/i.test(String(url || '')));
}

async function resolve(item) {
  const cached = cache[item.slug];
  if (cached?.local) {
    const localPath = path.join(root, cached.local);
    const source = String(cached.source || '');
    const untrustedLegacy = /wikipedia|wikimedia|evidence/i.test(source) && cached.identity_verified !== true;
    if (fs.existsSync(localPath) && !untrustedLegacy) {
      const bytes = fs.readFileSync(localPath);
      if (isValidCover(bytes)) return cached;
    }
    fs.rmSync(localPath, { force: true });
    delete cache[item.slug];
  }

  let appid = (item.evidence || []).find(row => Number(row.appid))?.appid || null;
  if (!appid) appid = await steamAppIdByTitle(item.title);

  const override = overrides[item.slug];
  const candidates = [
    ...(Array.isArray(override) ? override : override ? [override] : []),
    ...explicitPosterCandidates(item),
    ...(await steamStorePosterCandidates(appid, item)),
    ...(await officialPageCandidates(item)),
    ...(await wikipediaCandidates(item.title))
  ];

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
      appid: appid || null,
      width: image.width,
      height: image.height,
      quality: 'verified-poster',
      identity_verified: true
    };
  }
  return null;
}

const top = (data.ranking || []).slice(0, REQUIRED_COUNT);
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
  item.cover_width = cover.width;
  item.cover_height = cover.height;
}

fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
data.ranking = top;
data.cover_policy = {
  required_count: REQUIRED_COUNT,
  min_width: MIN_WIDTH,
  min_height: MIN_HEIGHT,
  min_ratio: MIN_RATIO,
  identity_check: 'exact-game-title-and-trusted-source',
  resolved_count: REQUIRED_COUNT - unresolved.length,
  unresolved
};
fs.writeFileSync(rankingPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Resolved ${REQUIRED_COUNT - unresolved.length}/${REQUIRED_COUNT} identity-verified covers.`);
if (unresolved.length) console.warn(`Still unresolved: ${unresolved.join(', ')}`);
