import fs from 'node:fs/promises';
import { editNewsToRussian, fetchArticleText, isLikelyNewsSource, validateProductionNews, warmNewsEditor } from './lib/news-editor-production.mjs';
import { newsTopicKey, selectCommercialHomeNews } from './lib/news-home-selector.mjs';
import { NEWS_EDITORIAL_VERSION, editorialSourceHash, hasCyrillic, hasValidEditorialCache } from './lib/news-editor-policy.mjs';

const eventsPath = 'data/news-events.json';
const reportPath = process.env.NEWS_EDITOR_REPORT || 'tmp/news-editor-report.json';
const minimumPublicItems = Math.max(12, Number(process.env.NEWS_EDITOR_MIN_PUBLIC || 12));
const maxItems = Math.max(minimumPublicItems + 18, Number(process.env.NEWS_EDITOR_MAX_ITEMS || minimumPublicItems + 18));
const commercialPolicy = Object.freeze({
  limit: minimumPublicItems,
  maxAgeHours: 168,
  recentHours: 72,
  minRecent: Math.min(minimumPublicItems, 8),
  maxPerTopic: 2,
  maxPerSource: 3
});

function isPublic(item) {
  return Boolean(item?.publicEligible ?? item?.globalEligible ?? item?.regionalEligible);
}

function setPublic(item, value) {
  item.publicEligible = value;
  item.globalEligible = value;
  if (!value) item.regionalEligible = false;
}

function sourceIsRussian(item) {
  const originalTitle = String(item.titleEn || item.title || '');
  const originalSummary = String(item.summaryEn || item.summary || '');
  return hasCyrillic(originalTitle) && (!originalSummary || hasCyrillic(originalSummary));
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
  if (selected.length < 2) return '';
  return selected.join(' ');
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

function displayGameEntity(game = {}) {
  const raw = String(game.title || game.slug || '').trim();
  if (!raw) return '';
  if (!raw.includes('-')) return raw;
  return raw.split('-').filter(Boolean).map(part => {
    if (/^(?:gta|rpg|vr|pc)$/i.test(part)) return part.toUpperCase();
    if (/^[ivx]+$/i.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function requiredEntitiesForItem(item, title, summary) {
  const source = `${title} ${summary}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  return [...new Set((Array.isArray(item.games) ? item.games : [])
    .map(displayGameEntity)
    .filter(Boolean)
    .filter(entity => {
      const needle = entity.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      return needle.length >= 4 && source.includes(needle);
    }))].slice(0, 4);
}

function sourceKey(item) {
  const explicit = String(item?.primarySource || item?.source || '').trim().toLowerCase();
  if (explicit) return explicit;
  try { return new URL(item?.primaryUrl || item?.url || '').hostname.toLowerCase().replace(/^www\./, ''); }
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

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);

let nativeRussian = 0;
let nativeArticleSalvaged = 0;
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
  return nativeApprovedItems.has(item) || hasValidEditorialCache(item);
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
  if (!isLikelyNewsSource({ title, summary, url })) {
    filteredNonNews += 1;
    setPublic(item, false);
    item.editorialStatus = 'filtered-non-news';
    item.editorialVersion = NEWS_EDITORIAL_VERSION;
    item.editorialSourceHash = editorialSourceHash(item);
    item.editorialReasons = ['content policy rejected non-news material'];
    continue;
  }

  if (hasValidEditorialCache(item)) {
    cached += 1;
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
      item.editorialVersion = NEWS_EDITORIAL_VERSION;
      item.editorialSourceHash = editorialSourceHash(item);
      delete item.editorialReasons;
      nativeApprovedItems.add(item);
      nativeRussian += 1;
    } else {
      item.editorialStatus = 'source-ru-needs-edit';
      item.editorialVersion = NEWS_EDITORIAL_VERSION;
      item.editorialSourceHash = editorialSourceHash(item);
      item.editorialReasons = nativeValidation.reasons;
    }
  }
}

const candidates = prioritizeCommercialCandidates(
  items.filter(item => isPublic(item) && !nativeApprovedItems.has(item) && !hasValidEditorialCache(item))
);

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

  if (sourceIsRussian(item)) {
    if (articleText && hasCyrillic(articleText)) {
      const articleBrief = nativeArticleBrief(articleText);
      if (articleBrief) {
        const nativeValidation = validateProductionNews(
          { titleRu: title, briefRu: articleBrief },
          { title, summary, articleText, url }
        );
        if (nativeValidation.ok) {
          item.titleRu = nativeValidation.titleRu;
          item.summaryRu = paragraphize(nativeValidation.briefRu);
          item.editorialBriefRu = item.summaryRu;
          item.editorialStatus = 'source-ru';
          item.editorialVersion = NEWS_EDITORIAL_VERSION;
          item.editorialSourceHash = editorialSourceHash(item);
          item.editorialGeneratedAt = new Date().toISOString();
          item.editorialModel = 'source-ru-article';
          delete item.editorialReasons;
          nativeApprovedItems.add(item);
          nativeArticleSalvaged += 1;
          console.log(`[news/editor] source-ru article salvage approved ${item.id}: ${item.titleRu}`);
          continue;
        }
      }
    }

    rejected += 1;
    setPublic(item, false);
    item.editorialStatus = 'rejected';
    item.editorialVersion = NEWS_EDITORIAL_VERSION;
    item.editorialSourceHash = editorialSourceHash(item);
    item.editorialRejectedAt = new Date().toISOString();
    item.editorialReasons = ['native Russian source did not provide two complete publishable sentences'];
    failures.push({ id: item.id, url, reasons: item.editorialReasons, articleFetchError });
    console.error(`[news/editor] rejected native Russian source without Qwen ${title}`);
    continue;
  }

  if (!modelLoadMs) {
    const warmup = await warmNewsEditor();
    modelLoadMs = warmup.elapsedMs;
    console.log(`[news/editor] ${warmup.model} ready in ${(warmup.elapsedMs / 1000).toFixed(1)}s`);
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
    }, { maxAttempts: 2, maxNewTokens: 130 });

    if (!edited.ok) {
      rejected += 1;
      setPublic(item, false);
      item.editorialStatus = 'rejected';
      item.editorialVersion = NEWS_EDITORIAL_VERSION;
      item.editorialSourceHash = editorialSourceHash(item);
      item.editorialRejectedAt = new Date().toISOString();
      item.editorialReasons = edited.reasons;
      failures.push({ id: item.id, url, reasons: edited.reasons, requiredEntities, articleFetchError });
      console.error(`[news/editor] rejected ${title}: ${edited.reasons.join('; ')}`);
      continue;
    }

    const briefRu = paragraphize(edited.briefRu);
    item.titleRu = edited.titleRu;
    item.summaryRu = briefRu;
    item.editorialBriefRu = briefRu;
    item.editorialStatus = 'approved';
    item.editorialVersion = NEWS_EDITORIAL_VERSION;
    item.editorialSourceHash = editorialSourceHash(item);
    item.editorialModel = edited.model;
    item.editorialDtype = edited.dtype;
    item.editorialGeneratedAt = new Date().toISOString();
    item.editorialAttempts = edited.attempts;
    item.editorialProductionSalvaged = Boolean(edited.productionSalvaged);
    item.editorialRequiredEntities = requiredEntities;
    delete item.editorialReasons;
    delete item.editorialRejectedAt;
    approved += 1;
    console.log(`[news/editor] approved ${item.id} in ${(edited.elapsedMs / 1000).toFixed(1)}s (${edited.attempts} attempt${edited.attempts === 1 ? '' : 's'}): ${item.titleRu}`);
  } catch (error) {
    rejected += 1;
    setPublic(item, false);
    item.editorialStatus = 'rejected';
    item.editorialVersion = NEWS_EDITORIAL_VERSION;
    item.editorialSourceHash = editorialSourceHash(item);
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
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
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
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  editorialVersion: NEWS_EDITORIAL_VERSION,
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
  nativeArticleSalvaged,
  rejected,
  filteredNonNews,
  pending,
  publicItems: publicItems.length,
  publicApproved,
  failures
}, null, 2)}\n`, 'utf8');

console.log(`[news/editor] public=${publicItems.length}; approved-now=${approved}; cached=${cached}; source-ru=${nativeRussian}; source-ru-article=${nativeArticleSalvaged}; rejected=${rejected}; filtered-non-news=${filteredNonNews}; pending=${pending}; commercial=${commercialSelection.ok}`);
if (!commercialSelection.ok) {
  throw new Error(`Commercial homepage mix unavailable after ${attempted} editorial attempts: ${JSON.stringify(commercialSelection.diagnostics)}. Live publication must keep the previous snapshot.`);
}
