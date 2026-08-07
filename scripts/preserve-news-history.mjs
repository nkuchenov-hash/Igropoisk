import fs from 'node:fs/promises';

const eventsPath = 'data/news-events.json';
const snapshotPath = 'tmp/news-events-before-rebuild.json';
const minimumRecentPublic = 18;

async function readPayload(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return { items: [] };
  }
}

function itemTime(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${search ? `?${search}` : ''}`;
  } catch {
    return String(value || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function editorialScore(item) {
  return Number(item?.editorialScore || 0)
    + Number(item?.globalScore || item?.trendScore || 0)
    + Number(item?.mediaSourceCount || 0) * 100
    + Number(item?.discussionMentions || 0) * 70
    + Number(item?.regionalScore || 0)
    + (item?.official ? 60 : 0);
}

export function promoteBalancedSelection(items, minimum = minimumRecentPublic) {
  const result = items.map(item => ({ ...item }));
  let selected = result.filter(item => item.publicEligible || item.globalEligible || item.regionalEligible).length;
  if (selected >= minimum) return result;

  const candidates = result
    .filter(item => !(item.publicEligible || item.globalEligible || item.regionalEligible))
    .sort((a, b) => editorialScore(b) - editorialScore(a) || itemTime(b) - itemTime(a));

  for (const item of candidates) {
    if (selected >= Math.min(minimum, result.length)) break;
    item.publicEligible = true;
    item.globalEligible = true;
    item.selectionReason = 'editorial-balance-floor';
    selected += 1;
  }
  return result;
}

export function mergeHistoricalEvents(currentItems, previousItems) {
  if (!currentItems.length) return [...previousItems];
  const oldestCurrent = Math.min(...currentItems.map(itemTime).filter(Boolean));
  const seen = new Set(currentItems.map(item => canonicalUrl(item.primaryUrl || item.url)).filter(Boolean));
  const history = previousItems.filter(item => {
    const time = itemTime(item);
    const key = canonicalUrl(item.primaryUrl || item.url);
    if (!time || !key || time >= oldestCurrent || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...currentItems, ...history].sort((a, b) => itemTime(b) - itemTime(a));
}

async function snapshot() {
  const payload = await readPayload(eventsPath);
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[news/history] snapshotted ${(payload.items || []).length} existing events`);
}

async function merge() {
  const currentPayload = await readPayload(eventsPath);
  const previousPayload = await readPayload(snapshotPath);
  const current = promoteBalancedSelection(Array.isArray(currentPayload) ? currentPayload : (currentPayload.items || []));
  const previous = Array.isArray(previousPayload) ? previousPayload : (previousPayload.items || []);
  const items = mergeHistoricalEvents(current, previous);
  const publicCount = items.filter(item => item.publicEligible || item.globalEligible || item.regionalEligible).length;
  const retainedHistory = Math.max(0, items.length - current.length);
  const payload = {
    ...(Array.isArray(currentPayload) ? {} : currentPayload),
    generatedAt: new Date().toISOString(),
    model: 'event-first-editorial-selection-plus-region-history',
    minimumRecentPublic,
    retainedHistory,
    items
  };
  await fs.writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[news/history] ${current.length} current events; ${retainedHistory} historical retained; ${publicCount} public across archive`);
}

const mode = process.argv[2];
if (mode === '--snapshot') await snapshot();
else if (mode === '--merge') await merge();
else throw new Error('Use --snapshot or --merge.');
