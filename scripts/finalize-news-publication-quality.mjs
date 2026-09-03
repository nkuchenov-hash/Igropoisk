import fs from 'node:fs/promises';
import { validateProductionNews } from './lib/news-editor-production.mjs';
import {
  NEWS_EDITORIAL_VERSION,
  editorialSourceHash
} from './lib/news-editor-policy.mjs';
import {
  decodeNewsSourceText,
  isMachineLocalizedDraft,
  publicationSemanticReasons
} from './lib/news-publication-quality.mjs';

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

function productionInput(item = {}) {
  return {
    title: sourceTitle(item),
    summary: sourceSummary(item),
    url: sourceUrl(item),
    primaryUrl: sourceUrl(item),
    games: Array.isArray(item.games) ? item.games : []
  };
}

function softValidationReason(reason = '') {
  return /^title length \d+$/i.test(reason)
    || /^brief length \d+$/i.test(reason)
    || reason === 'brief has fewer than 2 complete sentences'
    || reason === 'lead repeats headline'
    || /^unsupported number:/i.test(reason)
    || /^source entity missing:/i.test(reason);
}

function salvageCompleteBrief(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || /[.!?…»”)]$/.test(text)) return { text, salvaged: false };
  let lastEnd = -1;
  for (const match of text.matchAll(/[.!?](?:[»”)]?)(?=\s|$)/g)) lastEnd = (match.index || 0) + match[0].length;
  if (lastEnd >= 80) return { text: text.slice(0, lastEnd).trim(), salvaged: true };
  return { text, salvaged: false };
}

function assess(item, titleRu, summaryRu, localizedNames = {}) {
  const input = productionInput(item);
  const validation = validateProductionNews({ titleRu, briefRu: summaryRu }, input);
  const validationReasons = (validation.reasons || []).filter(reason => !softValidationReason(reason));
  const semanticReasons = publicationSemanticReasons(
    input,
    { titleRu: validation.titleRu, summaryRu: validation.briefRu },
    { localizedNames }
  );
  const reasons = [...new Set([...validationReasons, ...semanticReasons])];
  return {
    ok: reasons.length === 0,
    titleRu: validation.titleRu,
    summaryRu: validation.briefRu,
    reasons
  };
}

function approve(item, result, model, tailSalvaged = false) {
  item.titleRu = result.titleRu;
  item.summaryRu = result.summaryRu;
  item.editorialBriefRu = result.summaryRu;
  item.editorialStatus = 'approved';
  item.editorialVersion = NEWS_EDITORIAL_VERSION;
  item.editorialSourceHash = editorialSourceHash(item);
  item.editorialModel = model;
  item.editorialGeneratedAt = new Date().toISOString();
  item.publicationQualityStatus = tailSalvaged ? 'approved-after-tail-salvage' : 'approved';
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
let passed = 0;
let tailSalvaged = 0;
let rejected = 0;

for (const item of items) {
  if (!isPublic(item)) continue;
  checked += 1;
  const machineDraft = isMachineLocalizedDraft(item);
  if (machineDraft) machineDraftsChecked += 1;

  const currentTitleRu = String(item.titleRu || '').trim();
  const brief = salvageCompleteBrief(String(item.summaryRu || item.editorialBriefRu || '').trim());
  const result = assess(item, currentTitleRu, brief.text, localizedNames);

  if (result.ok) {
    approve(
      item,
      result,
      machineDraft ? 'validated-machine-draft-publication-gate' : String(item.editorialModel || 'publication-quality-gate'),
      brief.salvaged
    );
    passed += 1;
    if (brief.salvaged) tailSalvaged += 1;
    continue;
  }

  reject(item, result.reasons);
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
        passed,
        tailSalvaged,
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
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  policy: 'Every public event is checked deterministically. Concise complete copy is allowed; an incomplete trailing fragment may be trimmed to the last complete sentence. Semantic corruption, machine artifacts, broken entities, untranslated clauses and genuinely incomplete copy are excluded per item. No fixed publication count and no external AI dependency.',
  fixedPublicationCount: null,
  checked,
  machineDraftsChecked,
  passed,
  tailSalvaged,
  rejected,
  filteredRawItems,
  failures
}, null, 2)}\n`);

console.log(`[news/publication-quality] checked=${checked}; machine_drafts=${machineDraftsChecked}; passed=${passed}; tail_salvaged=${tailSalvaged}; rejected=${rejected}; raw_filtered=${filteredRawItems}`);
