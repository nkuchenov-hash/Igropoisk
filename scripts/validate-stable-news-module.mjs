#!/usr/bin/env node

import fs from 'node:fs';

const fail = message => {
  console.error(`STABLE_NEWS_MODULE_ERROR: ${message}`);
  process.exitCode = 1;
};

const read = path => {
  if (!fs.existsSync(path)) {
    fail(`required file is missing: ${path}`);
    return '';
  }
  return fs.readFileSync(path, 'utf8');
};

const requireText = (text, token, file) => {
  if (!text.includes(token)) fail(`${file} lost required stable-contract token: ${JSON.stringify(token)}`);
};

const forbidText = (text, token, file) => {
  if (text.includes(token)) fail(`${file} reintroduced forbidden stable-contract token: ${JSON.stringify(token)}`);
};

const stableDocPath = 'docs/NEWS_MODULE_STABLE.md';
const contractPath = 'docs/news-production-contract.md';
const pipelinePath = '.github/workflows/news-pipeline.yml';
const stagingPipelinePath = '.github/workflows/news-pipeline-staging.yml';
const pipelineConfigPath = 'config/news-pipeline.json';
const normalizePath = 'scripts/normalize-news-game-hashtags.mjs';
const failOpenTestPath = 'scripts/test-news-fail-open-publication.mjs';
const phaseGatePath = '.github/workflows/phase-a-validation.yml';
const moduleGatePath = '.github/workflows/news-module-check.yml';

const stableDoc = read(stableDocPath);
for (const token of [
  '**Статус:** READY / STABLE',
  'только хирургические',
  'Весь блок новостей не может быть остановлен',
  'game/pending/?slug=...&title=...',
  'pageReady: false',
  'assemblyRequired: true',
  'не создаёт игровые страницы и не ждёт их создания',
  'финальная проверка качества каждой публикуемой новости',
  'не имеют фиксированной квоты количества новостей',
  'Housekeeping никогда не находится перед live switch'
]) requireText(stableDoc, token, stableDocPath);

const contract = read(contractPath);
for (const token of [
  'Никакая внутренняя логическая проверка не имеет права остановить весь здоровый новостной блок',
  'game/pending/?slug=...&title=...',
  'News workflow не запускает fast page builder и не ждёт page assembly',
  'publish snapshot + switch live manifest',
  'prune old snapshots/media после публикации'
]) requireText(contract, token, contractPath);

const pipelineConfig = read(pipelineConfigPath);
for (const token of [
  '"homepage_exact_items": 0',
  '"data/news-events.json": 0',
  'node scripts/edit-news-russian.mjs',
  'node scripts/finalize-news-publication-quality.mjs',
  'node scripts/normalize-news-game-hashtags.mjs'
]) requireText(pipelineConfig, token, pipelineConfigPath);
const editorIndex = pipelineConfig.indexOf('node scripts/edit-news-russian.mjs');
const qualityIndex = pipelineConfig.indexOf('node scripts/finalize-news-publication-quality.mjs');
const hashtagIndex = pipelineConfig.indexOf('node scripts/normalize-news-game-hashtags.mjs');
if (!(editorIndex >= 0 && qualityIndex > editorIndex && hashtagIndex > qualityIndex)) {
  fail(`${pipelineConfigPath} lost final per-item quality gate ordering`);
}

const pipeline = read(pipelinePath);
for (const token of [
  "cron: '23 * * * *'",
  'ref: staging',
  'cancel-in-progress: false',
  'models: read',
  'GITHUB_TOKEN: ${{ github.token }}',
  'node scripts/run-news-pipeline.mjs',
  'node scripts/test-news-publication-quality.mjs',
  'Put verified missing games into temporary page-assembly storage',
  'Continue news publication independently from page assembly',
  'Audit hashtag integrity without blocking publication',
  'Publish compact live snapshot and stable monthly archive',
  'Reclaim redundant Object Storage snapshots after publication',
  'Expire news image cache older than seven days',
  'node scripts/publish-news-storage.mjs'
]) requireText(pipeline, token, pipelinePath);

const stagingPipeline = read(stagingPipelinePath);
for (const token of [
  'models: read',
  'GITHUB_TOKEN: ${{ github.token }}',
  'node scripts/run-news-pipeline.mjs --force',
  'node scripts/test-news-publication-quality.mjs',
  'tmp/news-publication-quality-report.json'
]) requireText(stagingPipeline, token, stagingPipelinePath);

for (const [file, text] of [[pipelinePath, pipeline], [stagingPipelinePath, stagingPipeline]]) {
  forbidText(text, 'NEWS_EDITOR_MIN_PUBLIC', file);
  forbidText(text, "NEWS_HOMEPAGE_LIMIT: '12'", file);
  forbidText(text, 'NEWS_HOMEPAGE_LIMIT: "12"', file);
}

const orderedSteps = [
  'Put verified missing games into temporary page-assembly storage',
  'Continue news publication independently from page assembly',
  'Audit hashtag integrity without blocking publication',
  'Publish compact live snapshot and stable monthly archive',
  'Reclaim redundant Object Storage snapshots after publication',
  'Expire news image cache older than seven days'
];
let previous = -1;
for (const step of orderedSteps) {
  const index = pipeline.indexOf(step);
  if (index < 0) continue;
  if (index <= previous) fail(`${pipelinePath} changed stable publication order around ${step}`);
  previous = index;
}

const requireContinueOnErrorNear = step => {
  const index = pipeline.indexOf(`- name: ${step}`);
  if (index < 0) return;
  const next = pipeline.indexOf('\n      - name:', index + 1);
  const block = pipeline.slice(index, next < 0 ? pipeline.length : next);
  if (!block.includes('continue-on-error: true')) {
    fail(`${pipelinePath} made stable advisory step blocking: ${step}`);
  }
};

requireContinueOnErrorNear('Put verified missing games into temporary page-assembly storage');
requireContinueOnErrorNear('Audit hashtag integrity without blocking publication');
requireContinueOnErrorNear('Reclaim redundant Object Storage snapshots after publication');
requireContinueOnErrorNear('Expire news image cache older than seven days');

const normalize = read(normalizePath);
for (const token of [
  'game/pending/?',
  'pageReady = false',
  'assemblyRequired = true',
  'pageUrl = pendingGamePageUrl',
  'publication remains fail-open'
]) requireText(normalize, token, normalizePath);

const failOpenTest = read(failOpenTestPath);
for (const token of [
  "result.status, 'success'",
  "result.publication_eligible, true",
  "report.publication_policy, 'fail-open-item-filtered'",
  'internal failures never stop the whole feed'
]) requireText(failOpenTest, token, failOpenTestPath);

for (const gatePath of [phaseGatePath, moduleGatePath]) {
  const gate = read(gatePath);
  requireText(gate, 'node scripts/validate-stable-news-module.mjs', gatePath);
}

if (process.exitCode) {
  console.error('Stable news module protection FAILED. Architectural news changes require an explicit module-change task.');
  process.exit(process.exitCode);
}

console.log('Stable news module contract is intact: fail-open per-item publication, final public-copy quality gate, no fixed news quota, pending game route, independent page queue, hourly autonomous storage publication, post-publish cleanup.');
