import assert from 'node:assert/strict';
import fs from 'node:fs';

const staging = fs.readFileSync('.github/workflows/news-pipeline-staging.yml', 'utf8');
const production = fs.readFileSync('.github/workflows/news-pipeline.yml', 'utf8');
const normalizer = fs.readFileSync('scripts/normalize-news-game-hashtags.mjs', 'utf8');

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
assert.match(normalizer, /canonical && canonical\.pageExists === false \? '' : canonicalGameHashtag\(base\)/,
  'a canonical game without a completed linkable page must not expose a clickable hashtag');
assert.match(normalizer, /game\.pageUrl = '';[\s\S]{0,120}game\.hashtag = '';/,
  'a missing game page must expose neither a bad URL nor a hashtag');

console.log('Fast zero-Qwen hourly news queue contract passed.');
