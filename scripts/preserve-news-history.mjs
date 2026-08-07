import fs from 'node:fs/promises';
import path from 'node:path';

const eventsPath = 'data/news-events.json';
const snapshotPath = 'tmp/news-events-before-rebuild.json';
const backupRoot = 'tmp/news-history-assets';
const minimumRecentPublic = 18;
const recentWindowHours = 24;

async function readPayload(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { items: [] };
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
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

function localImagePath(item) {
  const value = String(item?.image || '').replace(/^\.\//, '');
  return /^(?:assets\/news|assets\/publisher-news)\/[A-Za-z0-9._-]+$/.test(value) ? value : '';
}

function wasPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
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
  let selected = result.filter(wasPublic).length;
  if (selected >= minimum) return result;

  const candidates = result
    .filter(item => !wasPublic(item))
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

export function historicalCandidates(currentItems, previousItems, windowHours = recentWindowHours) {
  if (!currentItems.length) return previousItems.filter(wasPublic);
  const newestCurrent = Math.max(...currentItems.map(itemTime).filter(Boolean));
  const cutoff = newestCurrent - windowHours * 3600e3;
  const seen = new Set(currentItems.map(item => canonicalUrl(item.primaryUrl || item.url)).filter(Boolean));
  return previousItems.filter(item => {
    const time = itemTime(item);
    const key = canonicalUrl(item.primaryUrl || item.url);
    if (!wasPublic(item) || !time || !key || time >= cutoff || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function backupImages(items) {
  let copied = 0;
  for (const item of items) {
    const source = localImagePath(item);
    if (!source || !(await exists(source))) continue;
    const target = path.join(backupRoot, source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    copied += 1;
  }
  return copied;
}

async function restoreHistoricalImages(items) {
  const retained = [];
  for (const item of items) {
    const image = localImagePath(item);
    if (!image) {
      retained.push(item);
      continue;
    }
    if (!(await exists(image))) {
      const backup = path.join(backupRoot, image);
      if (!(await exists(backup))) continue;
      await fs.mkdir(path.dirname(image), { recursive: true });
      await fs.copyFile(backup, image);
    }
    retained.push(item);
  }
  return retained;
}

async function snapshot() {
  if (await exists(snapshotPath)) {
    console.log('[news/history] snapshot already prepared for this pipeline run');
    return;
  }
  const payload = await readPayload(eventsPath);
  const items = Array.isArray(payload) ? payload : (payload.items || []);
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`);
  const copied = await backupImages(items);
  console.log(`[news/history] snapshotted ${items.length} existing events and ${copied} local images`);
}

async function merge() {
  const currentPayload = await readPayload(eventsPath);
  const previousPayload = await readPayload(snapshotPath);
  const current = promoteBalancedSelection(Array.isArray(currentPayload) ? currentPayload : (currentPayload.items || []));
  const previous = Array.isArray(previousPayload) ? previousPayload : (previousPayload.items || []);
  const historical = await restoreHistoricalImages(historicalCandidates(current, previous));
  const items = [...current, ...historical].sort((a, b) => itemTime(b) - itemTime(a));
  const publicCount = items.filter(wasPublic).length;
  const payload = {
    ...(Array.isArray(currentPayload) ? {} : currentPayload),
    generatedAt: new Date().toISOString(),
    model: 'event-first-editorial-selection-plus-region-history',
    minimumRecentPublic,
    retainedHistory: historical.length,
    items
  };
  await fs.writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rm(snapshotPath, { force: true });
  await fs.rm(backupRoot, { recursive: true, force: true });
  console.log(`[news/history] ${current.length} current events; ${historical.length} historical retained; ${publicCount} public across archive`);
}

const mode = process.argv[2];
if (mode === '--snapshot') await snapshot();
else if (mode === '--merge') await merge();
else throw new Error('Use --snapshot or --merge.');
