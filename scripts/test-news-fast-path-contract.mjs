import assert from 'node:assert/strict';
import fs from 'node:fs';

const staging = fs.readFileSync('.github/workflows/news-pipeline-staging.yml', 'utf8');
const production = fs.readFileSync('.github/workflows/news-pipeline.yml', 'utf8');
const normalizer = fs.readFileSync('scripts/normalize-news-game-hashtags.mjs', 'utf8');
const audit = fs.readFileSync('scripts/audit-news-game-hashtags.mjs', 'utf8');
const pendingPage = fs.readFileSync('game/pending/index.html', 'utf8');

for (const [name, workflow] of [['staging', staging], ['production', production]]) {
  assert.doesNotMatch(workflow, /Restore local Qwen news editor model/, `${name} still restores the 2.6 GB Qwen cache`);
  assert.match(workflow, /NEWS_EDITOR_QWEN_MAX_ITEMS:\s*'0'/, `${name} must disable Qwen on the normal hourly path`);
}

assert.match(production, /Put verified missing games into temporary page-assembly storage/,
  'production must hand verified missing games to temporary page-assembly storage');
assert.match(production, /continue-on-error:\s*true[\s\S]{0,500}publish-game-page-assembly-queue\.mjs/,
  'temporary page-assembly storage must never block fresh news');
assert.doesNotMatch(production, /news-game-page-fast\.yml|Create every verified missing game page through the shared Game Creator/,
  'news must never launch direct game-page creation');
assert.doesNotMatch(production, /Publish compact live snapshot and stable monthly archive[\s\S]{0,220}steps\.game_pages\.outputs\.count == '0'/,
  'a missing game page must not block publication of unrelated fresh news');
assert.match(production, /Continue news publication independently from page assembly/,
  'production must explicitly continue the fresh snapshot after queue handoff');

assert.match(normalizer, /pendingGamePageUrl/,
  'missing game pages must receive a stable preparing-page route instead of losing their hashtag');
assert.match(normalizer, /game\.pageUrl = pendingGamePageUrl\(game\)/,
  'a missing game must keep a clickable destination while page assembly runs');
assert.match(normalizer, /game\.hashtag = canonicalGameHashtag\(game\)/,
  'a verified missing game must keep its hashtag');
assert.doesNotMatch(normalizer, /game\.hashtag\s*=\s*''/,
  'page assembly must never hide a verified game hashtag');
assert.match(pendingPage, /Материал готовится|материал готовится/i,
  'the temporary game route must visibly explain that the material is being prepared');
assert.match(pendingPage, /location\.replace\(target\.href\)/,
  'the temporary game route must automatically forward to the completed game page when it appears');

assert.match(audit, /blockingIntegrityFindings/,
  'hashtag diagnostics must remain observable');
assert.doesNotMatch(production, /audit-news-game-hashtags\.mjs --strict(?![^\n]*\|\| true)/,
  'hashtag diagnostics must never be a global production publication blocker');

console.log('Fail-open hourly news publication, page queue and always-clickable hashtag contract passed.');
