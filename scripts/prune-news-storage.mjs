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

  for (const group of complete.slice(0, Math.max(1, Number(keepRecentSnapshots) || 12))) keep.add(group.version);

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
    if (dailyKept >= Math.max(0, Number(keepDailySnapshots) || 0)) break;
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

  const currentResponse = await storage.getObject(currentManifestKey);
  const currentManifest = await currentResponse.json();
  if (currentManifest?.schemaVersion !== 1 || currentManifest?.channel !== 'news' || !currentManifest?.version) {
    throw new Error('Current news manifest is invalid; refusing storage cleanup.');
  }

  const [snapshotObjects, mediaObjects] = await Promise.all([
    storage.listObjects({ prefix: `${snapshotPrefix.replace(/\/$/, '')}/` }),
    storage.listObjects({ prefix: `${mediaPrefix.replace(/\/$/, '')}/` })
  ]);
  const plan = buildSnapshotRetentionPlan(snapshotObjects, {
    snapshotPrefix,
    currentVersion: currentManifest.version,
    keepRecentSnapshots: retention.keep_recent_snapshots ?? 12,
    keepDailySnapshots: retention.keep_daily_snapshots ?? 7,
    deleteIncompleteSnapshots: retention.delete_incomplete_snapshots !== false
  });

  let deletedObjects = 0;
  if (!dryRun && plan.removedObjects.length) {
    deletedObjects = await deleteObjects(storage, plan.removedObjects, Number(retention.delete_concurrency || 16));
  }

  if (!dryRun) {
    await storage.headObject(currentManifestKey);
    await storage.headObject(`${snapshotPrefix.replace(/\/$/, '')}/${currentManifest.version}/manifest.json`);
  }

  const report = Object.freeze({
    schema_version: 1,
    dry_run: dryRun,
    current_version: currentManifest.version,
    snapshot_versions_before: plan.versions,
    snapshot_versions_retained: plan.retainedVersions.length,
    snapshot_versions_removed: plan.removedVersions.length,
    snapshot_objects_removed: dryRun ? 0 : deletedObjects,
    snapshot_bytes_before: plan.totalBytes,
    snapshot_bytes_retained: plan.retainedBytes,
    snapshot_bytes_reclaimed: dryRun ? 0 : plan.removedBytes,
    planned_reclaim_bytes: plan.removedBytes,
    media_objects_preserved: mediaObjects.length,
    media_bytes_preserved: sumBytes(mediaObjects),
    history_policy: 'Historical news records and news/media are preserved; only redundant immutable snapshot versions are pruned.',
    retained_versions: plan.retainedVersions,
    removed_versions: plan.removedVersions
  });

  console.log(`[news/storage] ${dryRun ? 'planned' : 'completed'} cleanup: ${report.snapshot_versions_before} snapshot versions -> ${report.snapshot_versions_retained}; ${report.snapshot_versions_removed} versions removable; ${(report.planned_reclaim_bytes / 1024 / 1024).toFixed(1)} MiB reclaimable; ${report.media_objects_preserved} media objects preserved.`);
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
