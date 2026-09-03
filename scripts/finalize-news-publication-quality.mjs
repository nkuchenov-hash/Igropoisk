import fs from 'node:fs/promises';
import {
  fetchArticleText,
  validateProductionNews
} from './lib/news-editor-production.mjs';
import {
  NEWS_EDITORIAL_VERSION,
  editorialSourceHash
} from './lib/news-editor-policy.mjs';
import {
  decodeNewsSourceText,
  isMachineLocalizedDraft,
  publicationSemanticReasons,
  sourceEntityCandidates,
  sourceLooksTruncated
} from './lib/news-publication-quality.mjs';
import { repairNewsPublicationCopy } from './lib/news-publication-repair.mjs';

const eventsPath = 'data/news-events.json';
const reportPath = process.env.NEWS_PUBLICATION_QUALITY_REPORT || 'tmp/news-publication-quality-report.json';
const sourceFiles = ['data/news.json', 'data/publisher-news.json'];

function isPublic(item = {}) {
  return Boolean(item.publicEligible ?? item.globalEligible ?? item.regionalEligible);
}

function setPublic(item, value) {
  item.publicEligible = value;
  item.globalEligible = value;
  if (!value) {
    item.regionalEligible = false;
    item.mainEligible = false;
  }
}

function sourceTitle(item = {}) {
  return decodeNewsSourceText(item.titleEn || item.title || '');
}

function sourceSummary(item = {}) {
  return decodeNewsSourceText(item.summaryEn || item.summary || sourceTitle(item));
}

function sourceUrl(item = {}) {
  return String(item.primaryUrl || item.url || '').trim();
}

function productionInput(item = {}, articleText = '') {
  return {
    title: sourceTitle(item),
    summary: sourceSummary(item),
    articleText: decodeNewsSourceText(articleText),
    url: sourceUrl(item),
    primaryUrl: sourceUrl(item),
    games: Array.isArray(item.games) ? item.games : []
  };
}

function assess(item, titleRu, summaryRu, articleText = '', localizedNames = {}) {
  const input = productionInput(item, articleText);
  const validation = validateProductionNews(
    { titleRu, briefRu: summaryRu },
    input
  );
  const semanticReasons = publicationSemanticReasons(
    input,
    { titleRu: validation.titleRu, summaryRu: validation.briefRu },
    { localizedNames }
  );
  return {
    ok: validation.ok && semanticReasons.length === 0,
    titleRu: validation.titleRu,
    summaryRu: validation.briefRu,
    reasons: [...new Set([...(validation.reasons || []), ...semanticReasons])]
  };
}

function approve(item, result, model, repaired = false) {
  item.titleRu = result.titleRu;
  item.summaryRu = result.summaryRu;
  item.editorialBriefRu = result.summaryRu;
  item.editorialStatus = 'approved';
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
  item.editorialModel = model;
  item.editorialGeneratedAt = new Date().toISOString();
  item.publicationQualityStatus = repaired ? 'repaired-and-approved' : 'approved';
  item.publicationQualityCheckedAt = new Date().toISOString();
  delete item.publicationQualityReasons;
  delete item.editorialReasons;
  delete item.editorialRejectedAt;
  return item;
}

function reject(item, reasons) {
  setPublic(item, false);
  item.editorialStatus = 'rejected-publication-quality';
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
  item.editorialRejectedAt = new Date().toISOString();
  item.editorialReasons = reasons;
  item.publicationQualityStatus = 'rejected';
  item.publicationQualityCheckedAt = new Date().toISOString();
  item.publicationQualityReasons = reasons;
  return item;
}

async function readLocalizedNames() {
  try {
    const payload = JSON.parse(await fs.readFile('data/news-game-aliases.json', 'utf8'));
    return payload?.localizedNames || {};
  } catch {
    return {};
  }
}

function matchesRejected(item, rejectedIds, rejectedUrls) {
  const id = String(item?.id || '').trim();
  const url = sourceUrl(item);
  return Boolean((id && rejectedIds.has(id)) || (url && rejectedUrls.has(url)));
}

function rememberRejected(item, rejectedIds, rejectedUrls) {
  const id = String(item?.id || '').trim();
  const url = sourceUrl(item);
  if (id) rejectedIds.add(id);
  if (url) rejectedUrls.add(url);
}

async function rewriteSourceFile(path, rejectedIds, rejectedUrls) {
  try {
    const payload = JSON.parse(await fs.readFile(path, 'utf8'));
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    const kept = items.filter(item => !matchesRejected(item, rejectedIds, rejectedUrls));
    const removed = items.length - kept.length;
    if (!removed) return 0;
    if (Array.isArray(payload)) {
      await fs.writeFile(path, `${JSON.stringify(kept, null, 2)}\n`);
    } else {
      await fs.writeFile(path, `${JSON.stringify({
        ...payload,
        publicationQualityFilteredAt: new Date().toISOString(),
        publicationQualityRejectedCount: Number(payload.publicationQualityRejectedCount || 0) + removed,
        items: kept
      }, null, 2)}\n`);
    }
    return removed;
  } catch (error) {
    console.warn(`[news/publication-quality] could not filter ${path}: ${error.message}`);
    return 0;
  }
}

const payload = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
const items = Array.isArray(payload) ? payload : (payload.items || []);
const localizedNames = await readLocalizedNames();
const rejectedIds = new Set();
const rejectedUrls = new Set();
const failures = [];
let checked = 0;
let machineDraftsChecked = 0;
let passedWithoutRepair = 0;
let reassessedWithArticle = 0;
let repairAttempted = 0;
let repaired = 0;
let rejected = 0;

for (const item of items) {
  if (!isPublic(item)) continue;
  checked += 1;
  const machineDraft = isMachineLocalizedDraft(item);
  if (machineDraft) machineDraftsChecked += 1;

  const currentTitleRu = String(item.titleRu || '').trim();
  const currentSummaryRu = String(item.summaryRu || item.editorialBriefRu || '').trim();
  const initial = assess(item, currentTitleRu, currentSummaryRu, '', localizedNames);
  const sourceSnippetTruncated = sourceLooksTruncated(productionInput(item));

  if (initial.ok && !sourceSnippetTruncated) {
    approve(
      item,
      initial,
      machineDraft ? 'validated-machine-draft-publication-gate' : String(item.editorialModel || 'publication-quality-gate'),
      false
    );
    passedWithoutRepair += 1;
    continue;
  }

  let articleText = '';
  let articleFetchError = '';
  try {
    articleText = await fetchArticleText(sourceUrl(item), 9000, `${sourceTitle(item)} ${sourceSummary(item)}`);
  } catch (error) {
    articleFetchError = error.message;
  }

  reassessedWithArticle += 1;
  const enriched = assess(item, currentTitleRu, currentSummaryRu, articleText, localizedNames);
  if (enriched.ok) {
    approve(
      item,
      enriched,
      machineDraft ? 'validated-machine-draft-with-source-publication-gate' : String(item.editorialModel || 'publication-quality-source-gate'),
      false
    );
    passedWithoutRepair += 1;
    continue;
  }

  repairAttempted += 1;
  const requiredEntities = sourceEntityCandidates(productionInput(item, articleText));
  const repair = await repairNewsPublicationCopy({
    title: sourceTitle(item),
    summary: sourceSummary(item),
    articleText,
    url: sourceUrl(item),
    source: item.primarySource || item.source || '',
    currentTitleRu,
    currentSummaryRu,
    failureReasons: enriched.reasons,
    requiredEntities
  });

  if (repair.ok) {
    const repairedResult = assess(item, repair.titleRu, repair.summaryRu, articleText, localizedNames);
    if (repairedResult.ok) {
      approve(item, repairedResult, repair.model || 'github-models-publication-repair', true);
      item.editorialRequiredEntities = requiredEntities;
      repaired += 1;
      console.log(`[news/publication-quality] repaired ${item.id}: ${item.titleRu}`);
      continue;
    }
    repair.reasons = repairedResult.reasons;
  }

  const reasons = [...new Set([
    ...enriched.reasons,
    ...(repair.reasons || []),
    ...(repair.reason ? [repair.reason] : []),
    ...(articleFetchError ? [`article fetch: ${articleFetchError}`] : [])
  ])];
  reject(item, reasons.length ? reasons : ['final semantic/editorial validation failed']);
  rememberRejected(item, rejectedIds, rejectedUrls);
  failures.push({ id: item.id, url: sourceUrl(item), reasons: item.publicationQualityReasons });
  rejected += 1;
}

const keptItems = items.filter(item => !matchesRejected(item, rejectedIds, rejectedUrls));
const nextPayload = Array.isArray(payload)
  ? keptItems
  : {
      ...payload,
      publicationQuality: {
        checked,
        machineDraftsChecked,
        passedWithoutRepair,
        reassessedWithArticle,
        repairAttempted,
        repaired,
        rejected,
        policy: 'per-item-fail-open-no-fixed-count'
      },
      items: keptItems
    };
await fs.writeFile(eventsPath, `${JSON.stringify(nextPayload, null, 2)}\n`);

let filteredRawItems = 0;
for (const path of sourceFiles) filteredRawItems += await rewriteSourceFile(path, rejectedIds, rejectedUrls);

await fs.mkdir('tmp', { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  policy: 'Every public event is checked. Existing copy is revalidated against available article text, then suspicious items are repaired with GitHub Models; only an item that still fails is excluded.',
  fixedPublicationCount: null,
  checked,
  machineDraftsChecked,
  passedWithoutRepair,
  reassessedWithArticle,
  repairAttempted,
  repaired,
  rejected,
  filteredRawItems,
  failures
}, null, 2)}\n`);

console.log(`[news/publication-quality] checked=${checked}; machine_drafts=${machineDraftsChecked}; passed=${passedWithoutRepair}; source_reassessed=${reassessedWithArticle}; repair_attempted=${repairAttempted}; repaired=${repaired}; rejected=${rejected}; raw_filtered=${filteredRawItems}`);
