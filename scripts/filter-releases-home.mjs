import fs from 'node:fs';
import { selectHomeReleases } from './home-feeds-quality-lib.mjs';

const releaseFile = 'data/releases/current.json';
const runFile = 'data/parser-runs/releases.json';
const payload = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
const config = JSON.parse(fs.readFileSync('config/home-feeds-quality.json', 'utf8'));
const popular = JSON.parse(fs.readFileSync('data/popular/current.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('data/catalog-visible.json', 'utf8'));
const popularRanks = new Map((popular.ranking || []).map((item, index) => [item.slug, index + 1]));
const catalogSlugs = new Set((catalog || []).map(item => item.slug).filter(Boolean));
const result = selectHomeReleases(payload.releases || [], { popularRanks, catalogSlugs }, config.releases || {});
const minimum = Math.max(1, Number(config.releases?.minimum_home_cards || 6));
if (result.selected.length < minimum) {
  throw new Error(`Release quality gate selected ${result.selected.length} games; ${minimum} are required. Previous published snapshot must be preserved.`);
}

payload.schema_version = Math.max(2, Number(payload.schema_version || 0));
payload.releases = result.releases;
payload.home_selection = {
  schema_version: 1,
  selected: result.selected.length,
  excluded: result.excluded.length,
  minimum_cards: minimum,
  maximum_cards: Number(config.releases?.maximum_home_cards || 12),
  selected_slugs: result.selected.map(item => item.slug)
};
fs.writeFileSync(releaseFile, `${JSON.stringify(payload, null, 2)}\n`);

try {
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  run.home_selected = result.selected.length;
  run.home_excluded = result.excluded.length;
  run.note = `Полный календарь сохранён: ${payload.releases.length} записей. На главную отобрано ${result.selected.length}; исключено или объединено ${result.excluded.length}.`;
  fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
} catch {}
