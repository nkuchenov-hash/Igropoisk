import path from 'node:path';
import { DEFAULT_NEWS_MANIFEST_URL, fetchPublishedNewsSnapshot } from './remote-snapshot.mjs';
import { withTemporarySnapshot, writeReport } from './remote-report.mjs';

function argumentsFrom(argv) {
  const result = { manifestUrl: process.env.NEWS_MANIFEST_URL || DEFAULT_NEWS_MANIFEST_URL,
    expectedVersion: '', report: process.env.NEWS_SHADOW_SYNC_REPORT || '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--manifest-url' && value) result.manifestUrl = value;
    if (name === '--expected-version' && value) result.expectedVersion = value;
    if (name === '--report' && value) result.report = path.resolve(process.cwd(), value);
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  return result;
}

export async function syncRemoteSnapshot({ manifestUrl = DEFAULT_NEWS_MANIFEST_URL, expectedVersion = '', reportPath = '',
  fetchOptions = {}, synchronize } = {}) {
  const remote = await fetchPublishedNewsSnapshot({ manifestUrl, ...fetchOptions });
  if (expectedVersion && remote.manifest.version !== expectedVersion) {
    throw new Error(`Published manifest version ${remote.manifest.version} does not match required ${expectedVersion}.`);
  }
  const sync = synchronize || (await import('./sync-shadow.mjs')).synchronizeShadow;
  const result = await withTemporarySnapshot(remote.body, file => sync({ file, channel: 'news',
    snapshotVersion: remote.manifest.version, manifestUrl: remote.manifest.url }));
  const report = {
    schemaVersion: 1, status: result.comparison.status, synchronizedAt: new Date().toISOString(),
    source: { manifest: remote.manifest, snapshot: remote.entry, itemCount: remote.snapshot.items.length },
    imported: result.imported, comparison: result.comparison
  };
  await writeReport(reportPath, report);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  try {
    const report = await syncRemoteSnapshot({ manifestUrl: options.manifestUrl, expectedVersion: options.expectedVersion, reportPath: options.report });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'exact') process.exitCode = 2;
  } finally {
    const { closePool } = await import('./database.mjs');
    await closePool();
  }
}
