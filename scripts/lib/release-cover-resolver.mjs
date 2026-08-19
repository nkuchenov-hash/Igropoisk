import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MINIMUM_BYTES = 40_000;
const DEFAULT_MINIMUM_WIDTH = 600;
const DEFAULT_MINIMUM_HEIGHT = 900;
const DEFAULT_MINIMUM_RATIO = 0.62;
const DEFAULT_MAXIMUM_RATIO = 0.72;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const uniq = values => [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
const clean = value => String(value || '').trim();
const canonical = value => clean(value).normalize('NFKD').toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function thresholds(options = {}) {
  return {
    minimumBytes: Math.max(1, Number(options.minimumBytes || DEFAULT_MINIMUM_BYTES)),
    minimumWidth: Math.max(1, Number(options.minimumWidth || DEFAULT_MINIMUM_WIDTH)),
    minimumHeight: Math.max(1, Number(options.minimumHeight || DEFAULT_MINIMUM_HEIGHT)),
    minimumRatio: Number(options.minimumRatio || DEFAULT_MINIMUM_RATIO),
    maximumRatio: Number(options.maximumRatio || DEFAULT_MAXIMUM_RATIO)
  };
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/avif') return 'avif';
  return 'jpg';
}

export function inspectReleaseCover(bytes, options = {}) {
  const quality = thresholds(options);
  try {
    const size = imageSize(bytes);
    const width = Number(size.width || 0);
    const height = Number(size.height || 0);
    const ratio = height > 0 ? width / height : 0;
    const byteLength = Number(bytes?.length || 0);
    const valid = byteLength >= quality.minimumBytes
      && width >= quality.minimumWidth
      && height >= quality.minimumHeight
      && ratio >= quality.minimumRatio
      && ratio <= quality.maximumRatio;
    return { valid, width, height, ratio, bytes: byteLength };
  } catch {
    return { valid: false, width: 0, height: 0, ratio: 0, bytes: Number(bytes?.length || 0) };
  }
}

async function existingLocalImage(root, image, options) {
  const localUrl = clean(image?.local_url);
  if (!localUrl || image?.verified !== true) return null;
  try {
    const bytes = await fs.readFile(path.join(root, localUrl));
    const inspected = inspectReleaseCover(bytes, options);
    if (!inspected.valid) return null;
    return {
      ...image,
      width: inspected.width,
      height: inspected.height,
      bytes: inspected.bytes,
      error: null,
      status: 'downloaded_verified',
      verified: true
    };
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/2.1',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function steamAppIdByTitle(title) {
  try {
    const response = await fetch(`https://store.steampowered.com/search/results/?query&term=${encodeURIComponent(title)}&start=0&count=20&dynamic_data=&force_infinite=1&cc=us&l=english&json=1`, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/2.1' }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = String(payload.results_html || '').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
    const wanted = canonical(title);
    for (const row of rows) {
      const appid = Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]);
      const foundTitle = String(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').trim();
      if (appid && canonical(foundTitle) === wanted) return appid;
    }
  } catch {}
  return null;
}

function steamStaticPosterCandidates(appid) {
  if (!appid) return [];
  const roots = [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appid}`
  ];
  return roots.flatMap(root => [
    `${root}/library_600x900_2x.jpg`,
    `${root}/library_600x900.jpg`
  ]);
}

function steamHashedPosterCandidates(release) {
  const sourceUrls = uniq([
    release?.image?.source_url,
    ...(release?.image?.candidate_urls || []),
    ...(release?.image_candidates || [])
  ]);
  const candidates = [];

  for (const rawUrl of sourceUrls) {
    if (!/^https?:\/\//i.test(rawUrl)) continue;
    const url = rawUrl.replace(/&amp;/g, '&').split(/[?#]/)[0];
    const match = url.match(/^(https?:\/\/[^/]+\/store_item_assets\/steam\/apps\/(\d+)\/[a-f0-9]{16,}\/)[^/]+$/i);
    if (!match) continue;

    const base = match[1];
    const appid = match[2];
    const bases = uniq([
      base,
      base.replace(/^https?:\/\/shared\.akamai\.steamstatic\.com/i, 'https://shared.fastly.steamstatic.com'),
      base.replace(/^https?:\/\/shared\.fastly\.steamstatic\.com/i, 'https://shared.akamai.steamstatic.com')
    ]);
    for (const hashedBase of bases) {
      candidates.push(`${hashedBase}library_600x900_2x.jpg`);
      candidates.push(`${hashedBase}library_600x900.jpg`);
    }
    candidates.push(...steamStaticPosterCandidates(Number(appid)));
  }

  return uniq(candidates);
}

function steamAssetUrl(format, filename, host) {
  if (!format || !filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  const replaced = clean(format).replace('${FILENAME}', clean(filename)).replace(/^\/+/, '');
  if (!replaced || replaced.includes('${FILENAME}')) return null;
  if (/^https?:\/\//i.test(replaced)) return replaced;
  return `${host.replace(/\/$/, '')}/store_item_assets/${replaced}`;
}

async function steamBrowsePosterCandidates(appid) {
  if (!appid) return [];
  const input = {
    ids: [{ appid: Number(appid) }],
    context: { language: 'english', country_code: 'US', steam_realm: 1 },
    data_request: { include_assets: true }
  };
  try {
    const payload = await fetchJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    const items = payload?.response?.store_items || [];
    const item = items.find(entry => Number(entry?.appid) === Number(appid)) || items[0];
    const assets = item?.assets || {};
    const format = clean(assets.asset_url_format);
    const files = uniq([
      assets.library_capsule_2x,
      assets.library_capsule,
      assets.library_capsule_full,
      assets.library_capsule_image
    ]);
    const hosts = [
      'https://shared.fastly.steamstatic.com',
      'https://shared.akamai.steamstatic.com'
    ];
    const urls = [];
    for (const filename of files) {
      for (const host of hosts) {
        const url = steamAssetUrl(format, filename, host);
        if (url) urls.push(url);
      }
    }
    return uniq([...urls, ...steamStaticPosterCandidates(appid)]);
  } catch {
    return steamStaticPosterCandidates(appid);
  }
}

async function steamStorePosterCandidates(appid) {
  if (!appid) return [];
  const urls = [];
  try {
    const response = await fetch(`https://store.steampowered.com/app/${appid}/?cc=us&l=english`, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      headers: {
        'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/2.1',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (response.ok) {
      const html = await response.text();
      const matches = html.match(/https?:\\?\/\\?\/[^"'< ]+library_600x900(?:_2x)?\.(?:jpg|jpeg|png|webp)[^"'< ]*/gi) || [];
      for (const raw of matches) urls.push(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'));
    }
  } catch {}
  return uniq([...urls, ...steamStaticPosterCandidates(appid)]);
}

function trustedSourcePageUrls(release) {
  return uniq((release?.sources || [])
    .filter(source => ['official_store', 'official', 'first_party', 'publisher', 'developer'].includes(String(source?.family || '').toLowerCase()))
    .map(source => source?.url));
}

async function pageArtworkCandidates(url) {
  if (!/^https?:\/\//i.test(url)) return [];
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/2.1',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const urls = [];
    for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) urls.push(match[1]);
    for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) urls.push(match[1]);
    for (const match of html.matchAll(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/gi)) urls.push(match[1]);
    return uniq(urls.map(value => value.replace(/&amp;/g, '&')));
  } catch {
    return [];
  }
}

async function officialArtworkCandidates(release) {
  const pages = trustedSourcePageUrls(release);
  const results = await Promise.all(pages.slice(0, 8).map(pageArtworkCandidates));
  return uniq(results.flat());
}

async function wikipediaCoverCandidates(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`intitle:\"${title}\" video game`)}&gsrlimit=8&prop=pageimages|extracts&exintro=1&explaintext=1&piprop=original|thumbnail&pithumbsize=1800&format=json&origin=*`;
  try {
    const payload = await fetchJson(url);
    const wanted = canonical(title);
    const urls = [];
    for (const page of Object.values(payload.query?.pages || {})) {
      const pageTitle = canonical(String(page.title || '').replace(/\s*\([^)]*\)\s*$/, ''));
      const extract = String(page.extract || '');
      if (pageTitle !== wanted || !/video game|game developed|game published/i.test(extract)) continue;
      if (page?.original?.source) urls.push(page.original.source);
      if (page?.thumbnail?.source) urls.push(page.thumbnail.source);
    }
    return uniq(urls);
  } catch {
    return [];
  }
}

function explicitPosterCandidates(release) {
  return uniq([
    ...(release?.image?.candidate_urls || []),
    ...(release?.image_candidates || []),
    release?.image?.source_url
  ]).filter(url => /library_600x900|cover|poster|box.?art/i.test(url));
}

async function downloadImage(url, options) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/2.1' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) throw new Error(`Unsupported type ${contentType || 'unknown'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const inspected = inspectReleaseCover(bytes, options);
  if (!inspected.valid) {
    throw new Error(`Cover quality rejected: ${inspected.width}x${inspected.height}, ${inspected.bytes} bytes`);
  }
  return { ...inspected, contentType, data: bytes };
}

async function resolveOne(root, release, options) {
  const existing = await existingLocalImage(root, release?.image, options);
  if (existing) return { release: { ...release, image: existing }, resolved: true, source: 'existing_local' };

  const declaredAppid = Number(release?.external_ids?.steam);
  const appid = Number.isFinite(declaredAppid) && declaredAppid > 0
    ? declaredAppid
    : await steamAppIdByTitle(release?.title || '');
  const [steamBrowsePosters, steamPosters, officialArtwork, wikipediaArtwork] = await Promise.all([
    steamBrowsePosterCandidates(appid),
    steamStorePosterCandidates(appid),
    officialArtworkCandidates(release),
    wikipediaCoverCandidates(release?.title || '')
  ]);
  const candidates = uniq([
    ...steamBrowsePosters,
    ...explicitPosterCandidates(release),
    ...steamHashedPosterCandidates(release),
    ...steamPosters,
    ...officialArtwork,
    ...wikipediaArtwork
  ]);
  let lastError = null;

  for (const url of candidates) {
    try {
      const image = await downloadImage(url, options);
      const ext = extensionFor(image.contentType);
      const localUrl = `assets/covers/releases/${release.slug}.${ext}`;
      const target = path.join(root, localUrl);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, image.data);
      return {
        release: {
          ...release,
          external_ids: {
            ...(release.external_ids || {}),
            steam: release?.external_ids?.steam || appid || null
          },
          image: {
            ...(release.image || {}),
            source_url: url,
            candidate_urls: candidates,
            local_url: localUrl,
            content_type: image.contentType,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            sha256: crypto.createHash('sha256').update(image.data).digest('hex'),
            kind: 'verified_portrait_cover',
            error: null,
            verified: true,
            status: 'downloaded_verified'
          }
        },
        resolved: true,
        source: url
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    release: {
      ...release,
      image: {
        ...(release.image || {}),
        candidate_urls: candidates,
        local_url: null,
        verified: false,
        status: 'unresolved',
        error: lastError?.message || 'No quality portrait cover candidates'
      }
    },
    resolved: false,
    source: null
  };
}

export async function ensureVisibleReleaseCovers(candidates = [], options = {}) {
  const root = options.root || process.cwd();
  const visibleIds = new Set(options.visibleIds || []);
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 6)));
  const quality = thresholds(options);
  const next = candidates.map(item => ({ ...item }));
  const targetIndexes = [];
  next.forEach((candidate, index) => {
    if (visibleIds.has(candidate.id)) targetIndexes.push(index);
  });

  let cursor = 0;
  const resolved = [];
  const unresolved = [];
  const runners = Array.from({ length: Math.min(concurrency, targetIndexes.length || 1) }, async () => {
    while (cursor < targetIndexes.length) {
      const index = targetIndexes[cursor++];
      const result = await resolveOne(root, next[index], quality);
      next[index] = result.release;
      if (result.resolved) resolved.push({ id: result.release.id, slug: result.release.slug, source: result.source });
      else unresolved.push({ id: result.release.id, slug: result.release.slug, title: result.release.title, error: result.release.image?.error || 'unresolved' });
    }
  });
  await Promise.all(runners);

  return {
    candidates: next,
    statistics: {
      requested: targetIndexes.length,
      resolved: resolved.length,
      unresolved: unresolved.length,
      coverage_percent: targetIndexes.length ? Number(((resolved.length / targetIndexes.length) * 100).toFixed(2)) : 100,
      minimum_width: quality.minimumWidth,
      minimum_height: quality.minimumHeight,
      minimum_bytes: quality.minimumBytes,
      minimum_ratio: quality.minimumRatio,
      maximum_ratio: quality.maximumRatio
    },
    resolved,
    unresolved
  };
}

export function validateVisibleReleaseCovers(publicCalendar = {}, options = {}) {
  const errors = [];
  const quality = thresholds(options);
  const visible = [
    ...(publicCalendar.releases || []),
    ...(publicCalendar.personalized_releases || [])
  ];
  for (const release of visible) {
    const image = release?.image || {};
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    const bytes = Number(image.bytes || 0);
    const ratio = height > 0 ? width / height : 0;
    const qualityOk = image.local_url
      && image.status === 'downloaded_verified'
      && image.verified === true
      && bytes >= quality.minimumBytes
      && width >= quality.minimumWidth
      && height >= quality.minimumHeight
      && ratio >= quality.minimumRatio
      && ratio <= quality.maximumRatio
      && !/too small|quality rejected|http 404/i.test(String(image.error || ''));
    if (!qualityOk) errors.push(`Visible release quality cover unresolved: ${release?.id || release?.slug || 'unknown'}`);
  }
  return uniq(errors);
}
