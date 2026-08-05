import fs from 'node:fs';
import { filterPopularRanking } from './home-feeds-quality-lib.mjs';

const file = 'data/popular/current.json';
const runFile = 'data/parser-runs/popular.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const config = JSON.parse(fs.readFileSync('config/home-feeds-quality.json', 'utf8'));
const rules = config.popular || {};
const releases = (() => {
  try { return JSON.parse(fs.readFileSync('data/releases/current.json', 'utf8')).releases || []; }
  catch { return []; }
})();

const canonical = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[™®©]/g, ' ').replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const releaseBySlug = new Map(releases.map(game => [game.slug, game]));
const releaseByTitle = new Map(releases.map(game => [canonical(game.title), game]));
const releaseBySteam = new Map(releases.map(game => [Number(game.external_ids?.steam), game]).filter(([id]) => id));
const referenceTime = Number.isFinite(Date.parse(data.generated_at)) ? Date.parse(data.generated_at) : Date.now();
const referenceDate = new Date(referenceTime);
const referenceDay = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
const recentDays = Math.max(0, Number(rules.launch_recent_days || 7));
const upcomingDays = Math.max(0, Number(rules.launch_upcoming_days || 7));

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

function launchEvidence(item) {
  if (rules.allow_launch_demand === false || !(item.families || []).includes('steam_chart')) return null;
  const appid = Number((item.evidence || []).find(row => Number(row.appid))?.appid || 0);
  const release = releaseBySlug.get(item.slug) || releaseBySteam.get(appid) || releaseByTitle.get(canonical(item.title));
  const event = (release?.events || []).find(row => row.precision === 'exact' && row.status === 'confirmed') || null;
  if (!event || Number(event.confidence || 0) < 0.9) return null;
  const value = event.date || event.date_start;
  const releaseTime = value ? Date.parse(`${value}T12:00:00Z`) : NaN;
  if (!Number.isFinite(releaseTime)) return null;
  const diffDays = Math.round((releaseTime - referenceDay) / 86_400_000);
  if (diffDays < -recentDays || diffDays > upcomingDays) return null;
  return {
    family: 'launch',
    source: release.sources?.[0]?.title || 'Официальный календарь релиза',
    title: `${release.title}: релиз ${value}`,
    url: release.sources?.[0]?.url || '',
    observed_at: release.last_seen_at || data.generated_at,
    release_date: value,
    day_offset: diffDays,
    value: 1
  };
}

const candidates = (data.ranking || []).map(source => {
  const item = { ...source, families: [...(source.families || [])], evidence: [...(source.evidence || [])] };
  const title = String(item.title || '').trim();
  if (!title || blockedTitles.some(pattern => pattern.test(title))) return null;
  const launch = launchEvidence(item);
  if (launch) {
    item.families = [...new Set([...item.families, 'launch'])];
    item.evidence.push(launch);
    item.launch_signal = { confirmed: true, release_date: launch.release_date, day_offset: launch.day_offset };
  }
  if (!item.image) {
    const steam = item.evidence.find(row => Number(row.appid));
    if (steam) item.image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steam.appid}/library_600x900.jpg`;
  }
  return item;
}).filter(Boolean);

const { accepted, rejected } = filterPopularRanking(candidates, rules);
const required = Math.max(1, Number(rules.required_cards || 20));
const maximum = Math.max(required, Number(rules.maximum_pool || 30));
if (accepted.length < required) {
  throw new Error(`Popular quality gate retained ${accepted.length} games; ${required} are required. Previous published snapshot must be preserved.`);
}

data.schema_version = Math.max(7, Number(data.schema_version || 0));
data.method = {
  ...(data.method || {}),
  quality_policy: 'Fresh independent evidence or official launch-window demand; weak commercial-only signals and duplicate editions are rejected.'
};
data.ranking = accepted.slice(0, maximum);
data.quality = {
  schema_version: 1,
  required_cards: required,
  accepted: data.ranking.length,
  rejected: rejected.length,
  launch_signals: data.ranking.filter(item => item.launch_signal?.confirmed).length,
  stale_after_hours: Number(rules.stale_after_hours || 12),
  rejected_items: rejected.slice(0, 30)
};

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
try {
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  run.ranked_count = data.ranking.length;
  run.quality_rejected = rejected.length;
  run.launch_signals = data.quality.launch_signals;
  run.note = `Опубликовано ${data.ranking.length} позиций с текущим подтверждением; ${data.quality.launch_signals} подтверждены официальным окном релиза и спросом Steam; отклонено ${rejected.length}.`;
  fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
} catch {}
