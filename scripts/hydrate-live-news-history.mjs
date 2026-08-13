import fs from 'node:fs/promises';

const manifestUrl = new URL(process.env.NEWS_STORAGE_MANIFEST_URL || 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json');
const eventsPath = 'data/news-events.json';
const reportPath = 'tmp/news-history-hydration.json';
const trustedOrigin = 'https://storage.yandexcloud.net';
const trustedPrefix = '/igropoisk-content/news/snapshots/';

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

const manifest = await fetchJson(manifestUrl, 'news manifest');
if (manifest?.schemaVersion !== 1 || manifest?.channel !== 'news' || !manifest?.version) {
  throw new Error('Current live news manifest is invalid.');
}
const file = manifest.files?.[eventsPath];
if (!file?.url) throw new Error(`Current live news manifest is missing ${eventsPath}.`);
const sourceUrl = new URL(file.url);
if (sourceUrl.origin !== trustedOrigin || !sourceUrl.pathname.startsWith(`${trustedPrefix}${manifest.version}/`)) {
  throw new Error('Current live news archive URL is outside the trusted immutable snapshot.');
}
const payload = await fetchJson(sourceUrl, 'live news archive');
const items = Array.isArray(payload) ? payload : (payload.items || []);
if (!Array.isArray(items) || !items.length) throw new Error('Current live news archive is empty.');

await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
const report = {
  schema_version: 1,
  hydrated_at: new Date().toISOString(),
  manifest_version: manifest.version,
  manifest_published_at: manifest.publishedAt || null,
  source_url: sourceUrl.href,
  articles: items.length
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[news/history] hydrated ${items.length} live historical events from ${manifest.version}.`);
