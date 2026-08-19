import assert from 'node:assert/strict';
import { buildSnapshotRetentionPlan } from './prune-news-storage.mjs';

const prefix = 'news/snapshots';
const object = (version, file = 'manifest.json', size = 100) => ({
  key: `${prefix}/${version}/${file}`,
  size,
  lastModified: '2026-08-19T00:00:00.000Z'
});

const current = '20260819T080000Z-current-run';
const recent = '20260819T070000Z-recent-run';
const previousDay = '20260818T120000Z-daily-run';
const olderSameDay = '20260818T010000Z-old-run';
const ancient = '20260810T010000Z-ancient-run';
const incomplete = '20260819T075900Z-incomplete-run';

const objects = [
  object(current), object(current, 'data/news-events.json', 200),
  object(recent), object(recent, 'data/news-events.json', 200),
  object(previousDay), object(previousDay, 'data/news-events.json', 200),
  object(olderSameDay), object(olderSameDay, 'data/news-events.json', 200),
  object(ancient), object(ancient, 'data/news-events.json', 200),
  object(incomplete, 'data/news-events.json', 200)
];

const plan = buildSnapshotRetentionPlan(objects, {
  snapshotPrefix: prefix,
  currentVersion: current,
  keepRecentSnapshots: 2,
  keepDailySnapshots: 1,
  deleteIncompleteSnapshots: true
});

assert(plan.retainedVersions.includes(current), 'current snapshot must always be retained');
assert(plan.retainedVersions.includes(recent), 'recent rollback snapshot must be retained');
assert(plan.retainedVersions.includes(previousDay), 'one daily rollback snapshot must be retained');
assert(!plan.retainedVersions.includes(olderSameDay), 'redundant same-day snapshot should be pruned');
assert(!plan.retainedVersions.includes(ancient), 'snapshot outside retention should be pruned');
assert(!plan.retainedVersions.includes(incomplete), 'incomplete snapshot should be pruned');
assert(plan.removedObjects.every(entry => !entry.key.startsWith(`${prefix}/${current}/`)), 'current snapshot objects must never be deleted');

const productionPlan = buildSnapshotRetentionPlan(objects, {
  snapshotPrefix: prefix,
  currentVersion: current,
  keepRecentSnapshots: 3,
  keepDailySnapshots: 0,
  deleteIncompleteSnapshots: true
});
assert.deepEqual(
  productionPlan.retainedVersions,
  [current, recent, previousDay],
  'production retention must keep exactly the current snapshot plus two rollback snapshots and no daily extras'
);
assert(!productionPlan.retainedVersions.includes(olderSameDay));
assert(!productionPlan.retainedVersions.includes(ancient));

assert.throws(() => buildSnapshotRetentionPlan(objects, {
  snapshotPrefix: prefix,
  currentVersion: 'missing-current',
  keepRecentSnapshots: 2,
  keepDailySnapshots: 1
}), /was not found/, 'cleanup must fail closed when the current snapshot cannot be found');

console.log('News Object Storage retention safety tests passed.');
