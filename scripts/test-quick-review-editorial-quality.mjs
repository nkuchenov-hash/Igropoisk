#!/usr/bin/env node
import fs from 'node:fs';

const source=fs.readFileSync('scripts/build-review-bootstrap-local.mjs','utf8');
const fail=message=>{throw new Error(message)};
for(const marker of [
  'https://models.github.ai/inference/chat/completions',
  "GITHUB_REVIEW_MODEL||'openai/gpt-4.1'",
  "provider:'github-models'",
  "provider:'local-ollama'",
  'duplicate paragraphs',
  'duplicate long sentences',
  'unique sentence ratio',
  'existing bootstrap review failed editorial quality gate; regenerating',
  'prior_failures:generatedResult.failures',
  'source.snippet||source.summary||source.description||source.identity_evidence',
  'Не повторяй одну мысль или формулировку',
  'Заголовки разделов должны быть конкретными'
])if(!source.includes(marker))fail(`Quick-review editorial quality contract missing: ${marker}`);
const githubAt=source.indexOf('if(process.env.GITHUB_TOKEN)');
const localAt=source.indexOf('const generated=await localJson');
if(githubAt<0||localAt<0||githubAt>localAt)fail('GitHub Models must be attempted before the local emergency fallback');
if(source.includes("if(existing?.publication_status==='published'&&Number(existing.score)===score&&fs.existsSync(path.join(root,'article',slug,'index.html'))){\n  console.log(JSON.stringify({slug,status:'already_published'"))fail('Existing bootstrap reviews can bypass the editorial quality gate');
console.log('Quick-review primary-model and anti-repetition contract passed.');
