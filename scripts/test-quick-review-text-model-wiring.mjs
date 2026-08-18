#!/usr/bin/env node
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const synthesis=fs.readFileSync('scripts/build-review-bootstrap-commercial-local.mjs','utf8');
const audit=fs.readFileSync('scripts/audit-review-bootstrap-local.mjs','utf8');
const githubModel=fs.readFileSync('scripts/lib/github-editorial-model.mjs','utf8');
const fail=message=>{throw new Error(message)};

for(const marker of ['models: read','GITHUB_REVIEW_MODEL: openai/gpt-4.1','GITHUB_AUDIT_MODEL: openai/gpt-4.1','EDITORIAL_PROVIDER: github'])if(!workflow.includes(marker))fail(`Commercial GitHub Models primary wiring missing: ${marker}`);
for(const marker of ['LOCAL_TEXT_MODEL: qwen3:4b','LOCAL_EDITORIAL_MODEL: qwen3:4b','LOCAL_VISION_MODEL: qwen3-vl:4b','ollama-post-create-v2-qwen3-4b'])if(!workflow.includes(marker))fail(`Local fallback/vision wiring missing: ${marker}`);
for(const marker of ['githubChatJson','GITHUB_EDITORIAL_MODEL',"requestedProvider==='local'", "provider='github-models'", "provider='local-ollama'"])if(!synthesis.includes(marker))fail(`Commercial synthesis provider routing missing: ${marker}`);
for(const marker of ['githubChatJson','GITHUB_AUDIT_MODEL',"requestedProvider==='local'", "provider='github-models'", "provider='local-ollama'"])if(!audit.includes(marker))fail(`Commercial audit provider routing missing: ${marker}`);
for(const marker of ['https://models.github.ai/inference/chat/completions','GITHUB_TOKEN','openai/gpt-4.1','response_format'])if(!githubModel.includes(marker))fail(`GitHub editorial client contract missing: ${marker}`);
if(workflow.includes('GITHUB_VISION_MODEL'))fail('GitHub Models must not be coupled to the optional vision/full-review path');

console.log('Quick-review model wiring passed: GitHub Models GPT-4.1 is the commercial text primary; qwen3:4b remains a local fallback and qwen3-vl:4b remains isolated to full-review vision.');
