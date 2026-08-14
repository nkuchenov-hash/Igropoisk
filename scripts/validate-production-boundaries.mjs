import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const errors = [];
const fail = message => errors.push(message);
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const pages = read('.github/workflows/pages.yml');
if (pages.includes('workflow_dispatch:')) fail('Production Pages workflow must deploy only from a main push.');
if (/materialize-deployment\.mjs|inject-release-ui\.mjs|enforce_layout_contract\.py\s+--write|\bsed\b|perl\s+-pi/.test(pages)) {
  fail('Production Pages workflow still contains build-time repair or mutation commands.');
}
if (!pages.includes('node scripts/verify-deployment-source.mjs')) fail('Production Pages workflow does not verify immutable source.');
if (!pages.includes('node scripts/validate-production-boundaries.mjs')) fail('Production Pages workflow does not verify automation boundaries.');

const stagingGate = read('.github/workflows/phase-a-validation.yml');
if (!stagingGate.includes('workflow_dispatch:')) fail('Staging gate cannot be dispatched after an automated staging write.');
const stagingWatcher = read('.github/workflows/staging-gate-watch.yml');
if (!stagingWatcher.includes('workflow_run:')
  || !stagingWatcher.includes('gh workflow run phase-a-validation.yml')
  || !stagingWatcher.includes('--repo "$GITHUB_REPOSITORY"')
  || !stagingWatcher.includes('--ref staging')) {
  fail('Automated staging writers are not followed by the full staging gate in explicit repository context.');
}

const newsPipeline = read('.github/workflows/news-pipeline.yml');
if (newsPipeline.includes('contents: write') || /\bgit\s+push\b/.test(newsPipeline)) {
  fail('News publication still writes generated content into GitHub.');
}
if (!newsPipeline.includes('node scripts/publish-news-storage.mjs')) {
  fail('News publication does not publish an external immutable snapshot.');
}
for (const secret of ['YC_S3_ACCESS_KEY_ID', 'YC_S3_SECRET_ACCESS_KEY', 'YC_S3_BUCKET']) {
  if (!newsPipeline.includes(`secrets.${secret}`)) fail(`News publication is missing secret ${secret}.`);
}
if (stagingWatcher.includes('Autonomous news pipeline')) {
  fail('External news publication is incorrectly treated as a staging repository write.');
}

const productionPrProfiles = [
  {
    branchPrefix: 'automation/news-game-pages-',
    materializer: 'node scripts/materialize-news-production-pages.mjs --target'
  },
  {
    branchPrefix: 'automation/popular-game-pages-',
    materializer: 'node scripts/materialize-popular-production-pages.mjs --target'
  }
];

function workflowStepBlock(lines, index) {
  let start = index;
  while (start > 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
  let end = index + 1;
  while (end < lines.length && !/^\s*-\s+name:/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

function approvedIsolatedPrPush(content, step, line) {
  if (!/git\s+push\s+origin\s+"?\$branch"?/.test(line)) return false;
  const branch = step.match(/branch="(automation\/[^"\n]+)"/)?.[1] || '';
  if (!branch || !branch.includes('${GITHUB_RUN_ID}')) return false;
  if (!/gh\s+pr\s+create[\s\S]*--head\s+"?\$branch"?/.test(step)) return false;
  if (!/gh\s+pr\s+merge\s+"?\$pr_url"?[\s\S]*--merge/.test(step)) return false;

  if (/--base\s+staging/.test(step)) return true;
  if (!/--base\s+main/.test(step)) return false;

  const profile = productionPrProfiles.find(item => branch.startsWith(item.branchPrefix));
  if (!profile || !content.includes(profile.materializer)) return false;
  for (const required of [
    'git diff --check',
    'node scripts/validate-game-v3.mjs',
    'node scripts/validate-production-boundaries.mjs'
  ]) {
    if (!step.includes(required)) return false;
  }
  if (/git\s+push[^\n]*(?:HEAD:main|refs\/heads\/main)/.test(step)) return false;
  return true;
}

for (const name of fs.readdirSync(WORKFLOWS).filter(file => /\.ya?ml$/i.test(file))) {
  const relative = `.github/workflows/${name}`;
  const content = read(relative);
  const lines = content.split('\n');

  for (const [index, line] of lines.entries()) {
    if (/\bgh\s+workflow\s+run\s+pages\.yml\b/.test(line)) {
      fail(`${relative}:${index + 1} dispatches production deployment outside a main merge.`);
    }
    if (/\bgit\s+push\b/.test(line) && !/staging/.test(line)) {
      const step = workflowStepBlock(lines, index);
      if (!approvedIsolatedPrPush(content, step, line)) {
        fail(`${relative}:${index + 1} pushes without an explicit staging target or approved isolated PR branch.`);
      }
    }
    if (/\bgit\s+pull\b/.test(line) && /origin\s+main/.test(line)) {
      fail(`${relative}:${index + 1} rebases generated content directly on main.`);
    }
  }

  if (content.includes('contents: write') && content.includes('git push')) {
    if (!content.includes('ref: staging')) fail(`${relative} writes repository content without checking out staging.`);
    if (/HEAD:main|refs\/heads\/main/.test(content)) fail(`${relative} contains an explicit main write target.`);
  }
}

const coverCache = read('scripts/cache-release-covers.mjs');
if (/calendarFile|injectPreloads\s*\(/.test(coverCache)) {
  fail('Release cover parser still rewrites calendar/index.html.');
}

if (errors.length) {
  throw new Error(`Production boundary validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}

console.log('Production is read-only; repository writers target staging or a validated isolated PR branch, and news publishes only to external content storage.');
