#!/usr/bin/env node
import fs from 'node:fs';

const source=fs.readFileSync('scripts/build-review-bootstrap-local.mjs','utf8');
const fail=message=>{throw new Error(message)};
for(const marker of [
  "provider:'local-ollama'",
  'QUICK_REVIEW_TIMEOUT_MS||300000',
  'for(let attempt=1;attempt<=2;attempt++)',
  'duplicate paragraphs',
  'duplicate long sentences',
  'unique sentence ratio',
  'existing bootstrap review failed editorial quality gate; regenerating',
  'prior_failures:generatedResult.failures',
  'source.snippet||source.summary||source.description||source.identity_evidence',
  'Не повторяй одну мысль или формулировку',
  'Заголовки разделов должны быть конкретными'
])if(!source.includes(marker))fail(`Quick-review editorial quality contract missing: ${marker}`);
for(const retired of ['https://models.github.ai/inference/chat/completions',"provider:'github-models'",'GITHUB_REVIEW_MODEL'])if(source.includes(retired))fail(`Retired GitHub Models dependency remains in quick-review production code: ${retired}`);
if(source.includes("if(existing?.publication_status==='published'&&Number(existing.score)===score&&fs.existsSync(path.join(root,'article',slug,'index.html'))){\n  console.log(JSON.stringify({slug,status:'already_published'"))fail('Existing bootstrap reviews can bypass the editorial quality gate');
console.log('Quick-review durable local-model and anti-repetition contract passed.');
