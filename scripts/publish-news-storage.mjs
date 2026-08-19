import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonBuffer = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const safeImage = value => /^(assets\/(?:news|publisher-news)\/[a-f0-9]{16}\.(?:jpg|jpeg|png|webp|avif|gif))$/i.test(String(value || ''));

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return ({
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif'
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

function replaceImagePaths(value, replacements) {
  if (Array.isArray(value)) return value.map(item => replaceImagePaths(item, replacements));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === 'image' && typeof child === 'string' && replacements.has(child)
      ? replacements.get(child)
      : replaceImagePaths(child, replacements)
  ]));
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
  const archiveCache = storageConfig.archive_cache_control || 'public, max-age=300, stale-while-revalidate=86400';
  const manifestCache = storageConfig.manifest_cache_control || 'no-store, max-age=0';
  const liveWindowDays = Number(storageConfig.live_window_days || 30);
  const version = versionId(now);
  const snapshotRoot = `${snapshotPrefix}/${version}`;

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

  const imagePaths = new Set();
  for (const relative of publicFiles) collectImagePaths(payloads.get(relative), imagePaths);
  collectImagePaths(fullEvents, imagePaths);
  const imageUrls = new Map();
  const media = [];

  for (const relative of [...imagePaths].sort()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) throw new Error(`News image is missing: ${relative}`);
    const body = fs.readFileSync(absolute);
    const digest = sha256(body);
    const extension = path.extname(relative).toLowerCase();
    const key = `${mediaPrefix}/${digest}${extension}`;
    const publicUrl = storage.publicUrl(key);
    imageUrls.set(relative, publicUrl);
    media.push({ source: relative, key, url: publicUrl, sha256: digest, bytes: body.length });
    if (!dryRun && !(await exists(storage, key))) {
      await storage.putObject(key, body, { contentType: contentType(relative), cacheControl: immutableCache });
      await storage.headObject(key);
    }
  }

  const transformedFullEvents = replaceImagePaths(fullEvents, imageUrls);
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
      generatedAt: now.toISOString(),
      count: items.length,
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
      : replaceImagePaths(original, imageUrls);
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
    media: { count: media.length, bytes: media.reduce((sum, item) => sum + item.bytes, 0) },
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
  console.log(`${result.dryRun ? 'Prepared' : 'Published'} news snapshot ${result.manifest.version}: ${Object.keys(result.manifest.files).length} compact JSON files, ${result.archive.months} archive months (${result.archive.monthsWritten} rewritten), ${result.media.length} new-run media references.`);
}
