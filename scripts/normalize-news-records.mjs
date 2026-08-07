import fs from 'node:fs/promises';
import { canonicalSourceUrl, enrichNewsItems } from './lib/news-game-linker.mjs';

const files = ['data/news.json', 'data/publisher-news.json'];

function itemsFrom(payload) {
  return Array.isArray(payload) ? payload : (payload.items || []);
}

function chooseRicher(previous, candidate) {
  const previousScore = Number(Boolean(previous.titleRu)) * 10 + Number(Boolean(previous.summaryRu)) * 5 + Number(previous.sourceCount || previous.mediaSourceCount || 0);
  const candidateScore = Number(Boolean(candidate.titleRu)) * 10 + Number(Boolean(candidate.summaryRu)) * 5 + Number(candidate.sourceCount || candidate.mediaSourceCount || 0);
  return candidateScore >= previousScore ? candidate : previous;
}

for (const file of files) {
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  const enriched = await enrichNewsItems(itemsFrom(payload));
  const unique = new Map();
  for (const item of enriched) {
    const key = canonicalSourceUrl(item.primaryUrl || item.url || '');
    if (!key) continue;
    unique.set(key, unique.has(key) ? chooseRicher(unique.get(key), item) : item);
  }
  const items = [...unique.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await fs.writeFile(file, `${JSON.stringify({ ...payload, generatedAt: payload.generatedAt || new Date().toISOString(), items }, null, 2)}\n`);
  console.log(`[news/normalize] ${file}: ${items.length} unique records with publication day and game links`);
}
