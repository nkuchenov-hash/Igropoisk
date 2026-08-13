import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { steamStoreArtworkCandidates } from './steam-store-artwork.mjs';

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MINIMUM_BYTES = 4_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const uniq = values => [...new Set((values || []).filter(Boolean))];

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/avif') return 'avif';
  return 'jpg';
}

async function existingLocalImage(root, image, minimumBytes) {
  const localUrl = String(image?.local_url || '').trim();
  if (!localUrl) return null;
  try {
    const stat = await fs.stat(path.join(root, localUrl));
    if (!stat.isFile() || stat.size < minimumBytes) return null;
    return { ...image, status: 'downloaded_verified', bytes: stat.size, verified: true };
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/1.2',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function steamAppDetails(appid) {
  try {
    const payload = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
    return payload?.[appid]?.success ? payload[appid].data : null;
  } catch {
    return null;
  }
}

function steamStaticCandidates(appid) {
  if (!appid) return [];
  const roots = [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`,
  ];
  return roots.flatMap(root => [
    `${root}/library_600x900_2x.jpg`,
    `${root}/library_600x900.jpg`,
    `${root}/header.jpg`,
    `${root}/capsule_616x353.jpg`,
    `${root}/capsule_231x87.jpg`,
  ]);
}

function steamCoverCandidates(appid, data, image, storeArtwork = []) {
  const screenshots = Array.isArray(data?.screenshots) ? data.screenshots : [];
  return uniq([
    ...steamStaticCandidates(appid),
    ...(image?.candidate_urls || []),
    ...storeArtwork,
    image?.source_url,
    data?.capsule_imagev5,
    data?.capsule_image,
    data?.header_image,
    data?.background,
    data?.background_raw,
    screenshots[0]?.path_full,
    screenshots[0]?.path_thumbnail
  ]);
}

async function downloadImage(url, minimumBytes) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers: { 'user-agent': 'Mozilla/5.0 IgropoiskReleaseCoverResolver/1.2' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) throw new Error(`Unsupported type ${contentType || 'unknown'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < minimumBytes) throw new Error(`Image too small: ${bytes.length} bytes`);
  return { bytes, contentType };
}

async function resolveOne(root, release, minimumBytes) {
  const existing = await existingLocalImage(root, release?.image, minimumBytes);
  if (existing) return { release: { ...release, image: existing }, resolved: true, source: 'existing_local' };

  const appid = Number(release?.external_ids?.steam);
  const validAppid = Number.isFinite(appid) ? appid : null;
  const [steamData, storeArtwork] = validAppid
    ? await Promise.all([steamAppDetails(validAppid), steamStoreArtworkCandidates(validAppid)])
    : [null, []];
  const candidates = steamCoverCandidates(validAppid, steamData, release?.image || {}, storeArtwork);
  let lastError = null;

  for (const url of candidates) {
    try {
      const { bytes, contentType } = await downloadImage(url, minimumBytes);
      const ext = extensionFor(contentType);
      const localUrl = `assets/covers/releases/${release.slug}.${ext}`;
      const target = path.join(root, localUrl);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      return {
        release: {
          ...release,
          image: {
            ...(release.image || {}),
            source_url: url,
            candidate_urls: candidates,
            local_url: localUrl,
            content_type: contentType,
            bytes: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            kind: release.image?.kind || 'official_store_cover',
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
        error: lastError?.message || 'No usable cover candidates'
      }
    },
    resolved: false,
    source: null
  };
}

export async function ensureVisibleReleaseCovers(candidates = [], options = {}) {
  const root = options.root || process.cwd();
  const visibleIds = new Set(options.visibleIds || []);
  const minimumBytes = Math.max(1, Number(options.minimumBytes || DEFAULT_MINIMUM_BYTES));
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 6)));
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
      const result = await resolveOne(root, next[index], minimumBytes);
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
      coverage_percent: targetIndexes.length ? Number(((resolved.length / targetIndexes.length) * 100).toFixed(2)) : 100
    },
    resolved,
    unresolved
  };
}

export function validateVisibleReleaseCovers(publicCalendar = {}) {
  const errors = [];
  const visible = [
    ...(publicCalendar.releases || []),
    ...(publicCalendar.personalized_releases || [])
  ];
  for (const release of visible) {
    if (!release?.image?.local_url || release?.image?.status !== 'downloaded_verified' || release?.image?.verified !== true) {
      errors.push(`Visible release cover unresolved: ${release?.id || release?.slug || 'unknown'}`);
    }
  }
  return uniq(errors);
}
