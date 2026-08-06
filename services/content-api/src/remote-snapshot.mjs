import crypto from 'node:crypto';
import { parseSnapshot } from './news-record.mjs';
import { fetchLimitedBody } from './remote-http.mjs';
import { parseNewsManifest, snapshotEntry } from './remote-manifest.mjs';
import { boundedInteger, DEFAULT_ALLOWED_HOSTS, DEFAULT_NEWS_MANIFEST_URL, hostSet, safeRemoteUrl } from './remote-policy.mjs';

export { DEFAULT_NEWS_MANIFEST_URL } from './remote-policy.mjs';

export async function fetchPublishedNewsSnapshot({
  manifestUrl = process.env.NEWS_MANIFEST_URL || DEFAULT_NEWS_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  allowedHosts = process.env.SNAPSHOT_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS,
  timeoutMs = process.env.SNAPSHOT_FETCH_TIMEOUT_MS || 15_000,
  maximumManifestBytes = process.env.MANIFEST_MAX_BYTES || 256_000,
  maximumSnapshotBytes = process.env.SNAPSHOT_MAX_BYTES || 25_000_000,
  allowHttpForTests = false
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const hosts = hostSet(allowedHosts);
  const timeout = boundedInteger(timeoutMs, 15_000, { minimum: 100, maximum: 120_000 });
  const manifestLimit = boundedInteger(maximumManifestBytes, 256_000, { minimum: 1_024, maximum: 2_000_000 });
  const snapshotLimit = boundedInteger(maximumSnapshotBytes, 25_000_000, { minimum: 1_024, maximum: 100_000_000 });
  const verifiedManifestUrl = safeRemoteUrl(manifestUrl, { allowedHosts: hosts, allowHttpForTests, label: 'News manifest URL' });
  const manifestBody = await fetchLimitedBody(fetchImpl, verifiedManifestUrl, { timeoutMs: timeout, maximumBytes: manifestLimit, label: 'News manifest' });
  const manifest = parseNewsManifest(manifestBody);
  const entry = snapshotEntry(manifest, verifiedManifestUrl, hosts, allowHttpForTests);
  if (entry.bytes > snapshotLimit) throw new Error('Published snapshot exceeds the configured maximum size.');
  const body = await fetchLimitedBody(fetchImpl, entry.url, { timeoutMs: timeout, maximumBytes: snapshotLimit, label: 'Published news snapshot' });
  if (body.length !== entry.bytes) throw new Error('Published snapshot byte count does not match the manifest.');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  if (sha256 !== entry.sha256) throw new Error('Published snapshot SHA-256 does not match the manifest.');
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Published news snapshot is not valid JSON.'); }
  const snapshot = parseSnapshot(payload);
  return Object.freeze({
    manifest: Object.freeze({ schemaVersion: 1, channel: 'news', version: manifest.version, publishedAt: manifest.publishedAt,
      sourceCommit: String(manifest.sourceCommit), sourceRunId: String(manifest.sourceRunId), url: verifiedManifestUrl.href }),
    entry: Object.freeze({ relative: entry.relative, key: entry.key, url: entry.url.href, sha256, bytes: body.length, bucket: entry.bucket }),
    snapshot, body
  });
}
