import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sumBytes = objects => objects.reduce((sum, object) => sum + Number(object.size || 0), 0);

function versionTimestamp(version, objects = []) {
  const match = String(version).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const value = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    if (Number.isFinite(value)) return value;
  }
  return Math.max(0, ...objects.map(object => Date.parse(object.lastModified || '')).filter(Number.isFinite));
}

function utcDay(timestamp) {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

export function buildSnapshotRetentionPlan(objects, {
  snapshotPrefix = 'news/snapshots',
  currentVersion = '',
  keepRecentSnapshots = 12,
  keepDailySnapshots = 7,
  deleteIncompleteSnapshots = true
} = {}) {
  const prefix = `${snapshotPrefix.replace(/\/$/, '')}/`;
  const groups = new Map();
  for (const object of objects) {
    if (!object.key.startsWith(prefix)) continue;
    const remainder = object.key.slice(prefix.length);
    const version = remainder.split('/')[0];
    if (!version) continue;
    const group = groups.get(version) || { version, objects: [], complete: false, timestamp: 0, bytes: 0 };
    group.objects.push(object);
    group.bytes += Number(object.size || 0);
    if (object.key === `${prefix}${version}/manifest.json`) group.complete = true;
    groups.set(version, group);
  }

  for (const group of groups.values()) group.timestamp = versionTimestamp(group.version, group.objects);
  const ordered = [...groups.values()].sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version));
  const complete = ordered.filter(group => group.complete);
  const keep = new Set(currentVersion ? [currentVersion] : []);
  const recentLimit = Math.max(1, Number(keepRecentSnapshots) || 12);

  for (const group of complete.slice(0, recentLimit)) keep.add(group.version);

  const dailyLimit = Math.max(0, Number(keepDailySnapshots) || 0);
  if (dailyLimit > 0) {
    const representedDays = new Set([...keep].map(version => {
      const group = groups.get(version);
      return group ? utcDay(group.timestamp) : '';
    }).filter(Boolean));
    let dailyKept = 0;
    for (const group of complete) {
      if (keep.has(group.version)) continue;
      const day = utcDay(group.timestamp);
      if (!day || representedDays.has(day)) continue;
      keep.add(group.version);
      representedDays.add(day);
      dailyKept += 1;
      if (dailyKept >= dailyLimit) break;
    }
  }

  const remove = ordered.filter(group => {
    if (group.version === currentVersion) return false;
    if (!group.complete && deleteIncompleteSnapshots) return true;
    return !keep.has(group.version);
  });
  const retained = ordered.filter(group => !remove.includes(group));

  if (currentVersion && !groups.has(currentVersion)) {
    throw new Error(`Current news snapshot ${currentVersion} was not found under ${snapshotPrefix}.`);
  }
  if (currentVersion && remove.some(group => group.version === currentVersion)) {
    throw new Error('Retention plan attempted to delete the current news snapshot.');
  }

  return Object.freeze({
    versions: ordered.length,
    retainedVersions: Object.freeze(retained.map(group => group.version)),
    removedVersions: Object.freeze(remove.map(group => group.version)),
    retainedObjects: Object.freeze(retained.flatMap(group => group.objects)),
    removedObjects: Object.freeze(remove.flatMap(group => group.objects)),
    retainedBytes: sumBytes(retained.flatMap(group => group.objects)),
    removedBytes: sumBytes(remove.flatMap(group => group.objects)),
    totalBytes: sumBytes(objects)
  });
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

function collectMediaKeys(value, options, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectMediaKeys(item, options, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'image' && typeof child === 'string') {
      const mediaKey = mediaKeyFromUrl(child, options);
      if (mediaKey) output.add(mediaKey);
    } else {
      collectMediaKeys(child, options, output);
    }
  }
  return output;
}

export function buildMediaRetentionPlan(objects, referencedKeys, { mediaPrefix = 'news/media' } = {}) {
  const prefix = `${mediaPrefix.replace(/\/$/, '')}/`;
  const referenced = referencedKeys instanceof Set ? referencedKeys : new Set(referencedKeys || []);
  const scoped = objects.filter(object => object.key.startsWith(prefix));
  const retainedObjects = scoped.filter(object => referenced.has(object.key));
  const removedObjects = scoped.filter(object => !referenced.has(object.key));
  return Object.freeze({
    referencedKeys: Object.freeze([...referenced].sort()),
    retainedObjects: Object.freeze(retainedObjects),
    removedObjects: Object.freeze(removedObjects),
    retainedBytes: sumBytes(retainedObjects),
    removedBytes: sumBytes(removedObjects),
    totalBytes: sumBytes(scoped)
  });
}

async function collectCurrentManifestMediaKeys(storage, manifest, { snapshotPrefix, mediaPrefix }) {
  const output = new Set();
  const expectedSnapshotPrefix = `${snapshotPrefix.replace(/\/$/, '')}/${manifest.version}/`;
  for (const entry of Object.values(manifest.files || {})) {
    const key = String(entry?.key || '');
    if (!key.startsWith(expectedSnapshotPrefix)) throw new Error(`Current manifest file is outside ${expectedSnapshotPrefix}.`);
    const response = await storage.getObject(key);
    const payload = await response.json();
    collectMediaKeys(payload, {
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      mediaPrefix
    }, output);
  }
  return output;
}

function collectNextPublicationMediaKeys(root, config, storage, mediaPrefix) {
  const output = new Set();
  const storageConfig = config.publication?.storage || {};
  const files = new Set([
    ...(storageConfig.public_files || []),
    'data/news-events.json'
  ]);
  for (const file of files) {
    const absolute = `${root}/${file}`;
    if (!fs.existsSync(absolute)) continue;
    collectMediaKeys(readJson(absolute), {
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      mediaPrefix
    }, output);
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

export async function pruneNewsStorage({
  root = process.cwd(),
  configPath = 'config/news-pipeline.json',
  storage = createYandexObjectStorageClient(),
  dryRun = false
} = {}) {
  const config = readJson(`${root}/${configPath}`);
  const storageConfig = config.publication?.storage || {};
  const retention = storageConfig.retention || {};
  const currentManifestKey = storageConfig.current_manifest || 'news/manifests/current.json';
  const snapshotPrefix = storageConfig.snapshot_prefix || 'news/snapshots';
  const mediaPrefix = storageConfig.media_prefix || 'news/media';
  const deleteConcurrency = Number(retention.delete_concurrency || 16);

  const currentResponse = await storage.getObject(currentManifestKey);
  const currentManifest = await currentResponse.json();
  if (![1, 2].includes(Number(currentManifest?.schemaVersion)) || currentManifest?.channel !== 'news' || !currentManifest?.version) {
    throw new Error('Current news manifest is invalid; refusing storage cleanup.');
  }

  const [snapshotObjects, mediaObjects] = await Promise.all([
    storage.listObjects({ prefix: `${snapshotPrefix.replace(/\/$/, '')}/` }),
    storage.listObjects({ prefix: `${mediaPrefix.replace(/\/$/, '')}/` })
  ]);
  const snapshotPlan = buildSnapshotRetentionPlan(snapshotObjects, {
    snapshotPrefix,
    currentVersion: currentManifest.version,
    keepRecentSnapshots: retention.keep_recent_snapshots ?? 12,
    keepDailySnapshots: retention.keep_daily_snapshots ?? 7,
    deleteIncompleteSnapshots: retention.delete_incomplete_snapshots !== false
  });

  let currentMediaKeys = new Set();
  let mediaSweepSafe = false;
  let mediaSweepReason = '';
  try {
    currentMediaKeys = await collectCurrentManifestMediaKeys(storage, currentManifest, { snapshotPrefix, mediaPrefix });
    mediaSweepSafe = true;
  } catch (error) {
    mediaSweepReason = String(error?.message || error);
  }
  const nextMediaKeys = collectNextPublicationMediaKeys(root, config, storage, mediaPrefix);
  const referencedMediaKeys = new Set([...currentMediaKeys, ...nextMediaKeys]);
  const mediaPlan = buildMediaRetentionPlan(mediaObjects, referencedMediaKeys, { mediaPrefix });

  let deletedSnapshotObjects = 0;
  let deletedMediaObjects = 0;
  if (!dryRun && snapshotPlan.removedObjects.length) {
    deletedSnapshotObjects = await deleteObjects(storage, snapshotPlan.removedObjects, deleteConcurrency);
  }
  if (!dryRun && mediaSweepSafe && mediaPlan.removedObjects.length) {
    deletedMediaObjects = await deleteObjects(storage, mediaPlan.removedObjects, deleteConcurrency);
  }

  if (!dryRun) {
    await storage.headObject(currentManifestKey);
    await storage.headObject(`${snapshotPrefix.replace(/\/$/, '')}/${currentManifest.version}/manifest.json`);
    for (const key of currentMediaKeys) await storage.headObject(key);
  }

  const snapshotReclaimed = dryRun ? 0 : snapshotPlan.removedBytes;
  const mediaReclaimed = dryRun || !mediaSweepSafe ? 0 : mediaPlan.removedBytes;
  const report = Object.freeze({
    schema_version: 3,
    dry_run: dryRun,
    current_manifest_schema_version: currentManifest.schemaVersion,
    current_version: currentManifest.version,
    snapshot_versions_before: snapshotPlan.versions,
    snapshot_versions_retained: snapshotPlan.retainedVersions.length,
    snapshot_versions_removed: snapshotPlan.removedVersions.length,
    snapshot_objects_removed: dryRun ? 0 : deletedSnapshotObjects,
    snapshot_bytes_before: snapshotPlan.totalBytes,
    snapshot_bytes_retained: snapshotPlan.retainedBytes,
    snapshot_bytes_reclaimed: snapshotReclaimed,
    media_sweep_safe: mediaSweepSafe,
    media_sweep_reason: mediaSweepReason,
    media_objects_before: mediaObjects.length,
    media_objects_referenced: mediaPlan.retainedObjects.length,
    media_objects_removed: dryRun || !mediaSweepSafe ? 0 : deletedMediaObjects,
    media_bytes_before: mediaPlan.totalBytes,
    media_bytes_retained: mediaPlan.retainedBytes,
    media_bytes_reclaimed: mediaReclaimed,
    planned_snapshot_reclaim_bytes: snapshotPlan.removedBytes,
    planned_media_reclaim_bytes: mediaSweepSafe ? mediaPlan.removedBytes : 0,
    total_bytes_reclaimed: snapshotReclaimed + mediaReclaimed,
    history_policy: 'Current live media and every media object referenced by the complete next publication archive are protected; only unreferenced media and redundant snapshot versions are deleted.',
    retained_versions: snapshotPlan.retainedVersions,
    removed_versions: snapshotPlan.removedVersions
  });

  console.log(`[news/storage] ${dryRun ? 'planned' : 'completed'} cleanup: snapshots ${report.snapshot_versions_before} -> ${report.snapshot_versions_retained}, ${(report.planned_snapshot_reclaim_bytes / 1024 / 1024).toFixed(1)} MiB snapshot reclaim; media ${report.media_objects_before} -> ${report.media_objects_referenced}, ${(report.planned_media_reclaim_bytes / 1024 / 1024).toFixed(1)} MiB safe media reclaim${mediaSweepSafe ? '' : ` skipped (${mediaSweepReason})`}.`);
  return report;
}

function parseArguments(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await pruneNewsStorage(parseArguments(process.argv.slice(2)));
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/news-storage-prune.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
