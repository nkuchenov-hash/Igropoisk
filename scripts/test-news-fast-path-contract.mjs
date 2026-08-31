import assert from 'node:assert/strict';
import fs from 'node:fs';

const staging = fs.readFileSync('.github/workflows/news-pipeline-staging.yml', 'utf8');
const production = fs.readFileSync('.github/workflows/news-pipeline.yml', 'utf8');

for (const [name, workflow] of [['staging', staging], ['production', production]]) {
  assert.doesNotMatch(workflow, /Restore local Qwen news editor model/, `${name} still restores the 2.6 GB Qwen cache`);
  assert.match(workflow, /NEWS_EDITOR_QWEN_MAX_ITEMS:\s*'0'/, `${name} must disable Qwen on the normal hourly path`);
}

assert.match(production, /steps\.game_pages\.outputs\.count == '0'/, 'production publication must wait for verified game pages');
assert.match(production, /previous live snapshot remains active/i, 'defer path must explicitly preserve the previous live snapshot');

console.log('Fast zero-Qwen hourly news contract passed.');
