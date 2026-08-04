import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const releaseFile = path.join(root, 'data/releases/current.json');
const popularFile = path.join(root, 'data/popular/current.json');
const calendarFile = path.join(root, 'calendar/index.html');
const outputDir = path.join(root, 'assets/covers/releases');
const timeoutMs = 18_000;

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};
const writeJSON = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const clean = value => String(value || '').trim();
const canonical = value => clean(value).normalize('NFKD').toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];
const exists = relative => Boolean(relative && fs.existsSync(path.join(root, relative)));

function extensionFor(contentType, url = '') {
  const type = clean(contentType).split(';')[0].toLowerCase();
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/avif') return 'avif';
  if (type === 'image/gif') return 'gif';
  const match = clean(url).match(/\.(png|webp|avif|gif|jpe?g)(?:$|[?#])/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function steamCandidates(appid) {
  const id = Number(appid);
  if (!id) return [];
  return [
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/capsule_467x181.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_467x181.jpg`
  ];
}

async function appDetailsCandidates(appid) {
  const id = Number(appid);
  if (!id) return [];
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverCache/1.0',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const data = payload?.[id]?.data || {};
    return unique([
      data.capsule_imagev5,
      data.header_image,
      data.background,
      data.background_raw,
      ...(data.screenshots || []).slice(0, 2).flatMap(row => [row.path_full, row.path_thumbnail])
    ]);
  } catch {
    return [];
  }
}

function popularMaps(payload) {
  const bySlug = new Map();
  const byTitle = new Map();
  for (const item of payload?.ranking || []) {
    if (item.slug) bySlug.set(item.slug, item);
    if (item.title) byTitle.set(canonical(item.title), item);
  }
  return { bySlug, byTitle };
}

function copyLocalCandidate(record, candidates) {
  for (const candidate of candidates) {
    const relative = candidate.replace(/^\.\.\//, '');
    if (!relative.startsWith('assets/') || !exists(relative)) continue;
    const ext = extensionFor('', relative);
    const targetRelative = `assets/covers/releases/${record.slug}.${ext}`;
    const source = path.join(root, relative);
    const target = path.join(root, targetRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
    const bytes = fs.readFileSync(target);
    return {
      local_url: targetRelative,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      source_url: candidate,
      status: 'deployment_cached'
    };
  }
  return null;
}

async function downloadCandidate(record, candidates) {
  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverCache/1.0',
          'accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
          'referer': 'https://store.steampowered.com/'
        }
      });
      if (!response.ok) continue;
      const contentType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
      if (!contentType.startsWith('image/')) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 8_000) continue;
      const ext = extensionFor(contentType, url);
      const targetRelative = `assets/covers/releases/${record.slug}.${ext}`;
      const target = path.join(root, targetRelative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return {
        local_url: targetRelative,
        bytes: bytes.length,
        content_type: contentType,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        source_url: url,
        status: 'deployment_cached'
      };
    } catch {
      // Try the next official image candidate.
    }
  }
  return null;
}

function primaryDate(record) {
  const event = (record.events || []).slice().sort((a, b) =>
    String(a.date_start || a.date || '9999').localeCompare(String(b.date_start || b.date || '9999'))
  )[0] || {};
  return event.date || event.date_start || '9999-12-31';
}

function injectPreloads(records) {
  if (!fs.existsSync(calendarFile)) return;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = records
    .filter(record => primaryDate(record) >= today && exists(record.image?.local_url))
    .sort((a, b) => primaryDate(a).localeCompare(primaryDate(b)))
    .slice(0, 8);
  const links = upcoming.map(record =>
    `  <link rel="preload" as="image" href="../${record.image.local_url}" fetchpriority="high">`
  ).join('\n');
  const block = `<!-- ig-release-preloads:start -->\n${links}\n  <!-- ig-release-preloads:end -->`;
  let html = fs.readFileSync(calendarFile, 'utf8');
  html = html.replace(/\s*<!-- ig-release-preloads:start -->[\s\S]*?<!-- ig-release-preloads:end -->\s*/g, '\n');
  html = html.replace('</head>', `${block}\n</head>`);
  fs.writeFileSync(calendarFile, html, 'utf8');
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const releasePayload = readJSON(releaseFile, { releases: [] });
const popularPayload = readJSON(popularFile, { ranking: [] });
const { bySlug, byTitle } = popularMaps(popularPayload);
const records = releasePayload.releases || [];
fs.mkdirSync(outputDir, { recursive: true });

let cached = 0;
let reused = 0;
let missing = 0;

await mapPool(records, 4, async record => {
  const existing = record.image?.local_url;
  if (existing && exists(existing)) {
    reused++;
    return;
  }

  const popular = bySlug.get(record.slug) || byTitle.get(canonical(record.title)) || {};
  const localCandidates = unique([
    popular.image,
    ...(popular.image_candidates || []),
    record.image?.local_url
  ]);
  let result = copyLocalCandidate(record, localCandidates);

  if (!result) {
    const appDetails = await appDetailsCandidates(record.external_ids?.steam);
    const remoteCandidates = unique([
      ...localCandidates,
      ...(popular.image_candidates || []),
      popular.cover_source,
      ...(record.image_candidates || []),
      ...steamCandidates(record.external_ids?.steam),
      ...appDetails,
      record.image?.source_url
    ]);
    result = await downloadCandidate(record, remoteCandidates);
  }

  if (!result) {
    missing++;
    console.warn(`No local cover cached for ${record.slug}`);
    return;
  }

  record.image = {
    ...(record.image || {}),
    source_url: result.source_url || record.image?.source_url || null,
    local_url: result.local_url,
    content_type: result.content_type || record.image?.content_type,
    bytes: result.bytes,
    sha256: result.sha256,
    status: result.status,
    verified: true
  };
  record.image_candidates = unique([result.local_url, ...(record.image_candidates || [])]);
  cached++;
});

writeJSON(releaseFile, releasePayload);
injectPreloads(records);

const today = new Date().toISOString().slice(0, 10);
const nearest = records
  .filter(record => primaryDate(record) >= today)
  .sort((a, b) => primaryDate(a).localeCompare(primaryDate(b)))
  .slice(0, 6);
const nearestMissing = nearest.filter(record => !exists(record.image?.local_url));

console.log(`Release covers: ${cached} cached, ${reused} reused, ${missing} unresolved.`);
if (nearestMissing.length) {
  throw new Error(`Nearest releases have no local covers: ${nearestMissing.map(record => record.slug).join(', ')}`);
}
