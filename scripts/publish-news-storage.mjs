import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonBuffer = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const safeImage = value => /^(assets\/(?:news|publisher-news)\/[a-f0-9]{16}\.(?:jpg|jpeg|png|webp|avif|gif))$/i.test(String(value || ''));
const fallbackSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="Игропоиск — новости"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#17181f"/><stop offset="1" stop-color="#292735"/></linearGradient><radialGradient id="glow" cx="75%" cy="25%" r="70%"><stop stop-color="#7c6cff" stop-opacity=".34"/><stop offset="1" stop-color="#7c6cff" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="675" fill="url(#bg)"/><rect width="1200" height="675" fill="url(#glow)"/><g fill="none" stroke="#b7ff55" stroke-opacity=".22"><circle cx="880" cy="320" r="190" stroke-width="2"/><circle cx="880" cy="320" r="130"/><path d="M690 320h380M880 130v380"/></g><text x="74" y="520" fill="#f4f4f7" font-family="Arial,Helvetica,sans-serif" font-size="76" font-weight="700">ИГРОПОИСК</text><text x="80" y="585" fill="#b7ff55" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" letter-spacing="9">НОВОСТИ</text></svg>`, 'utf8');

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return ({
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml; charset=utf-8'
  })[extension] || 'application/octet-stream';
}

function collectImagePaths(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectImagePaths(item, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'image' && typeof child === 'string' && safeImage(child)) output.add(child);
    else collectImagePaths(child, output);
  }
  return output;
}

function isFirstPartyMediaUrl(value, storage, mediaPrefix) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const mediaBase = storage.publicUrl(`${mediaPrefix.replace(/\/$/, '')}/`);
    return value.startsWith(mediaBase);
  } catch {
    return false;
  }
}

export function sanitizeImageReferences(value, replacements, {
  storage,
  mediaPrefix = 'news/media',
  now = Date.now(),
  mediaCacheDays = 7,
  fallbackUrl = storage.publicUrl(`${mediaPrefix.replace(/\/$/, '')}/fallback.svg`)
}) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeImageReferences(item, replacements, { storage, mediaPrefix, now, mediaCacheDays, fallbackUrl }));
  }
  if (!value || typeof value !== 'object') return value;

  const publishedAt = Date.parse(value.publishedAt || '');
  const cutoff = Number(now) - Math.max(1, Number(mediaCacheDays) || 7) * 86400e3;
  const expired = Number.isFinite(publishedAt) && publishedAt < cutoff;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'image' && typeof child === 'string') {
      if (expired || !child) return [key, fallbackUrl];
      if (replacements.has(child)) return [key, replacements.get(child) || fallbackUrl];
      if (isFirstPartyMediaUrl(child, storage, mediaPrefix)) return [key, child];
      return [key, fallbackUrl];
    }
    return [key, sanitizeImageReferences(child, replacements, { storage, mediaPrefix, now, mediaCacheDays, fallbackUrl })];
  }));
}

function versionId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.000', '').replace(/\.\d{3}/, '');
  const revision = String(process.env.GITHUB_SHA || 'local').slice(0, 12);
  const run = String(process.env.GITHUB_RUN_ID || 'manual');
  return `${timestamp}-${revision}-${run}`;
}

function itemTime(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function monthKey(item) {
  const time = itemTime(item);
  return time ? new Date(time).toISOString().slice(0, 7) : '';
}

function payloadItems(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
}

export function buildMonthlyArchive(payload) {
  const groups = new Map();
  for (const item of payloadItems(payload)) {
    const month = monthKey(item);
    if (!month) continue;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(item);
  }
  return new Map([...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, items]) => [month, items.sort((a, b) => itemTime(b) - itemTime(a))]));
}

export function buildLiveEventsPayload(payload, now = new Date(), liveWindowDays = 30, minimumItems = 12) {
  const items = [...payloadItems(payload)].sort((a, b) => itemTime(b) - itemTime(a));
  const cutoff = now.getTime() - Math.max(1, Number(liveWindowDays) || 30) * 86400e3;
  let liveItems = items.filter(item => itemTime(item) >= cutoff);
  if (liveItems.length < Math.min(minimumItems, items.length)) {
    liveItems = items.slice(0, Math.min(Math.max(minimumItems, 50), items.length));
  }
  return {
    ...(Array.isArray(payload) ? {} : payload),
    generatedAt: now.toISOString(),
    storageModel: 'monthly-archive-v1',
    liveWindowDays: Math.max(1, Number(liveWindowDays) || 30),
    archiveTotalItems: items.length,
    items: liveItems
  };
}

async function exists(storage, key) {
  try {
    await storage.headObject(key);
    return true;
  } catch (error) {
    if (/failed with 404/.test(error.message)) return false;
    throw error;
  }
}

async function currentArchiveIndex(storage, currentManifestKey) {
  try {
    const response = await storage.getObject(currentManifestKey);
    const manifest = await response.json();
    if (manifest?.schemaVersion !== 2 || manifest?.channel !== 'news' || !manifest?.archive?.index?.url) return null;
    const indexResponse = await fetch(manifest.archive.index.url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!indexResponse.ok) return null;
    const index = await indexResponse.json();
    return index?.schemaVersion === 1 && index?.channel === 'news-archive' ? index : null;
  } catch {
    return null;
  }
}

export async function publishNewsSnapshot({
  root = process.cwd(),
  configPath = 'config/news-pipeline.json',
  storage = createYandexObjectStorageClient(),
  now = new Date(),
  dryRun = false
} = {}) {
  const config = readJson(path.join(root, configPath));
  const requiredFiles = config.publication?.required_files || [];
  const storageConfig = config.publication?.storage || {};
  const publicFiles = storageConfig.public_files || requiredFiles;
  const snapshotPrefix = storageConfig.snapshot_prefix || 'news/snapshots';
  const archivePrefix = storageConfig.archive_prefix || 'news/archive';
  const mediaPrefix = storageConfig.media_prefix || 'news/media';
  const currentManifestKey = storageConfig.current_manifest || 'news/manifests/current.json';
  const immutableCache = storageConfig.immutable_cache_control || 'public, max-age=31536000, immutable';
  const mediaCache = storageConfig.media_cache_control || 'public, max-age=604800, immutable';
  const archiveCache = storageConfig.archive_cache_control || 'public, max-age=300, stale-while-revalidate=86400';
  const manifestCache = storageConfig.manifest_cache_control || 'no-store, max-age=0';
  const liveWindowDays = Number(storageConfig.live_window_days || 30);
  const mediaCacheDays = Number(storageConfig.retention?.media_cache_days || 7);
  const version = versionId(now);
  const snapshotRoot = `${snapshotPrefix}/${version}`;
  const fallbackKey = `${mediaPrefix.replace(/\/$/, '')}/fallback.svg`;
  const fallbackUrl = storage.publicUrl(fallbackKey);

  const payloads = new Map();
  for (const relative of requiredFiles) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) throw new Error(`Required news output is missing: ${relative}`);
    payloads.set(relative, readJson(absolute));
  }
  for (const relative of publicFiles) {
    if (!payloads.has(relative)) throw new Error(`Public news file is not part of required_files: ${relative}`);
  }
  const fullEvents = payloads.get('data/news-events.json');
  if (!fullEvents || !payloadItems(fullEvents).length) throw new Error('Complete news event archive is empty.');

  if (!dryRun && !(await exists(storage, fallbackKey))) {
    await storage.putObject(fallbackKey, fallbackSvg, { contentType: 'image/svg+xml; charset=utf-8', cacheControl: immutableCache });
    await storage.headObject(fallbackKey);
  }

  const imagePaths = new Set();
  for (const relative of publicFiles) collectImagePaths(payloads.get(relative), imagePaths);
  collectImagePaths(fullEvents, imagePaths);
  const imageUrls = new Map();
  const media = [];
  let mediaFallbackCount = 0;

  for (const relative of [...imagePaths].sort()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) {
      imageUrls.set(relative, '');
      mediaFallbackCount += 1;
      console.warn(`[news/media] ${relative} is missing; publishing branded fallback instead.`);
      continue;
    }

    try {
      const body = fs.readFileSync(absolute);
      const digest = sha256(body);
      const extension = path.extname(relative).toLowerCase();
      const key = `${mediaPrefix}/${digest}${extension}`;
      const publicUrl = storage.publicUrl(key);
      if (!dryRun && !(await exists(storage, key))) {
        await storage.putObject(key, body, { contentType: contentType(relative), cacheControl: mediaCache });
        await storage.headObject(key);
      }
      imageUrls.set(relative, publicUrl);
      media.push({ source: relative, key, url: publicUrl, sha256: digest, bytes: body.length });
    } catch (error) {
      imageUrls.set(relative, '');
      mediaFallbackCount += 1;
      console.warn(`[news/media] ${relative} could not be cached (${error.message}); publication continues with fallback.`);
    }
  }

  const imageOptions = { storage, mediaPrefix, now: now.getTime(), mediaCacheDays, fallbackUrl };
  const transformedFullEvents = sanitizeImageReferences(fullEvents, imageUrls, imageOptions);
  const monthly = buildMonthlyArchive(transformedFullEvents);
  const previousIndex = dryRun ? null : await currentArchiveIndex(storage, currentManifestKey);
  const previousMonths = new Map((previousIndex?.months || []).map(entry => [entry.month, entry]));
  const archiveMonths = [];
  let archiveBytesWritten = 0;
  let archiveMonthsWritten = 0;

  for (const [month, items] of monthly) {
    const [year, monthNumber] = month.split('-');
    const key = `${archivePrefix}/${year}/${monthNumber}.json`;
    const body = jsonBuffer({
      schemaVersion: 1,
      channel: 'news-archive-month',
      month,
      count: items.length,
      newestPublishedAt: items[0]?.publishedAt || '',
      oldestPublishedAt: items.at(-1)?.publishedAt || '',
      items
    });
    const digest = sha256(body);
    const previous = previousMonths.get(month);
    const changed = !previous || previous.sha256 !== digest || Number(previous.bytes || 0) !== body.length;
    if (!dryRun && changed) {
      await storage.putObject(key, body, { contentType: 'application/json; charset=utf-8', cacheControl: archiveCache });
      const head = await storage.headObject(key);
      const storedBytes = Number(head.headers.get('content-length') || 0);
      if (storedBytes && storedBytes !== body.length) throw new Error(`Stored archive size mismatch for ${month}.`);
      archiveBytesWritten += body.length;
      archiveMonthsWritten += 1;
    }
    archiveMonths.push({
      month,
      key,
      url: storage.publicUrl(key),
      sha256: digest,
      bytes: body.length,
      count: items.length,
      newestPublishedAt: items[0]?.publishedAt || '',
      oldestPublishedAt: items.at(-1)?.publishedAt || ''
    });
  }

  const archiveIndexPayload = {
    schemaVersion: 1,
    channel: 'news-archive',
    generatedAt: now.toISOString(),
    totalItems: payloadItems(transformedFullEvents).length,
    months: archiveMonths
  };
  const archiveIndexBody = jsonBuffer(archiveIndexPayload);
  const archiveIndexKey = `${snapshotRoot}/archive-index.json`;
  const archiveIndexDigest = sha256(archiveIndexBody);

  const files = {};
  const snapshotBodies = new Map();
  let snapshotBytes = archiveIndexBody.length;
  for (const relative of publicFiles) {
    const original = payloads.get(relative);
    const transformed = relative === 'data/news-events.json'
      ? buildLiveEventsPayload(transformedFullEvents, now, liveWindowDays, Number(config.publication?.minimum_items?.[relative] || 12))
      : sanitizeImageReferences(original, imageUrls, imageOptions);
    const body = jsonBuffer(transformed);
    const key = `${snapshotRoot}/${relative}`;
    const digest = sha256(body);
    files[relative] = { key, url: storage.publicUrl(key), sha256: digest, bytes: body.length };
    snapshotBodies.set(relative, body);
    snapshotBytes += body.length;
  }

  const maximumBytes = Number(storageConfig.maximum_snapshot_bytes || 8_000_000);
  if (snapshotBytes > maximumBytes) {
    throw new Error(`Compact news snapshot is ${snapshotBytes} bytes; maximum is ${maximumBytes}.`);
  }

  const manifest = {
    schemaVersion: 2,
    channel: 'news',
    version,
    publishedAt: now.toISOString(),
    sourceCommit: process.env.GITHUB_SHA || '',
    sourceRunId: process.env.GITHUB_RUN_ID || '',
    storageModel: 'compact-live-plus-monthly-archive-v1',
    liveWindowDays,
    baseUrl: storage.publicUrl(`${snapshotRoot}/`),
    files,
    archive: {
      index: {
        key: archiveIndexKey,
        url: storage.publicUrl(archiveIndexKey),
        sha256: archiveIndexDigest,
        bytes: archiveIndexBody.length
      },
      prefix: `${archivePrefix}/`,
      months: archiveMonths.length,
      totalItems: archiveIndexPayload.totalItems
    },
    media: {
      count: media.length,
      bytes: media.reduce((sum, item) => sum + item.bytes, 0),
      cacheDays: mediaCacheDays,
      fallbackCount: mediaFallbackCount,
      fallbackUrl
    },
    snapshot: { bytes: snapshotBytes },
    repositoryFallback: true
  };
  const manifestBody = jsonBuffer(manifest);
  const snapshotManifestKey = `${snapshotRoot}/manifest.json`;

  if (!dryRun) {
    await storage.putObject(archiveIndexKey, archiveIndexBody, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: immutableCache
    });
    await storage.headObject(archiveIndexKey);

    for (const [relative, body] of snapshotBodies) {
      const key = files[relative].key;
      await storage.putObject(key, body, { contentType: contentType(relative), cacheControl: immutableCache });
      const head = await storage.headObject(key);
      const storedBytes = Number(head.headers.get('content-length') || 0);
      if (storedBytes && storedBytes !== body.length) throw new Error(`Stored size mismatch for ${relative}.`);
    }

    await storage.putObject(snapshotManifestKey, manifestBody, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: immutableCache
    });
    await storage.headObject(snapshotManifestKey);
    await storage.putObject(currentManifestKey, manifestBody, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: manifestCache
    });
    const published = await storage.getObject(currentManifestKey);
    const readBack = await published.json();
    if (readBack.version !== version || readBack.schemaVersion !== 2) {
      throw new Error('Current news manifest did not switch to the compact monthly-archive snapshot.');
    }
  }

  return {
    manifest,
    media,
    archive: {
      months: archiveMonths.length,
      totalItems: archiveIndexPayload.totalItems,
      monthsWritten: dryRun ? 0 : archiveMonthsWritten,
      bytesWritten: dryRun ? 0 : archiveBytesWritten
    },
    dryRun
  };
}

function parseArguments(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishNewsSnapshot(parseArguments(process.argv.slice(2)));
  console.log(`${result.dryRun ? 'Prepared' : 'Published'} news snapshot ${result.manifest.version}: ${Object.keys(result.manifest.files).length} compact JSON files, ${result.archive.months} archive months (${result.archive.monthsWritten} rewritten), ${result.media.length} cached media references, ${result.manifest.media.fallbackCount} media fallbacks.`);
}
