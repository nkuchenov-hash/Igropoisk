import fs from 'node:fs/promises';

const file = 'data/news.json';
const userAgent = 'IgropoiskNewsLocalizer/1.3 (+https://github.com/nkuchenov-hash/Igropoisk)';
let googleUnavailable = false;
let memoryUnavailable = false;

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
  } finally { clearTimeout(timer); }
}

async function translateGoogle(text, target) {
  if (googleUnavailable) return '';
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
  if (memoryUnavailable || !['en', 'ru'].includes(source) || source === target) return '';
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

async function translate(text, source, target) {
  if (!text || source === target) return text || '';
  return await translateGoogle(text, target) || await translateMyMemory(text, source, target) || '';
}

const payload = JSON.parse(await fs.readFile(file, 'utf8'));
const now = Date.now();
const processed = [];
let translatedItems = 0;
let sourceLanguageFallbackItems = 0;

for (const item of payload.items || []) {
  try {
    const sourceIsRussian = item.language === 'ru' || /[А-Яа-яЁё]/.test(item.title || '');
    const sourceLanguage = sourceIsRussian ? 'ru' : 'en';
    const baseSummary = item.summary || item.title || '';
    const translatedTitleRu = sourceIsRussian ? item.title : await translate(item.title, sourceLanguage, 'ru');
    const translatedSummaryRu = sourceIsRussian ? baseSummary : await translate(baseSummary, sourceLanguage, 'ru');
    const titleRu = translatedTitleRu || item.title || '';
    const summaryRu = translatedSummaryRu || baseSummary || titleRu;
    const titleEn = sourceIsRussian ? (await translate(item.title, 'ru', 'en') || item.title) : item.title;
    const summaryEn = sourceIsRussian ? (await translate(baseSummary, 'ru', 'en') || baseSummary) : baseSummary;
    if (!titleRu || !titleEn) throw new Error('usable localized/source-language title unavailable');

    const localizationStatus = sourceIsRussian
      ? 'source-ru'
      : /[А-Яа-яЁё]/.test(translatedTitleRu || '')
        ? 'translated-ru'
        : 'source-language-fallback';
    if (localizationStatus === 'translated-ru') translatedItems += 1;
    if (localizationStatus === 'source-language-fallback') sourceLanguageFallbackItems += 1;

    const sourceCount = Number(item.sourceCount || item.mediaSourceCount || 1);
    const discussionMentions = Number(item.discussionMentions || 0);
    const trendScore = Number(item.trendScore || 0);
    const regions = Array.isArray(item.regions) ? [...new Set(item.regions.filter(Boolean))] : [];
    const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 36e5);

    // A global event needs several independent confirmations. Two publications alone are not enough.
    const globalEligible = Boolean(item.globalEligible)
      || sourceCount >= 3
      || discussionMentions >= 3
      || trendScore >= 450;
    const regionalEligible = Boolean(item.regionalEligible) && regions.length > 0;
    const globalScore = globalEligible ? Math.round(trendScore + sourceCount * 90 + discussionMentions * 35) : 0;
    const regionalScore = regionalEligible ? Math.round(170 + trendScore * 0.45 + sourceCount * 35) : 0;
    const superImportant = sourceCount >= 6 || discussionMentions >= 7 || trendScore >= 700;
    const homeHours = superImportant ? 168 : globalEligible ? 72 : regionalEligible ? 48 : 0;
    const mainEligible = (globalEligible || regionalEligible) && ageHours <= (superImportant ? 168 : 96);

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
      homeUntil: homeHours ? new Date(new Date(item.publishedAt).getTime() + homeHours * 3600e3).toISOString() : null
    });
  } catch (error) {
    console.error(`[industry/localize] ${item.url}: ${error.message}`);
  }
}

if (processed.length < Math.min(12, (payload.items || []).length)) {
  throw new Error(`Only ${processed.length} usable items produced; refusing to publish an undersized feed`);
}

await fs.writeFile(file, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  updateFrequency: 'daily',
  evaluationWindow: '24-72 hours',
  rankingModel: 'Global significance plus additive user-region relevance',
  globalMinimumIndependentSources: 3,
  localizedItemCount: processed.length - sourceLanguageFallbackItems,
  translatedItemCount: translatedItems,
  sourceLanguageFallbackItemCount: sourceLanguageFallbackItems,
  items: processed
}, null, 2)}\n`);
console.log(`[industry/localize] wrote ${processed.length} usable ranked items; translated=${translatedItems}; source-language-fallback=${sourceLanguageFallbackItems}`);
