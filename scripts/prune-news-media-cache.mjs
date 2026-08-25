import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sumBytes = objects => objects.reduce((sum, object) => sum + Number(object.size || 0), 0);

function payloadItems(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
}

function mediaKeyFromUrl(value, { endpoint, bucket, mediaPrefix }) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    const expectedOrigin = new URL(endpoint).origin;
    if (url.origin !== expectedOrigin) return '';
    const bucketPrefix = `/${encodeURIComponent(bucket)}/`;
    if (!url.pathname.startsWith(bucketPrefix)) return '';
    const key = url.pathname.slice(bucketPrefix.length).split('/').map(segment => decodeURIComponent(segment)).join('/');
    const normalizedPrefix = `${mediaPrefix.replace(/\/$/, '')}/`;
    return key.startsWith(normalizedPrefix) ? key : '';
  } catch {
    return '';
  }
}

export function buildMediaCacheRetentionPlan(objects, protectedKeys = new Set(), {
  mediaPrefix = 'news/media',
  maxAgeDays = 7,
  now = Date.now()
} = {}) {
  const prefix = `${mediaPrefix.replace(/\/$/, '')}/`;
  const protectedSet = protectedKeys instanceof Set ? protectedKeys : new Set(protectedKeys || []);
  const cutoff = Number(now) - Math.max(1, Number(maxAgeDays) || 7) * 86400e3;
  const scoped = objects.filter(object => object.key.startsWith(prefix));
  const retainedObjects = [];
  const removedObjects = [];

  for (const object of scoped) {
    const modified = Date.parse(object.lastModified || '');
    const protectedByFreshStory = protectedSet.has(object.key);
    if (protectedByFreshStory || !Number.isFinite(modified) || modified >= cutoff) retainedObjects.push(object);
    else removedObjects.push(object);
  }

  return Object.freeze({
    cutoff: new Date(cutoff).toISOString(),
    protectedKeys: Object.freeze([...protectedSet].sort()),
    retainedObjects: Object.freeze(retainedObjects),
    removedObjects: Object.freeze(removedObjects),
    retainedBytes: sumBytes(retainedObjects),
    removedBytes: sumBytes(removedObjects),
    totalBytes: sumBytes(scoped)
  });
}

async function collectFreshManifestMediaKeys(storage, manifest, { snapshotPrefix, mediaPrefix, maxAgeDays, now }) {
  const output = new Set();
  const cutoff = Number(now) - Math.max(1, Number(maxAgeDays) || 7) * 86400e3;
  const expectedSnapshotPrefix = `${snapshotPrefix.replace(/\/$/, '')}/${manifest.version}/`;

  for (const entry of Object.values(manifest.files || {})) {
    const key = String(entry?.key || '');
    if (!key.startsWith(expectedSnapshotPrefix)) continue;
    const response = await storage.getObject(key);
    const payload = await response.json();
    for (const item of payloadItems(payload)) {
      const published = Date.parse(item?.publishedAt || '');
      if (!Number.isFinite(published) || published < cutoff) continue;
      const mediaKey = mediaKeyFromUrl(item?.image, {
        endpoint: storage.endpoint,
        bucket: storage.bucket,
        mediaPrefix
      });
      if (mediaKey) output.add(mediaKey);
    }
  }

  return output;
}

async function deleteObjects(storage, objects, concurrency = 16) {
  let deleted = 0;
  for (let index = 0; index < objects.length; index += concurrency) {
    const batch = objects.slice(index, index + concurrency);
    await Promise.all(batch.map(async object => {
      await storage.deleteObject(object.key);
      deleted += 1;
    }));
  }
  return deleted;
}

export async function pruneNewsMediaCache({
  root = process.cwd(),
  configPath = 'config/news-pipeline.json',
  storage = createYandexObjectStorageClient(),
  now = Date.now(),
  dryRun = false
} = {}) {
  const config = readJson(`${root}/${configPath}`);
  const storageConfig = config.publication?.storage || {};
  const retention = storageConfig.retention || {};
  const currentManifestKey = storageConfig.current_manifest || 'news/manifests/current.json';
  const snapshotPrefix = storageConfig.snapshot_prefix || 'news/snapshots';
  const mediaPrefix = storageConfig.media_prefix || 'news/media';
  const fallbackKey = `${mediaPrefix.replace(/\/$/, '')}/fallback.svg`;
  const maxAgeDays = Number(retention.media_cache_days || 7);
  const deleteConcurrency = Number(retention.delete_concurrency || 16);

  const currentResponse = await storage.getObject(currentManifestKey);
  const currentManifest = await currentResponse.json();
  if (![1, 2].includes(Number(currentManifest?.schemaVersion)) || currentManifest?.channel !== 'news' || !currentManifest?.version) {
    throw new Error('Current news manifest is invalid; refusing media cache cleanup.');
  }

  const [mediaObjects, protectedKeys] = await Promise.all([
    storage.listObjects({ prefix: `${mediaPrefix.replace(/\/$/, '')}/` }),
    collectFreshManifestMediaKeys(storage, currentManifest, {
      snapshotPrefix,
      mediaPrefix,
      maxAgeDays,
      now
    })
  ]);
  protectedKeys.add(fallbackKey);

  const plan = buildMediaCacheRetentionPlan(mediaObjects, protectedKeys, { mediaPrefix, maxAgeDays, now });
  const deleted = dryRun ? 0 : await deleteObjects(storage, plan.removedObjects, deleteConcurrency);

  if (!dryRun) {
    await storage.headObject(currentManifestKey);
    for (const key of protectedKeys) await storage.headObject(key);
  }

  const report = Object.freeze({
    schema_version: 1,
    dry_run: dryRun,
    media_cache_days: maxAgeDays,
    cutoff: plan.cutoff,
    media_objects_before: mediaObjects.length,
    media_objects_protected_by_fresh_news: Math.max(0, protectedKeys.size - 1),
    media_objects_retained: plan.retainedObjects.length,
    media_objects_removed: dryRun ? 0 : deleted,
    media_bytes_before: plan.totalBytes,
    media_bytes_retained: plan.retainedBytes,
    media_bytes_reclaimed: dryRun ? 0 : plan.removedBytes,
    fallback_key: fallbackKey,
    policy: 'News images are a seven-day acceleration cache. Fresh stories keep cached media; older media is deleted after snapshots switch to the permanent first-party fallback.'
  });

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/news-media-cache-prune.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[news/media-cache] ${dryRun ? 'planned' : 'completed'}: ${mediaObjects.length} -> ${plan.retainedObjects.length}; ${plan.removedObjects.length} objects older than ${maxAgeDays} days eligible for deletion.`);
  return report;
}

function parseArguments(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await pruneNewsMediaCache(parseArguments(process.argv.slice(2)));
}
