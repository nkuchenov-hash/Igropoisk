import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const readJSON = (relative, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; } };
const writeJSON = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); };
const exists = relative => fs.existsSync(path.join(root, relative));
let plan = readJSON('data/content-pipeline/execution-plan.json', {pages: [], reviews: []});
const startedAt = new Date().toISOString();
const results = [];
function run(label, command, args, env = {}) {
  const started = Date.now();
  const child = spawnSync(command, args, {cwd: root, encoding: 'utf8', stdio: 'pipe', env: {...process.env, ...env}, maxBuffer: 16 * 1024 * 1024});
  const record = {label, command: [command, ...args].join(' '), status: child.status === 0 ? 'success' : 'blocked', exit_code: child.status, duration_ms: Date.now() - started, stdout: (child.stdout || '').slice(-12000), stderr: (child.stderr || '').slice(-12000)};
  results.push(record);
  console.log(`\n[${record.status}] ${record.command}`);
  if (record.stdout) console.log(record.stdout);
  if (record.stderr) console.error(record.stderr);
  return child.status === 0;
}

let pageSucceeded = false;
for (const task of plan.pages || []) {
  if (!task.game_id) { results.push({label: `page:${task.slug}`, status: 'blocked', reason: 'canonical_game_id_missing'}); continue; }

  // Steam is a useful bootstrap source, but it is not a requirement for a canonical game.
  // Console/exclusive/upcoming popular games continue through registry-seeded web research.
  if (task.steam_appid) {
    run(`parse:${task.slug}`, 'node', ['scripts/parse-game-data.mjs', task.slug, String(task.steam_appid), task.title || '']);
  }
  const built = run(`page:${task.slug}`, 'node', ['scripts/build-game-page-from-registry.mjs', task.game_id], {
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5',
    OPENAI_RESEARCH_MODEL: process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5'
  });
  if (built) pageSucceeded = true;
}

// A newly published page immediately becomes eligible for its Игропоиск review.
// Rebuild the canonical plan once after the page phase instead of waiting for tomorrow's run.
if (pageSucceeded) {
  const replanned = run('replan-after-pages', 'node', ['scripts/orchestrate-content.mjs', '--finalize']);
  if (replanned) plan = readJSON('data/content-pipeline/execution-plan.json', plan);
}

let reviewSucceeded = false;
for (const task of plan.reviews || []) {
  const slug = task.slug;
  if (!task.game_id) { results.push({label: `review:${slug}`, status: 'blocked', reason: 'canonical_game_id_missing'}); continue; }
  if (!exists(`data/drafts/${slug}.json`)) { results.push({label: `review:${slug}`, status: 'blocked', reason: `missing data/drafts/${slug}.json`}); continue; }
  const steps = [['research','scripts/prepare-review-research.mjs'],['rating','scripts/calculate-ratings-from-research.mjs'],['media-discovery','scripts/discover-review-media.mjs'],['synthesis','scripts/synthesize-review.mjs'],['media-enrichment','scripts/enrich-review-media.mjs'],['validation','scripts/validate-review-output.mjs']];
  let ok = true;
  for (const [label, script] of steps) {
    if (!exists(script)) { results.push({label: `${label}:${slug}`, status: 'blocked', reason: `missing ${script}`}); ok = false; break; }
    if (!run(`${label}:${slug}`, 'node', [script, slug], {GAME_REGISTRY_ID: task.game_id})) { ok = false; break; }
  }
  if (ok) reviewSucceeded = true;
}
if (reviewSucceeded && exists('scripts/render-review-pages.mjs')) run('render-reviews', 'node', ['scripts/render-review-pages.mjs']);
const finishedAt = new Date().toISOString();
const summary = {success: results.filter(item => item.status === 'success').length, blocked: results.filter(item => item.status !== 'success').length, total: results.length};
writeJSON('data/content-pipeline/execution-log.json', {schema_version: 2, started_at: startedAt, finished_at: finishedAt, summary, results});
console.log(JSON.stringify(summary, null, 2));
