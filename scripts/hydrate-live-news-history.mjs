import fs from 'node:fs/promises';

const manifestUrl = new URL(process.env.NEWS_STORAGE_MANIFEST_URL || 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json');
const eventsPath = 'data/news-events.json';
const reportPath = 'tmp/news-history-hydration.json';
const trustedOrigin = 'https://storage.yandexcloud.net';
const bucketPrefix = '/igropoisk-content/';
const trustedSnapshotPrefix = `${bucketPrefix}news/snapshots/`;
const trustedArchivePrefix = `${bucketPrefix}news/archive/`;

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

function validateUrl(value, prefix, label) {
  const url = new URL(value);
  if (url.origin !== trustedOrigin || !url.pathname.startsWith(prefix)) {
    throw new Error(`${label} URL is outside the trusted news storage namespace.`);
  }
  return url;
}

function itemIdentity(item) {
  const source = String(item?.primaryUrl || item?.url || '').trim();
  if (source) {
    try {
      const url = new URL(source);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      }
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
    } catch {}
  }
  return String(item?.id || '').trim();
}

function publicationTime(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function deduplicate(items) {
  const seen = new Set();
  const output = [];
  for (const item of [...items].sort((a, b) => publicationTime(b) - publicationTime(a))) {
    const identity = itemIdentity(item);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    output.push(item);
  }
  return output;
}

async function loadLegacySnapshot(manifest) {
  const file = manifest.files?.[eventsPath];
  if (!file?.url) throw new Error(`Current live news manifest is missing ${eventsPath}.`);
  const sourceUrl = validateUrl(file.url, `${trustedSnapshotPrefix}${manifest.version}/`, 'Legacy snapshot');
  const payload = await fetchJson(sourceUrl, 'live news archive');
  const items = Array.isArray(payload) ? payload : (payload.items || []);
  if (!Array.isArray(items) || !items.length) throw new Error('Current live news archive is empty.');
  return {
    payload,
    items,
    sources: [sourceUrl.href],
    mode: 'legacy-full-snapshot'
  };
}

async function loadMonthlyArchive(manifest) {
  const indexEntry = manifest.archive?.index;
  if (!indexEntry?.url) throw new Error('Monthly news manifest is missing archive index.');
  const indexUrl = validateUrl(indexEntry.url, `${trustedSnapshotPrefix}${manifest.version}/`, 'Archive index');
  const index = await fetchJson(indexUrl, 'news archive index');
  if (index?.schemaVersion !== 1 || index?.channel !== 'news-archive' || !Array.isArray(index?.months)) {
    throw new Error('Current news archive index is invalid.');
  }

  const allItems = [];
  const sources = [indexUrl.href];
  const entries = index.months;
  const concurrency = 8;
  for (let offset = 0; offset < entries.length; offset += concurrency) {
    const batch = entries.slice(offset, offset + concurrency);
    const payloads = await Promise.all(batch.map(async entry => {
      if (!/^\d{4}-\d{2}$/.test(String(entry?.month || ''))) throw new Error('Archive month key is invalid.');
      const [year, month] = entry.month.split('-');
      const expectedPrefix = `${trustedArchivePrefix}${year}/${month}.json`;
      const url = validateUrl(entry.url, expectedPrefix, `Archive month ${entry.month}`);
      if (url.pathname !== expectedPrefix) throw new Error(`Archive month ${entry.month} URL does not match its canonical path.`);
      const payload = await fetchJson(url, `news archive ${entry.month}`);
      if (payload?.schemaVersion !== 1 || payload?.channel !== 'news-archive-month' || payload?.month !== entry.month) {
        throw new Error(`Archive month ${entry.month} payload is invalid.`);
      }
      sources.push(url.href);
      return Array.isArray(payload.items) ? payload.items : [];
    }));
    payloads.forEach(items => allItems.push(...items));
  }

  const items = deduplicate(allItems);
  if (!items.length) throw new Error('Monthly news archive is empty.');
  return {
    payload: {
      generatedAt: new Date().toISOString(),
      model: 'monthly-storage-hydrated',
      retainedHistory: items.length,
      items
    },
    items,
    sources,
    mode: 'monthly-archive-v1'
  };
}

const manifest = await fetchJson(manifestUrl, 'news manifest');
if (![1, 2].includes(Number(manifest?.schemaVersion)) || manifest?.channel !== 'news' || !manifest?.version) {
  throw new Error('Current live news manifest is invalid.');
}

const result = manifest.schemaVersion === 2
  ? await loadMonthlyArchive(manifest)
  : await loadLegacySnapshot(manifest);

await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(result.payload, null, 2)}\n`, 'utf8');
const report = {
  schema_version: 2,
  hydrated_at: new Date().toISOString(),
  manifest_schema_version: manifest.schemaVersion,
  manifest_version: manifest.version,
  manifest_published_at: manifest.publishedAt || null,
  mode: result.mode,
  source_count: result.sources.length,
  articles: result.items.length
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[news/history] hydrated ${result.items.length} historical events via ${result.mode} from ${manifest.version}.`);
