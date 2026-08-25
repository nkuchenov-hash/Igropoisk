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

for (const name of fs.readdirSync(WORKFLOWS).filter(file => /\.ya?ml$/i.test(file))) {
  const relative = `.github/workflows/${name}`;
  const content = read(relative);
  const lines = content.split('\n');
  const isolatedAutomationPrWriter = /(?:BRANCH|branch)="automation\/[^"\n]*\$\{GITHUB_RUN_ID\}[^"\n]*"/.test(content)
    && /gh\s+pr\s+create[\s\S]*--base\s+staging/.test(content);

  for (const [index, line] of lines.entries()) {
    if (/\bgh\s+workflow\s+run\s+pages\.yml\b/.test(line)) {
      fail(`${relative}:${index + 1} dispatches production deployment outside a main merge.`);
    }
    if (/\bgit\s+push\b/.test(line) && !/staging/.test(line)) {
      const pushesIsolatedPrBranch = isolatedAutomationPrWriter && /git\s+push\s+origin\s+"?\$(?:BRANCH|branch)"?/.test(line);
      if (!pushesIsolatedPrBranch) fail(`${relative}:${index + 1} pushes without an explicit staging target or approved isolated PR branch.`);
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

if (process.env.GITHUB_ACTIONS === 'true') {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'igropoisk-news-diagnostic' };
  try {
    const response = await fetch('https://api.github.com/repos/nkuchenov-hash/Igropoisk/actions/workflows/news-pipeline.yml', {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    const workflow = await response.json();
    console.log(`[news/workflow-state] HTTP ${response.status}: ${JSON.stringify(workflow)}`);
    if (workflow?.id) {
      const runsResponse = await fetch(`https://api.github.com/repos/nkuchenov-hash/Igropoisk/actions/workflows/${workflow.id}/runs?per_page=30`, {
        headers,
        signal: AbortSignal.timeout(15000)
      });
      const runs = await runsResponse.json();
      const summary = (runs.workflow_runs || []).map(run => ({
        id: run.id,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at,
        head_branch: run.head_branch,
        head_sha: run.head_sha,
        run_number: run.run_number
      }));
      console.log(`[news/workflow-runs] HTTP ${runsResponse.status}: ${JSON.stringify(summary)}`);
    }
  } catch (error) {
    console.log(`[news/workflow-state] diagnostic failed: ${error.message}`);
  }
}

if (errors.length) {
  throw new Error(`Production boundary validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}

console.log('Production is read-only; repository writers target staging or an approved isolated PR branch, and news publishes only to external content storage.');
