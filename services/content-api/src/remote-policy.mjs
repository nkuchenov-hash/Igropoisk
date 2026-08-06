export const DEFAULT_NEWS_MANIFEST_URL = 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json';
export const DEFAULT_ALLOWED_HOSTS = Object.freeze(['storage.yandexcloud.net']);

export function boundedInteger(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const result = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`Integer value must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

export function hostSet(value = DEFAULT_ALLOWED_HOSTS) {
  const values = value instanceof Set ? [...value]
    : Array.isArray(value) ? value
      : String(value || '').split(',');
  const hosts = values.map(item => String(item).trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) throw new Error('At least one snapshot host must be allowed.');
  return new Set(hosts);
}

export function safeRemoteUrl(value, { allowedHosts, allowHttpForTests = false, label }) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw new Error(`${label} is not a valid URL.`); }
  const protocols = allowHttpForTests ? new Set(['https:', 'http:']) : new Set(['https:']);
  if (!protocols.has(url.protocol)) throw new Error(`${label} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error(`${label} host is not allowed.`);
  if (url.hash || url.search) throw new Error(`${label} must not contain a fragment or query.`);
  return url;
}

export function decodedPath(pathname, label) {
  try { return pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { throw new Error(`${label} contains invalid URL encoding.`); }
}

export function validObjectKey(value) {
  const key = String(value || '').trim();
  if (!key || key.startsWith('/') || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Published snapshot object key is invalid.');
  }
  return key;
}
