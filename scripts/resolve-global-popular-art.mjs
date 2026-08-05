import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';

const root = process.cwd();
const rankingPath = path.join(root, 'data/popular/current.json');
const cachePath = path.join(root, 'data/popular/covers.json');
const coverDir = path.join(root, 'assets/covers/popular');
const data = JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
fs.mkdirSync(coverDir, { recursive: true });

const canonical = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const exactTitle = (expected, actual) => canonical(expected) === canonical(actual);
const dimensions = bytes => {
  try {
    const result = imageSize(bytes);
    return { width: Number(result.width || 0), height: Number(result.height || 0) };
  } catch {
    return { width: 0, height: 0 };
  }
};
const extensionFrom = (type, url) => {
  if (/png/i.test(type) || /\.png(?:\?|$)/i.test(url)) return 'png';
  if (/webp/i.test(type) || /\.webp(?:\?|$)/i.test(url)) return 'webp';
  return 'jpg';
};

async function officialAppStoreArt(item) {
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(item.title)}&entity=software&country=us&limit=10`;
  const response = await fetch(searchUrl, {
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'IgropoiskGlobalArtResolver/1.0' }
  });
  if (!response.ok) return null;
  const json = await response.json();
  const match = (json.results || []).find(result => exactTitle(item.title, result.trackName || ''));
  if (!match) return null;
  const urls = [
    match.artworkUrl512,
    match.artworkUrl100?.replace(/100x100(?:bb)?/i, '1024x1024bb'),
    match.artworkUrl60?.replace(/60x60(?:bb)?/i, '1024x1024bb')
  ].filter(Boolean);

  for (const url of [...new Set(urls)]) {
    try {
      const imageResponse = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'IgropoiskGlobalArtResolver/1.0', accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' }
      });
      if (!imageResponse.ok) continue;
      const type = imageResponse.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      const size = dimensions(bytes);
      const ratio = size.height && size.width ? size.height / size.width : 0;
      if (bytes.length < 30000 || size.width < 500 || size.height < 500 || ratio < 0.85 || ratio > 1.2) continue;
      return { bytes, type, url, ...size, store_url: match.trackViewUrl || null };
    } catch {}
  }
  return null;
}

let resolved = 0;
const unresolved = [];
for (const item of data.ranking || []) {
  if (!item.global_candidate || item.cover_verified) continue;
  try {
    const art = await officialAppStoreArt(item);
    if (!art) {
      unresolved.push(item.title);
      continue;
    }
    const ext = extensionFrom(art.type, art.url);
    const relative = `assets/covers/popular/${item.slug}-official-app.${ext}`;
    fs.writeFileSync(path.join(root, relative), art.bytes);
    item.image = relative;
    item.image_candidates = [relative];
    item.cover_source = art.url;
    item.cover_verified = true;
    item.cover_width = art.width;
    item.cover_height = art.height;
    item.cover_kind = 'official-platform-app-art';
    cache[item.slug] = {
      local: relative,
      source: art.url,
      source_page: art.store_url,
      resolved_at: new Date().toISOString(),
      width: art.width,
      height: art.height,
      quality: 'verified-official-platform-app-art',
      identity_verified: true
    };
    resolved += 1;
  } catch {
    unresolved.push(item.title);
  }
}

fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
fs.writeFileSync(rankingPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ resolved, unresolved }, null, 2));
