import fs from 'node:fs/promises';

const file = 'data/news.json';
const userAgent = 'IgropoiskNewsLocalizer/1.0 (+https://github.com/nkuchenov-hash/Igropoisk)';

async function fetchText(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': userAgent } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally { clearTimeout(timer); }
}

async function translate(text, target) {
  if (!text) return '';
  const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
  const payload = JSON.parse(await fetchText(endpoint));
  return (payload?.[0] || []).map(part => part?.[0] || '').join('').trim();
}

const payload = JSON.parse(await fs.readFile(file, 'utf8'));
const now = Date.now();
const processed = [];

for (const item of payload.items || []) {
  try {
    const [titleRu, titleEn, summaryRu, summaryEn] = await Promise.all([
      translate(item.title, 'ru'),
      translate(item.title, 'en'),
      translate(item.summary || item.title, 'ru'),
      translate(item.summary || item.title, 'en')
    ]);
    if (!titleRu || !titleEn) throw new Error('translation unavailable');
    const sourceCount = Number(item.sourceCount || 1);
    const discussionMentions = Number(item.discussionMentions || 0);
    const trendScore = Number(item.trendScore || 0);
    const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 36e5);
    const superImportant = sourceCount >= 5 || discussionMentions >= 5 || trendScore >= 600;
    const homeHours = superImportant ? 168 : sourceCount >= 2 || discussionMentions >= 1 ? 72 : 48;
    const mainEligible = ageHours >= 24
      ? sourceCount >= 2 || discussionMentions >= 1 || trendScore >= 180
      : sourceCount >= 3 || discussionMentions >= 2 || trendScore >= 300;
    processed.push({
      ...item,
      type: 'industry',
      official: false,
      titleRu,
      titleEn,
      summaryRu,
      summaryEn,
      mainEligible,
      superImportant,
      homeUntil: new Date(new Date(item.publishedAt).getTime() + homeHours * 3600e3).toISOString()
    });
  } catch (error) {
    console.error(`[industry/localize] ${item.url}: ${error.message}`);
  }
}

await fs.writeFile(file, `${JSON.stringify({
  ...payload,
  generatedAt: new Date().toISOString(),
  updateFrequency: 'daily',
  evaluationWindow: '24-72 hours',
  items: processed
}, null, 2)}\n`);
console.log(`[industry/localize] wrote ${processed.length} bilingual ranked items`);
