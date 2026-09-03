import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isLikelyNewsContent, newsContentRejectionReasons } from './lib/news-content-policy.mjs';
import { refineNewsPrimaryGame } from './lib/news-primary-game-refiner.mjs';
import { cleanResolvedNewsGame } from './lib/news-game-title-cleanup.mjs';
import { translatePreservingGameEntities } from './lib/news-game-translation-guard.mjs';

const file = 'data/news.json';
const userAgent = 'IgropoiskNewsLocalizer/2.0 (+https://github.com/nkuchenov-hash/Igropoisk)';
const localModel = process.env.NEWS_LOCAL_TRANSLATION_MODEL || 'Xenova/opus-mt-en-ru';
const localCacheDir = process.env.NEWS_LOCAL_TRANSLATION_CACHE || '/tmp/igropoisk-news-translation-models';
const localRuntimeDir = process.env.NEWS_LOCAL_TRANSLATION_RUNTIME || '/tmp/igropoisk-news-translator-runtime';
let googleUnavailable = false;
let memoryUnavailable = false;
let localTranslatorPromise = null;
let localTranslatorUnavailable = false;
let localizedGameNames = {};
try {
  const rules = JSON.parse(await fs.readFile('data/news-game-aliases.json', 'utf8'));
  localizedGameNames = rules?.localizedNames || {};
} catch {}

async function fetchText(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': userAgent } });
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function translatedText(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return String(first?.translation_text || first?.generated_text || '').trim();
}

async function loadTransformersRuntime() {
  try {
    return await import('@huggingface/transformers');
  } catch {
    const requireFromRuntime = createRequire(`${localRuntimeDir}/package.json`);
    const modulePath = requireFromRuntime.resolve('@huggingface/transformers');
    return import(pathToFileURL(modulePath).href);
  }
}

async function getLocalTranslator() {
  if (localTranslatorUnavailable) return null;
  if (!localTranslatorPromise) {
    localTranslatorPromise = (async () => {
      const { env, pipeline } = await loadTransformersRuntime();
      env.cacheDir = localCacheDir;
      env.allowLocalModels = true;
      env.useFSCache = true;
      return pipeline('translation', localModel, { dtype: 'q8' });
    })().catch(error => {
      localTranslatorUnavailable = true;
      console.error(`[industry/localize/local] unavailable: ${error.message}`);
      return null;
    });
  }
  return localTranslatorPromise;
}

async function translateLocalEnRu(text) {
  if (!text) return '';
  const translator = await getLocalTranslator();
  if (!translator) return '';
  try {
    return translatedText(await translator(text));
  } catch (error) {
    console.error(`[industry/localize/local] ${error.message}`);
    return '';
  }
}

async function translateGoogle(text, target) {
  if (!text || googleUnavailable) return '';
  try {
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const payload = JSON.parse(await fetchText(endpoint));
    return (payload?.[0] || []).map(part => part?.[0] || '').join('').trim();
  } catch (error) {
    if ([403, 429].includes(Number(error.status))) googleUnavailable = true;
    console.error(`[industry/localize/google] ${error.message}`);
    return '';
  }
}

async function translateMyMemory(text, source, target) {
  if (!text || memoryUnavailable || !['en', 'ru'].includes(source) || source === target) return '';
  try {
    const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}%7C${target}`;
    const payload = JSON.parse(await fetchText(endpoint));
    const translated = String(payload?.responseData?.translatedText || '').trim();
    const status = Number(payload?.responseStatus || 200);
    if (status >= 400) {
      const error = new Error(`MyMemory ${status}`);
      error.status = status;
      throw error;
    }
    return translated;
  } catch (error) {
    if ([403, 429].includes(Number(error.status))) memoryUnavailable = true;
    console.error(`[industry/localize/mymemory] ${error.message}`);
    return '';
  }
}

async function translateEnRu(text, protectedGameEntities = []) {
  if (!text) return { text: '', provider: 'none' };
  const translateProtected = provider => translatePreservingGameEntities(
    text,
    protectedGameEntities,
    provider,
    { localizedNames: localizedGameNames }
  );

  const local = await translateProtected(translateLocalEnRu);
  if (local) return { text: local, provider: 'local-opus' };

  const google = await translateProtected(value => translateGoogle(value, 'ru'));
  if (google) return { text: google, provider: 'google-fallback' };

  const memory = await translateProtected(value => translateMyMemory(value, 'en', 'ru'));
  if (memory) return { text: memory, provider: 'mymemory-fallback' };

  return { text: '', provider: 'unavailable' };
}

const payload = JSON.parse(await fs.readFile(file, 'utf8'));
const now = Date.now();
const processed = [];
let localTranslatedItems = 0;
let remoteTranslatedItems = 0;
let sourceRussianItems = 0;
let filteredNonNewsItems = 0;

for (const item of payload.items || []) {
  try {
    if (!isLikelyNewsContent({ title: item.title, summary: item.summary, url: item.url })) {
      filteredNonNewsItems += 1;
      console.log(`[industry/filter] ${item.source || 'source'}: ${item.title} -> ${newsContentRejectionReasons({ title: item.title, summary: item.summary, url: item.url }).join('; ')}`);
      continue;
    }

    const sourceIsRussian = item.language === 'ru' || /[А-Яа-яЁё]/.test(item.title || '');
    const baseSummary = item.summary || item.title || '';
    const sourceGame = sourceIsRussian ? null : cleanResolvedNewsGame(refineNewsPrimaryGame({
      titleEn: item.title || '',
      summaryEn: baseSummary,
      primaryUrl: item.url || '',
      publicEligible: true,
      games: []
    }, null));
    const protectedGameEntities = sourceGame?.title ? [sourceGame.title] : [];

    let titleRu;
    let summaryRu;
    let localizationStatus;

    if (sourceIsRussian) {
      titleRu = item.title || '';
      summaryRu = baseSummary;
      localizationStatus = 'source-ru';
      sourceRussianItems += 1;
    } else {
      const titleTranslation = await translateEnRu(item.title || '', protectedGameEntities);
      const summaryTranslation = await translateEnRu(baseSummary, protectedGameEntities);
      titleRu = titleTranslation.text;
      summaryRu = summaryTranslation.text || titleRu;
      localizationStatus = titleTranslation.provider;
      if (!titleRu || !/[А-Яа-яЁё]/.test(titleRu)) {
        throw new Error('Russian translation unavailable; refusing English fallback on Russian site');
      }
      if (titleTranslation.provider === 'local-opus') localTranslatedItems += 1;
      else remoteTranslatedItems += 1;
    }

    const titleEn = item.title || titleRu;
    const summaryEn = baseSummary || titleEn;
    if (!titleRu || !titleEn) throw new Error('usable bilingual metadata unavailable');

    const sourceCount = Number(item.sourceCount || item.mediaSourceCount || 1);
    const discussionMentions = Number(item.discussionMentions || 0);
    const trendScore = Number(item.trendScore || 0);
    const regions = Array.isArray(item.regions) ? [...new Set(item.regions.filter(Boolean))] : [];
    const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 36e5);

    const globalEligible = true;
    const regionalEligible = Boolean(item.regionalEligible) && regions.length > 0;
    const globalScore = Math.round(150 + trendScore + sourceCount * 90 + discussionMentions * 35);
    const regionalScore = regionalEligible ? Math.round(170 + trendScore * 0.45 + sourceCount * 35) : 0;
    const superImportant = sourceCount >= 6 || discussionMentions >= 7 || trendScore >= 700;
    const homeHours = superImportant ? 168 : 72;
    const mainEligible = ageHours <= (superImportant ? 168 : 96);

    processed.push({
      ...item,
      type: 'industry',
      official: false,
      titleRu,
      titleEn,
      summaryRu,
      summaryEn,
      localizationStatus,
      regions,
      globalEligible,
      regionalEligible,
      globalScore,
      regionalScore,
      mainEligible,
      superImportant,
      selectionReason: 'ranked-global-news',
      homeUntil: new Date(new Date(item.publishedAt).getTime() + homeHours * 3600e3).toISOString()
    });
  } catch (error) {
    console.error(`[industry/localize] ${item.url}: ${error.message}`);
  }
}

if (processed.length < Math.min(12, (payload.items || []).length)) {
  throw new Error(`Only ${processed.length} policy-compliant Russian-ready items produced; refusing to publish an undersized feed`);
}

await fs.writeFile(file, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  updateFrequency: 'daily',
  evaluationWindow: '24-72 hours',
  rankingModel: 'Ranked global gaming news after commercial content-policy filtering',
  globalMinimumIndependentSources: 1,
  localizedItemCount: processed.length,
  localTranslatedItemCount: localTranslatedItems,
  remoteTranslatedItemCount: remoteTranslatedItems,
  sourceRussianItemCount: sourceRussianItems,
  filteredNonNewsItemCount: filteredNonNewsItems,
  localTranslationModel: localModel,
  items: processed
}, null, 2)}\n`);

console.log(`[industry/localize] wrote ${processed.length} policy-compliant Russian-ready items; filtered=${filteredNonNewsItems}; local=${localTranslatedItems}; remote=${remoteTranslatedItems}; source-ru=${sourceRussianItems}`);
