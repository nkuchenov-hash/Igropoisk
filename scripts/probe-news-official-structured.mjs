import fs from 'node:fs/promises';
import { parseStructuredOfficialNews } from './lib/news-official-structured.mjs';

const registry = JSON.parse(await fs.readFile('data/news-sources.json', 'utf8'));
const sources = (registry.sources || []).filter(source => source.enabled !== false && source.siteUrl);
const concurrency = 8;
const timeoutMs = 10000;

async function probe(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(source.siteUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'IgropoiskOfficialSourceProbe/1.0 (+https://github.com/nkuchenov-hash/Igropoisk)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    const items = parseStructuredOfficialNews(html, source, response.url || source.siteUrl, { maxAgeDays: 14 });
    return {
      id: source.id,
      name: source.name,
      status: 'ok',
      finalUrl: response.url || source.siteUrl,
      contentType: response.headers.get('content-type') || '',
      structuredItems: items.length,
      newest: items[0]?.publishedAt || null,
      sampleTitles: items.slice(0, 3).map(item => item.title),
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    return { id: source.id, name: source.name, status: 'error', error: error.message, structuredItems: 0, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let index = 0; index < sources.length; index += concurrency) {
  results.push(...await Promise.all(sources.slice(index, index + concurrency).map(probe)));
}
const withStructuredNews = results.filter(result => result.structuredItems > 0);
const report = {
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  reachable: results.filter(result => result.status === 'ok').length,
  structuredSourceCount: withStructuredNews.length,
  structuredItemCount: withStructuredNews.reduce((sum, result) => sum + result.structuredItems, 0),
  structuredSources: withStructuredNews.map(result => result.id),
  results
};
await fs.mkdir('tmp', { recursive: true });
await fs.writeFile('tmp/news-official-structured-probe.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`[official/jsonld-probe] structured=${report.structuredSourceCount}/${report.sourceCount}; reachable=${report.reachable}/${report.sourceCount}; items=${report.structuredItemCount}`);
for (const result of withStructuredNews) console.log(`[official/jsonld-probe] ${result.id}: ${result.structuredItems} fresh item(s); ${result.sampleTitles.join(' | ')}`);
