import { decodedPath, safeRemoteUrl, validObjectKey } from './remote-policy.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

export function parseNewsManifest(buffer) {
  let manifest;
  try { manifest = JSON.parse(buffer.toString('utf8')); }
  catch { throw new Error('News manifest is not valid JSON.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('News manifest must be an object.');
  if (manifest.schemaVersion !== 1 || manifest.channel !== 'news') throw new Error('Unsupported news manifest contract.');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(String(manifest.version || ''))) throw new Error('News manifest version is invalid.');
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error('News manifest publishedAt is invalid.');
  if (!/^[a-f0-9]{40}$/i.test(String(manifest.sourceCommit || ''))) throw new Error('News manifest sourceCommit is invalid.');
  if (!/^[0-9]{1,24}$/.test(String(manifest.sourceRunId || ''))) throw new Error('News manifest sourceRunId is invalid.');
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('News manifest files map is missing.');
  return manifest;
}

export function snapshotEntry(manifest, manifestUrl, allowedHosts, allowHttpForTests = false) {
  const relative = 'data/news-events.json';
  const entry = manifest.files[relative];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`News manifest does not contain ${relative}.`);
  const key = validObjectKey(entry.key);
  const expectedKey = `news/snapshots/${manifest.version}/${relative}`;
  if (key !== expectedKey) throw new Error('Published snapshot key does not match the manifest version.');
  if (!SHA256.test(String(entry.sha256 || ''))) throw new Error('Published snapshot SHA-256 is invalid.');
  const bytes = Number(entry.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 100_000_000) throw new Error('Published snapshot byte count is invalid.');

  const url = safeRemoteUrl(entry.url, { allowedHosts, allowHttpForTests, label: 'Published snapshot URL' });
  if (url.origin !== manifestUrl.origin) throw new Error('Published snapshot must use the manifest origin.');
  const manifestPath = decodedPath(manifestUrl.pathname, 'Manifest URL');
  if (manifestPath.length !== 4 || manifestPath[1] !== 'news' || manifestPath[2] !== 'manifests' || manifestPath[3] !== 'current.json') {
    throw new Error('Manifest URL path is not canonical.');
  }
  const bucket = manifestPath[0];
  if (decodedPath(url.pathname, 'Published snapshot URL').join('/') !== `${bucket}/${key}`) {
    throw new Error('Published snapshot URL does not match its bucket and key.');
  }
  return { relative, key, url, sha256: entry.sha256, bytes, bucket };
}
