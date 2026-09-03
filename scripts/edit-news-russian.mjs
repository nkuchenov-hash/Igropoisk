import fs from 'node:fs/promises';
import {
  editNewsToRussian,
  fetchArticleText,
  isLikelyNewsSource,
  validateProductionNews,
  warmNewsEditor
} from './lib/news-editor-production.mjs';
import { newsTopicKey, selectCommercialHomeNews } from './lib/news-home-selector.mjs';
import {
  NEWS_EDITORIAL_VERSION,
  editorialSourceHash,
  hasCyrillic,
  hasValidEditorialCache
} from './lib/news-editor-policy.mjs';
import { decodeNewsSourceText, sourceEntityCandidates } from './lib/news-publication-quality.mjs';

const eventsPath = 'data/news-events.json';
const reportPath = process.env.NEWS_EDITOR_REPORT || 'tmp/news-editor-report.json';
const configuredHomepageDisplayLimit = Math.max(0, Number(process.env.NEWS_HOMEPAGE_LIMIT || 0));
const qwenMaxItems = Math.max(0, Math.min(4, Number(process.env.NEWS_EDITOR_QWEN_MAX_ITEMS || 3)));
const qwenBudgetMs = Math.max(60_000, Number(process.env.NEWS_EDITOR_QWEN_BUDGET_MS || 6 * 60_000));
const nativeConcurrency = Math.max(1, Math.min(8, Number(process.env.NEWS_EDITOR_NATIVE_CONCURRENCY || 6)));
const startedAt = Date.now();
const commercialPolicy = Object.freeze({
  limit: configuredHomepageDisplayLimit > 0 ? configuredHomepageDisplayLimit : Number.MAX_SAFE_INTEGER,
  maxAgeHours: 168,
  recentHours: 72,
  minRecent: configuredHomepageDisplayLimit > 0 ? Math.min(configuredHomepageDisplayLimit, 8) : 0,
  maxPerTopic: 2,
  maxPerSource: 3
});
const unresolvedGameReasons = new Set([
  'ambiguous-primary-game-verification',
  'unverified-primary-game',
  'unknown-explicit-game',
  'ambiguous-explicit-name',
  'ambiguous-alias',
  'manual-game-not-found'
]);

function isPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
}

function setPublic(item, value) {
  item.publicEligible = value;
  item.globalEligible = value;
  if (!value) item.regionalEligible = false;
}

function sourceTitle(item) {
  return decodeNewsSourceText(item.titleEn || item.title || '');
}

function sourceSummary(item) {
  return decodeNewsSourceText(item.summaryEn || item.summary || sourceTitle(item));
}

function sourceUrl(item) {
  return String(item.primaryUrl || item.url || '').trim();
}

function sourceIsRussian(item) {
  const title = sourceTitle(item);
  const summary = sourceSummary(item);
  return hasCyrillic(title) && (!summary || hasCyrillic(summary));
}

function publishedAt(item) {
  const value = Date.parse(item?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function gameIdentityEligible(item) {
  const reasons = Array.isArray(item?.gameReviewReasons) ? item.gameReviewReasons : [];
  return !reasons.some(reason => unresolvedGameReasons.has(String(reason)));
}

function localizedPolicyEligible(item) {
  const title = String(item.titleRu || '').trim();
  const summary = String(item.summaryRu || item.editorialBriefRu || '').trim();
  return Boolean(title && summary && isLikelyNewsSource({ title, summary, url: sourceUrl(item) }));
}

function commerciallyApproved(item) {
  return isPublic(item)
    && gameIdentityEligible(item)
    && ['approved', 'source-ru'].includes(String(item.editorialStatus || ''))
    && Number(item.editorialVersion) === NEWS_EDITORIAL_VERSION
    && item.editorialSourceHash === editorialSourceHash(item)
    && localizedPolicyEligible(item);
}

function paragraphize(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length < 250) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:[»”']?)/g) || [];
  if (sentences.length < 2) return text;
  return `${sentences[0].trim()}\n\n${sentences.slice(1).join(' ').trim()}`;
}

function nativeArticleBrief(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const sentences = text.match(/[^.!?]+[.!?]+(?:[»”']?)/g) || [];
  const selected = [];
  let length = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!hasCyrillic(sentence) || sentence.length < 35) continue;
    if (selected.length >= 3) break;
    if (selected.length >= 2 && length + sentence.length > 620) break;
    selected.push(sentence);
    length += sentence.length + 1;
  }
  return selected.length >= 2 ? selected.join(' ') : '';
}

function requiredEntitiesForItem(item, title, summary) {
  return sourceEntityCandidates({
    titleEn: title,
    summaryEn: summary,
    primaryUrl: sourceUrl(item),
    games: Array.isArray(item.games) ? item.games : []
  }).slice(0, 12);
}

function sourceKey(item) {
  const explicit = String(item?.primarySource || item?.source || '').trim().toLowerCase();
  if (explicit) return explicit;
  try { return new URL(sourceUrl(item)).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function prioritizeCommercialCandidates(values) {
  const sorted = [...values].sort((a, b) => publishedAt(b) - publishedAt(a));
  const priority = [];
  const reserve = [];
  const topicCounts = new Map();
  const sourceCounts = new Map();
  for (const item of sorted) {
    const topic = newsTopicKey(item);
    const source = sourceKey(item);
    const topicFull = topic && Number(topicCounts.get(topic) || 0) >= commercialPolicy.maxPerTopic;
    const sourceFull = source && Number(sourceCounts.get(source) || 0) >= commercialPolicy.maxPerSource;
    if (topicFull || sourceFull) {
      reserve.push(item);
      continue;
    }
    priority.push(item);
    if (topic) topicCounts.set(topic, Number(topicCounts.get(topic) || 0) + 1);
    if (source) sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  }
  return [...priority, ...reserve];
}

function approve(item, validation, model, status = 'approved') {
  item.titleRu = validation.titleRu;
  item.summaryRu = paragraphize(validation.briefRu);
  item.editorialBriefRu = item.summaryRu;
  if (!localizedPolicyEligible(item)) return false;
  item.editorialStatus = status;
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
  item.editorialModel = model;
  item.editorialGeneratedAt = new Date().toISOString();
  delete item.editorialReasons;
  delete item.editorialRejectedAt;
  return true;
}

function reject(item, reasons, failures, extra = {}) {
  setPublic(item, false);
  item.editorialStatus = 'rejected';
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
  item.editorialRejectedAt = new Date().toISOString();
  item.editorialReasons = reasons?.length ? reasons : ['commercial editorial validation failed'];
  failures.push({ id: item.id, url: sourceUrl(item), reasons: item.editorialReasons, ...extra });
}

async function mapLimit(values, concurrency, worker) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return results;
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);
const failures = [];
let nativeRussian = 0;
let nativeArticleSalvaged = 0;
let deterministicLocalized = 0;
let cached = 0;
let filteredNonNews = 0;
let nativeRejected = 0;
let qwenAttempted = 0;
let qwenApproved = 0;
let qwenRejected = 0;
let modelLoadMs = 0;

function currentCommercialSelection() {
  return selectCommercialHomeNews(
    items.filter(commerciallyApproved).sort((a, b) => publishedAt(b) - publishedAt(a)),
    commercialPolicy
  );
}

const nativeNeedsArticle = [];

// Pass 1: zero-model work only. Native Russian and upstream machine drafts still pass
// the production validator here, but every public item is checked again by the final
// semantic publication-quality gate before it can remain in the published snapshot.
for (const item of items) {
  if (!isPublic(item) || !gameIdentityEligible(item)) continue;
  const title = sourceTitle(item);
  const summary = sourceSummary(item);
  const url = sourceUrl(item);

  if (!isLikelyNewsSource({ title, summary, url })) {
    filteredNonNews += 1;
    setPublic(item, false);
    item.editorialStatus = 'filtered-non-news';
    item.editorialVersion = NEWS_EDITORIAL_VERSION;
    item.editorialSourceHash = editorialSourceHash(item);
    item.editorialReasons = ['content policy rejected non-news material'];
    continue;
  }

  if (hasValidEditorialCache(item) && localizedPolicyEligible(item)) {
    cached += 1;
    continue;
  }

  if (sourceIsRussian(item)) {
    const validation = validateProductionNews(
      { titleRu: title, briefRu: summary },
      { title, summary, url }
    );
    if (validation.ok && approve(item, validation, 'source-ru', 'source-ru')) {
      nativeRussian += 1;
    } else {
      nativeNeedsArticle.push(item);
      item.editorialStatus = 'source-ru-needs-edit';
      item.editorialVersion = NEWS_EDITORIAL_VERSION;
      item.editorialSourceHash = editorialSourceHash(item);
      item.editorialReasons = validation.reasons || [];
    }
    continue;
  }

  const translatedTitle = String(item.titleRu || '').trim();
  const translatedSummary = String(item.summaryRu || '').trim();
  if (translatedTitle && translatedSummary && hasCyrillic(translatedTitle) && hasCyrillic(translatedSummary)) {
    const validation = validateProductionNews(
      { titleRu: translatedTitle, briefRu: translatedSummary },
      { title, summary, url }
    );
    if (validation.ok && approve(item, validation, 'validated-upstream-local-translation', 'approved')) {
      deterministicLocalized += 1;
    }
  }
}

await mapLimit(nativeNeedsArticle, nativeConcurrency, async item => {
  const title = sourceTitle(item);
  const summary = sourceSummary(item);
  const url = sourceUrl(item);
  try {
    const articleText = await fetchArticleText(url, 6500, `${title} ${summary}`);
    const articleBrief = articleText && hasCyrillic(articleText) ? nativeArticleBrief(articleText) : '';
    const validation = articleBrief
      ? validateProductionNews({ titleRu: title, briefRu: articleBrief }, { title, summary, articleText, url })
      : { ok: false, reasons: ['native Russian source did not provide two complete publishable sentences'] };
    if (validation.ok && approve(item, validation, 'source-ru-article', 'source-ru')) {
      nativeArticleSalvaged += 1;
      console.log(`[news/editor] source-ru article salvage approved ${item.id}: ${item.titleRu}`);
      return;
    }
    nativeRejected += 1;
    reject(item, validation.reasons, failures);
  } catch (error) {
    nativeRejected += 1;
    reject(item, [error.message], failures);
  }
});

const selectionBeforeQwen = currentCommercialSelection();

// Optional bounded repair here remains an optimization. The mandatory final quality
// gate later checks every public event and may repair any remaining suspicious item.
if (qwenMaxItems > 0) {
  const qwenStart = Date.now();
  const candidates = prioritizeCommercialCandidates(items.filter(item => {
    if (!isPublic(item) || !gameIdentityEligible(item) || sourceIsRussian(item) || commerciallyApproved(item)) return false;
    return isLikelyNewsSource({ title: sourceTitle(item), summary: sourceSummary(item), url: sourceUrl(item) });
  }));

  for (const item of candidates) {
    if (qwenAttempted >= qwenMaxItems || Date.now() - qwenStart >= qwenBudgetMs) break;
    qwenAttempted += 1;
    const title = sourceTitle(item);
    const summary = sourceSummary(item);
    const url = sourceUrl(item);
    let articleText = '';
    let articleFetchError = '';
    try {
      articleText = await fetchArticleText(url, 5000, `${title} ${summary}`);
    } catch (error) {
      articleFetchError = error.message;
    }

    if (!modelLoadMs) {
      const warmup = await warmNewsEditor();
      modelLoadMs = warmup.elapsedMs;
      console.log(`[news/editor] fallback ${warmup.model} ready in ${(warmup.elapsedMs / 1000).toFixed(1)}s`);
    }

    try {
      const requiredEntities = requiredEntitiesForItem(item, title, summary);
      const edited = await editNewsToRussian({
        title,
        summary,
        articleText,
        url,
        source: item.primarySource || item.source || '',
        requiredEntities
      }, { maxAttempts: 1, maxNewTokens: 110 });
      const finalPolicyOk = edited.ok && isLikelyNewsSource({ title: edited.titleRu, summary: edited.briefRu, url });
      if (!finalPolicyOk) {
        qwenRejected += 1;
        reject(item, edited.ok ? ['localized copy failed final commercial content policy'] : edited.reasons, failures, { requiredEntities, articleFetchError });
        continue;
      }
      item.titleRu = edited.titleRu;
      item.summaryRu = paragraphize(edited.briefRu);
      item.editorialBriefRu = item.summaryRu;
      item.editorialStatus = 'approved';
      item.editorialVersion = NEWS_EDITORIAL_VERSION;
      item.editorialSourceHash = editorialSourceHash(item);
      item.editorialModel = edited.model;
      item.editorialDtype = edited.dtype;
      item.editorialGeneratedAt = new Date().toISOString();
      item.editorialAttempts = edited.attempts;
      item.editorialRequiredEntities = requiredEntities;
      delete item.editorialReasons;
      delete item.editorialRejectedAt;
      qwenApproved += 1;
      console.log(`[news/editor] fallback approved ${item.id} in ${(edited.elapsedMs / 1000).toFixed(1)}s: ${item.titleRu}`);
    } catch (error) {
      qwenRejected += 1;
      reject(item, [error.message], failures, { articleFetchError });
    }
  }
}

const commercialSelection = currentCommercialSelection();
const publicItems = items.filter(isPublic);
const publicApproved = publicItems.filter(commerciallyApproved).length;
const output = Array.isArray(payload) ? items : { ...payload, generatedAt: new Date().toISOString(), items };
await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(eventsPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 9,
  generatedAt: new Date().toISOString(),
  editorialVersion: NEWS_EDITORIAL_VERSION,
  architecture: 'volume-independent-deterministic-russian-first-bounded-qwen-pre-repair-plus-final-semantic-gate',
  model: process.env.NEWS_EDITOR_MODEL || 'onnx-community/Qwen3-4B-Instruct-2507-ONNX',
  dtype: process.env.NEWS_EDITOR_DTYPE || 'q4',
  homepageDisplayLimit: configuredHomepageDisplayLimit > 0 ? configuredHomepageDisplayLimit : null,
  homepageDisplayMode: configuredHomepageDisplayLimit > 0 ? 'configured-ui-cap' : 'all-eligible',
  commercialPolicy,
  commercialSelection: commercialSelection.diagnostics,
  selectionBeforeQwen: selectionBeforeQwen.diagnostics,
  editorElapsedMs: Date.now() - startedAt,
  modelLoadMs,
  qwenMaxItems,
  qwenBudgetMs,
  qwenAttempted,
  qwenApproved,
  qwenRejected,
  nativeConcurrency,
  nativeRussian,
  nativeArticleCandidates: nativeNeedsArticle.length,
  nativeArticleSalvaged,
  nativeRejected,
  deterministicLocalized,
  cached,
  filteredNonNews,
  publicItems: publicItems.length,
  publicApproved,
  failures
}, null, 2)}\n`, 'utf8');

console.log(`[news/editor] deterministic=${deterministicLocalized}; source-ru=${nativeRussian}; source-ru-article=${nativeArticleSalvaged}; qwen=${qwenApproved}/${qwenAttempted}; public-approved=${publicApproved}; homepage-view=${commercialSelection.items.length}; display_mode=${configuredHomepageDisplayLimit > 0 ? 'configured-cap' : 'all-eligible'}; elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
