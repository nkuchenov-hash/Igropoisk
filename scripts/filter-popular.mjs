import fs from 'node:fs';
import { filterPopularRanking } from './home-feeds-quality-lib.mjs';

const file = 'data/popular/current.json';
const runFile = 'data/parser-runs/popular.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const config = JSON.parse(fs.readFileSync('config/home-feeds-quality.json', 'utf8'));
const rules = config.popular || {};

const blockedTitles = [
  /^steam deck$/i,
  /^steam machine$/i,
  /^valve index/i,
  /^steam controller$/i,
  /soundtrack$/i,
  /dedicated server$/i,
  /benchmark$/i,
  /sdk$/i
];

const candidates = (data.ranking || []).filter(item => {
  const title = String(item.title || '').trim();
  if (!title || blockedTitles.some(pattern => pattern.test(title))) return false;
  if (!item.image) {
    const steam = (item.evidence || []).find(row => Number(row.appid));
    if (steam) item.image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steam.appid}/library_600x900.jpg`;
  }
  return true;
});

const { accepted, rejected } = filterPopularRanking(candidates, rules);
const required = Math.max(1, Number(rules.required_cards || 20));
const maximum = Math.max(required, Number(rules.maximum_pool || 30));
if (accepted.length < required) {
  throw new Error(`Popular quality gate retained ${accepted.length} games; ${required} are required. Previous published snapshot must be preserved.`);
}

data.schema_version = Math.max(7, Number(data.schema_version || 0));
data.method = {
  ...(data.method || {}),
  quality_policy: 'Independent current-spike evidence; weak commercial-only signals and duplicate editions are rejected.'
};
data.ranking = accepted.slice(0, maximum);
data.quality = {
  schema_version: 1,
  required_cards: required,
  accepted: data.ranking.length,
  rejected: rejected.length,
  stale_after_hours: Number(rules.stale_after_hours || 12),
  rejected_items: rejected.slice(0, 30)
};

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
try {
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  run.ranked_count = data.ranking.length;
  run.quality_rejected = rejected.length;
  run.note = `Опубликовано ${data.ranking.length} позиций с независимым подтверждением текущего всплеска; отклонено ${rejected.length}.`;
  fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
} catch {}
