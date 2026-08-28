import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { editNewsToRussian, fetchArticleText, isLikelyNewsSource, validateProductionNews, warmNewsEditor } from './lib/news-editor-production.mjs';
import { selectCommercialHomeNews } from './lib/news-home-selector.mjs';

const eventsPath = 'data/news-events.json';
const reportPath = process.env.NEWS_EDITOR_REPORT || 'tmp/news-editor-report.json';
const editorialVersion = 7;
const minimumPublicItems = Math.max(12, Number(process.env.NEWS_EDITOR_MIN_PUBLIC || 12));
// Strict filtering needs headroom; rejected drafts get one bounded repair pass and
// generation continues until the homepage can actually form a fresh/diverse set.
const maxItems = Math.max(minimumPublicItems + 18, Number(process.env.NEWS_EDITOR_MAX_ITEMS || minimumPublicItems + 18));
const commercialPolicy = Object.freeze({
  limit: minimumPublicItems,
  maxAgeHours: 168,
  recentHours: 72,
  minRecent: Math.min(minimumPublicItems, 8),
  maxPerTopic: 2,
  maxPerSource: 3
});

function hasCyrillic(value = '') {
  return /[А-Яа-яЁё]/.test(String(value));
}

function isPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
}

function setPublic(item, value) {
  item.publicEligible = value;
  item.globalEligible = value;
  if (!value) item.regionalEligible = false;
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
    return String(value || '').trim();
  }
}

function itemHash(item) {
  return createHash('sha1').update([
    editorialVersion,
    canonicalUrl(item.primaryUrl || item.url || ''),
    String(item.titleEn || item.title || ''),
    String(item.summaryEn || item.summary || '')
  ].join('\n')).digest('hex');
}

function sourceIsRussian(item) {
  const originalTitle = String(item.titleEn || item.title || '');
  const originalSummary = String(item.summaryEn || item.summary || '');
  return hasCyrillic(originalTitle) && (!originalSummary || hasCyrillic(originalSummary));
}

function cachedApproval(item) {
  const hash = itemHash(item);
  return item.editorialStatus === 'approved'
    && Number(item.editorialVersion) === editorialVersion
    && item.editorialSourceHash === hash
    && hasCyrillic(item.titleRu)
    && String(item.summaryRu || '').length >= 120;
}

function paragraphize(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length < 250) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:[»”']?)/g) || [];
  if (sentences.length < 2) return text;
  return `${sentences[0].trim()}\n\n${sentences.slice(1).join(' ').trim()}`;
}

function publishedAt(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function sourceTitle(item) {
  return String(item.titleEn || item.title || '').trim();
}

function sourceSummary(item) {
  return String(item.summaryEn || item.summary || sourceTitle(item)).trim();
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);

let nativeRussian = 0;
let cached = 0;
let approved = 0;
let rejected = 0;
let filteredNonNews = 0;
let pending = 0;
let attempted = 0;
let modelLoadMs = 0;
const failures = [];
const attemptedItems = new Set();
const nativeApprovedItems = new Set();

function editoriallyApproved(item) {
  return nativeApprovedItems.has(item) || cachedApproval(item) || item.editorialStatus === 'approved';
}

function currentCommercialSelection() {
  return selectCommercialHomeNews(
    items
      .filter(item => isPublic(item) && editoriallyApproved(item))
      .sort((a, b) => publishedAt(b) - publishedAt(a)),
    commercialPolicy
  );
}

for (const item of items) {
  if (!isPublic(item)) continue;

  const title = sourceTitle(item);
  const summary = sourceSummary(item);
  const url = item.primaryUrl || item.url || '';
  if (!isLikelyNewsSource({ title, url })) {
    filteredNonNews += 1;
    setPublic(item, false);
    item.editorialStatus = 'filtered-non-news';
    item.editorialVersion = editorialVersion;
    item.editorialSourceHash = itemHash(item);
    item.editorialReasons = ['guide/list content is not a news item'];
    continue;
  }

  if (sourceIsRussian(item)) {
    const nativeValidation = validateProductionNews(
      { titleRu: title, briefRu: summary },
      { title, summary, url }
    );
    if (nativeValidation.ok) {
      item.titleRu = nativeValidation.titleRu;
      item.summaryRu = paragraphize(nativeValidation.briefRu);
      item.editorialBriefRu = item.summaryRu;
      item.editorialStatus = 'source-ru';
      item.editorialVersion = editorialVersion;
      item.editorialSourceHash = itemHash(item);
      delete item.editorialReasons;
      nativeApprovedItems.add(item);
      nativeRussian += 1;
    } else {
      item.editorialStatus = 'source-ru-needs-edit';
      item.editorialVersion = editorialVersion;
      item.editorialSourceHash = itemHash(item);
      item.editorialReasons = nativeValidation.reasons;
      console.error(`[news/editor] Russian source needs edit ${title}: ${nativeValidation.reasons.join('; ')}`);
    }
  } else if (cachedApproval(item)) {
    cached += 1;
  }
}

const candidates = items
  .filter(item => isPublic(item) && !nativeApprovedItems.has(item) && !cachedApproval(item))
  .sort((a, b) => publishedAt(b) - publishedAt(a));

const initialCommercialSelection = currentCommercialSelection();
if (candidates.length && !initialCommercialSelection.ok) {
  const warmup = await warmNewsEditor();
  modelLoadMs = warmup.elapsedMs;
  console.log(`[news/editor] ${warmup.model} ready in ${(warmup.elapsedMs / 1000).toFixed(1)}s; ${candidates.length} uncached public items available for a commercial homepage mix`);
}

for (const item of candidates) {
  if (attempted >= maxItems) break;
  if (currentCommercialSelection().ok) break;

  attempted += 1;
  attemptedItems.add(item);
  const title = sourceTitle(item);
  const summary = sourceSummary(item);
  const url = item.primaryUrl || item.url || '';
  let articleText = '';
  let articleFetchError = '';

  try {
    articleText = await fetchArticleText(url, 8000, `${title} ${summary}`);
  } catch (error) {
    articleFetchError = error.message;
    console.error(`[news/editor/article] ${url}: ${error.message}; using source lead`);
  }

  try {
    const edited = await editNewsToRussian({
      title,
      summary,
      articleText,
      url,
      source: item.primarySource || item.source || ''
    }, { maxAttempts: 2, maxNewTokens: 165 });

    if (!edited.ok) {
      rejected += 1;
      setPublic(item, false);
      item.editorialStatus = 'rejected';
      item.editorialVersion = editorialVersion;
      item.editorialSourceHash = itemHash(item);
      item.editorialRejectedAt = new Date().toISOString();
      item.editorialReasons = edited.reasons;
      failures.push({ id: item.id, url, reasons: edited.reasons, articleFetchError });
      console.error(`[news/editor] rejected ${title}: ${edited.reasons.join('; ')}`);
      continue;
    }

    const briefRu = paragraphize(edited.briefRu);
    item.titleRu = edited.titleRu;
    item.summaryRu = briefRu;
    item.editorialBriefRu = briefRu;
    item.editorialStatus = 'approved';
    item.editorialVersion = editorialVersion;
    item.editorialSourceHash = itemHash(item);
    item.editorialModel = edited.model;
    item.editorialDtype = edited.dtype;
    item.editorialGeneratedAt = new Date().toISOString();
    item.editorialAttempts = edited.attempts;
    item.editorialProductionSalvaged = Boolean(edited.productionSalvaged);
    delete item.editorialReasons;
    delete item.editorialRejectedAt;
    approved += 1;
    console.log(`[news/editor] approved ${item.id} in ${(edited.elapsedMs / 1000).toFixed(1)}s (${edited.attempts} attempt${edited.attempts === 1 ? '' : 's'}): ${item.titleRu}`);
  } catch (error) {
    rejected += 1;
    setPublic(item, false);
    item.editorialStatus = 'rejected';
    item.editorialVersion = editorialVersion;
    item.editorialSourceHash = itemHash(item);
    item.editorialRejectedAt = new Date().toISOString();
    item.editorialReasons = [error.message];
    failures.push({ id: item.id, url, reasons: [error.message], articleFetchError });
    console.error(`[news/editor] failed ${title}: ${error.stack || error.message}`);
  }
}

for (const item of candidates) {
  if (attemptedItems.has(item)) continue;
  pending += 1;
  setPublic(item, false);
  item.editorialStatus = 'pending';
  item.editorialVersion = editorialVersion;
  item.editorialSourceHash = itemHash(item);
}

const publicItems = items.filter(isPublic);
const publicApproved = publicItems.filter(editoriallyApproved).length;
const commercialSelection = selectCommercialHomeNews(
  publicItems.filter(editoriallyApproved).sort((a, b) => publishedAt(b) - publishedAt(a)),
  commercialPolicy
);
const output = Array.isArray(payload) ? items : { ...payload, generatedAt: new Date().toISOString(), items };
await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  editorialVersion,
  model: process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen3-4B-Instruct-2507-ONNX',
  dtype: process.env.NEWS_EDITOR_DTYPE || 'q4',
  maxItems,
  minimumPublicItems,
  commercialPolicy,
  commercialSelection: commercialSelection.diagnostics,
  modelLoadMs,
  totalItems: items.length,
  candidateItems: candidates.length,
  attempted,
  approved,
  cached,
  nativeRussian,
  rejected,
  filteredNonNews,
  pending,
  publicItems: publicItems.length,
  publicApproved,
  failures
}, null, 2)}\n`, 'utf8');

console.log(`[news/editor] public=${publicItems.length}; approved-now=${approved}; cached=${cached}; source-ru=${nativeRussian}; rejected=${rejected}; filtered-non-news=${filteredNonNews}; pending=${pending}; commercial=${commercialSelection.ok}`);
if (!commercialSelection.ok) {
  throw new Error(`Commercial homepage mix unavailable after ${attempted} editorial attempts: ${JSON.stringify(commercialSelection.diagnostics)}. Live publication must keep the previous snapshot.`);
}
