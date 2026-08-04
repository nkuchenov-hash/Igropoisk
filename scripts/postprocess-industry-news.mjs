import fs from 'node:fs/promises';

const file = 'data/news.json';
const userAgent = 'IgropoiskNewsLocalizer/1.2 (+https://github.com/nkuchenov-hash/Igropoisk)';

async function fetchText(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': userAgent } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally { clearTimeout(timer); }
}

async function translate(text, target, attempts = 3) {
  if (!text) return '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
      const payload = JSON.parse(await fetchText(endpoint));
      const translated = (payload?.[0] || []).map(part => part?.[0] || '').join('').trim();
      if (translated) return translated;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  return '';
}

const payload = JSON.parse(await fs.readFile(file, 'utf8'));
const now = Date.now();
const processed = [];

for (const item of payload.items || []) {
  try {
    const sourceIsRussian = item.language === 'ru' || /[А-Яа-яЁё]/.test(item.title || '');
    const titleRu = sourceIsRussian ? item.title : await translate(item.title, 'ru');
    const summaryRu = sourceIsRussian ? (item.summary || item.title) : await translate(item.summary || item.title, 'ru');
    const titleEn = sourceIsRussian ? await translate(item.title, 'en') : item.title;
    const summaryEn = sourceIsRussian ? await translate(item.summary || item.title, 'en') : (item.summary || item.title);
    if (!titleRu || !/[А-Яа-яЁё]/.test(titleRu) || !titleEn) throw new Error('complete bilingual translation unavailable');

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
  throw new Error(`Only ${processed.length} localized items produced; refusing to publish an undersized Russian feed`);
}

await fs.writeFile(file, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  updateFrequency: 'daily',
  evaluationWindow: '24-72 hours',
  rankingModel: 'Global significance plus additive user-region relevance',
  globalMinimumIndependentSources: 3,
  localizedItemCount: processed.length,
  items: processed
}, null, 2)}\n`);
console.log(`[industry/localize] wrote ${processed.length} bilingual globally and regionally ranked items`);
