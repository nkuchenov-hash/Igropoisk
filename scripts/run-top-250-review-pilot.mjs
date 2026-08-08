#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const target = Math.max(1, Math.min(20, Number(targetArg?.split('=')[1] || 10)));
const limit = Math.max(target, Math.min(20, Number(limitArg?.split('=')[1] || 20)));
const currentYear = new Date().getUTCFullYear();
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const writeJson = (relative, value) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = relative => fs.existsSync(path.join(root, relative));

function run(label, script, args = [], env = {}) {
  const child = spawnSync('node', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024
  });
  const record = {
    label,
    status: child.status === 0 ? 'success' : 'blocked',
    exit_code: child.status,
    stdout: (child.stdout || '').slice(-8000),
    stderr: (child.stderr || '').slice(-8000)
  };
  console.log(`\n[${record.status}] node ${script} ${args.join(' ')}`);
  if (record.stdout) console.log(record.stdout);
  if (record.stderr) console.error(record.stderr);
  return record;
}

function seedParserOutput(item) {
  const relative = `data/parser-output/${item.slug}.json`;
  if (exists(relative)) return;
  writeJson(relative, {
    schema_version: 3,
    identity: { slug: item.slug, title: item.title, steam_appid: null, aliases: [], excluded_versions: [] },
    release: { date: '', date_text: item.year ? String(item.year) : '', status: 'unknown' },
    companies: { developers: [], publishers: [] },
    classification: { genres: [], platforms: [], categories: [] },
    editorial: { short_description: '', integrated_description: '', campaign: '', features: [] },
    media: { hero: item.image || '', cover: item.image || '', screenshots: [], videos: [], artwork: [], official_video_exists: false },
    requirements: { pc: { minimum: { raw: '' }, recommended: { raw: '' } }, platforms: [] },
    links: { official: '', store: '', developer: '', publisher: '' },
    sources: [],
    source: { type: 'top-250-pilot', game_id: item.game_id }
  });
}

function definitelyUnreleased(draft) {
  const release = draft?.release || {};
  const status = String(release.status || '').toLowerCase();
  if (/upcoming|announced|unreleased|not released|coming soon|ожида|анонс|не выш/.test(status)) return true;
  const value = release.date || release.date_text;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > Date.now() + 24 * 60 * 60 * 1000;
}

const initialBuild = run('top-250:initial', 'scripts/build-top-250.mjs', [`--limit=${limit}`]);
if (initialBuild.status !== 'success') process.exit(2);
const top = readJson('data/top-250/current.json');
const results = [];
let successfulReviews = 0;

for (const item of top.ranking.slice(0, limit)) {
  const articleJson = `data/articles/${item.slug}.json`;
  const draftPath = `data/drafts/${item.slug}.json`;
  const result = { rank: item.rank, game_id: item.game_id, slug: item.slug, title: item.title, status: 'queued', steps: [] };

  if (exists(articleJson)) {
    result.status = 'existing_review';
    successfulReviews += 1;
    results.push(result);
    continue;
  }
  if (successfulReviews >= target) {
    result.status = 'not_needed_for_target';
    results.push(result);
    continue;
  }
  if (!process.env.OPENAI_API_KEY) {
    result.status = 'blocked';
    result.reason = 'OPENAI_API_KEY_missing';
    results.push(result);
    continue;
  }

  let draft = exists(draftPath) ? readJson(draftPath) : null;
  if (!draft && Number(item.year || 0) >= currentYear) {
    result.status = 'hold';
    result.reason = 'current_or_future_year_without_verified_release_state';
    results.push(result);
    continue;
  }

  if (!draft || draft.publication?.gate_passed !== true) {
    seedParserOutput(item);
    const page = run(`page:${item.slug}`, 'scripts/build-game-page.mjs', [item.slug], {
      GAME_REGISTRY_ID: item.game_id,
      OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5',
      OPENAI_RESEARCH_MODEL: process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5'
    });
    result.steps.push(page);
    if (page.status !== 'success') {
      result.status = 'blocked';
      result.reason = 'game_page_gate_failed';
      results.push(result);
      continue;
    }
    const canonical = run(`canonicalize-system:${item.slug}`, 'scripts/canonicalize-system-game-identity.mjs', ['--write']);
    result.steps.push(canonical);
    if (canonical.status !== 'success') {
      result.status = 'blocked';
      result.reason = 'game_registry_canonicalization_failed';
      results.push(result);
      continue;
    }
    draft = readJson(draftPath);
  }

  if (definitelyUnreleased(draft)) {
    result.status = 'hold';
    result.reason = 'unreleased';
    results.push(result);
    continue;
  }

  const stages = [
    ['research', 'scripts/prepare-review-research.mjs'],
    ['rating', 'scripts/calculate-ratings-from-research.mjs'],
    ['media-discovery', 'scripts/discover-review-media.mjs'],
    ['synthesis', 'scripts/synthesize-review.mjs'],
    ['media-enrichment', 'scripts/enrich-review-media.mjs'],
    ['validation', 'scripts/validate-review-output.mjs']
  ];
  let passed = true;
  for (const [label, script] of stages) {
    const step = run(`${label}:${item.slug}`, script, [item.slug], { GAME_REGISTRY_ID: item.game_id });
    result.steps.push(step);
    if (step.status !== 'success') {
      result.status = 'blocked';
      result.reason = `${label}_gate_failed`;
      passed = false;
      break;
    }
  }
  if (!passed) {
    results.push(result);
    continue;
  }

  const editorialIdentity = run(`canonicalize-editorial:${item.slug}`, 'scripts/canonicalize-all-editorial-game-ids.mjs', ['--write']);
  result.steps.push(editorialIdentity);
  if (editorialIdentity.status !== 'success') {
    result.status = 'blocked';
    result.reason = 'editorial_identity_failed';
    results.push(result);
    continue;
  }
  result.status = 'review_ready';
  successfulReviews += 1;
  results.push(result);
}

if (successfulReviews > 0) {
  const render = run('render-reviews', 'scripts/render-review-pages.mjs');
  if (render.status !== 'success') results.push({ status: 'blocked', reason: 'review_render_failed', steps: [render] });
}
run('canonicalize-system:final', 'scripts/canonicalize-system-game-identity.mjs', ['--write']);
run('canonicalize-editorial:final', 'scripts/canonicalize-all-editorial-game-ids.mjs', ['--write']);
run('top-250:final', 'scripts/build-top-250.mjs', [`--limit=${limit}`]);

const publishedCount = exists('data/top-250/current.json')
  ? readJson('data/top-250/current.json').ranking.filter(item => item.review?.status === 'published').length
  : 0;
const status = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  requested_top: limit,
  target_reviews: target,
  successful_reviews: successfulReviews,
  published_reviews_in_top: publishedCount,
  passed: successfulReviews >= target,
  results: results.map(item => ({ ...item, steps: item.steps?.map(step => ({ label: step.label, status: step.status, exit_code: step.exit_code, stderr: step.stderr })) }))
};
writeJson('data/top-250/review-pilot-status.json', status);
console.log(JSON.stringify({ target, successfulReviews, publishedCount, passed: status.passed }, null, 2));
if (!status.passed) process.exit(2);
