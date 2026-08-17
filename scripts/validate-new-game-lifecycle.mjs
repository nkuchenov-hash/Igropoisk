#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(),errors=[];
const read=relative=>{try{return fs.readFileSync(path.join(root,relative),'utf8')}catch{errors.push(`missing ${relative}`);return''}};
const need=(text,needle,message)=>{if(!text.includes(needle))errors.push(message)};

const runnerEntry=read('scripts/run-content-pipeline.mjs');
const runner=read('scripts/run-content-pipeline-core.mjs');
const enrichEntry=read('scripts/run-game-catalog-enrichment.mjs');
const enrich=read('scripts/run-game-catalog-enrichment-core.mjs');
const localRuntime=read('scripts/ensure-local-editorial-runtime.mjs');
const qualityLoop=read('scripts/quality-control-loop-v4.mjs');
const news=read('.github/workflows/news-pipeline.yml');
const workflow=read('.github/workflows/content-pipeline.yml');
const planNews=read('scripts/plan-news-game-pages.mjs');
const importPlanner=read('scripts/plan-game-imports.mjs');
const importAdapter=read('scripts/lib/verified-game-import.mjs');
const parser=read('scripts/parse-game-data.mjs');
const similarity=read('scripts/build-similarity-index.mjs');
const dna=read('scripts/build-game-dna.mjs');
const orchestrator=read('scripts/orchestrate-content-v6.mjs');
const publisher=read('scripts/materialize-news-production-pages.mjs');
const diff=read('scripts/validate-automation-publish-diff.mjs');

need(news,'content-pipeline.yml','news must dispatch canonical lifecycle');
need(planNews,'plan-game-imports.mjs','news lifecycle ingress must also process deliberate verified imports');
need(importPlanner,'data/game-import-requests.json','verified import planner must use the canonical import request queue');
need(importPlanner,'verified_import:true','verified import tasks must be explicitly marked for the runtime');
need(importPlanner,'data/parser-output/','non-Steam verified imports must materialize a parser seed');
need(importAdapter,'registerVerifiedGameImports','verified game import adapter is missing');
need(importAdapter,'full_page_import_requires_released_game','future imports must not accidentally become public pages');
need(importAdapter,'non_steam_full_page_import_requires_verified_parser_seed','non-Steam full-page imports must require verified structured data');
need(workflow,"'data/game-import-requests.json'",'verified import queue changes must trigger the lifecycle immediately');
need(workflow,"'scripts/plan-game-imports.mjs'",'verified import planner changes must trigger the lifecycle immediately');
need(workflow,"'scripts/lib/verified-game-import.mjs'",'verified import adapter changes must trigger the lifecycle immediately');
need(workflow,'node scripts/test-verified-game-import.mjs','content lifecycle must run the verified-import contract test');
need(parser,'verified_canonical_game_registry','verified imports must preserve the canonical Game Registry title against storefront edition titles');
need(parser,'store_title','storefront edition titles must remain available as metadata after canonicalization');
need(parser,'canonical_game_registry_original_release','storefront parsing must preserve the canonical original release date');

need(runnerEntry,'ensureLocalEditorialRuntime','normal content execution must bootstrap a local editorial model');
need(enrichEntry,'ensureLocalEditorialRuntime','catalog review maintenance must bootstrap a local editorial model');
need(localRuntime,'ollama','local editorial runtime must use the on-runner Ollama service');
need(localRuntime,'LOCAL_EDITORIAL_MODEL','local editorial runtime must use the configured local model');
need(qualityLoop,'synthesize-review-local.mjs','review QC must have a local article synthesis path');
need(qualityLoop,'enrich-review-media-local.mjs','review QC must have a local multimodal media audit path');
need(qualityLoop,'audit-review-language-local.mjs','review QC must have a local Russian editorial audit path');
need(qualityLoop,'enrich-review-explicit-scores.mjs','review QC must re-check direct publisher pages for explicit scores');
need(qualityLoop,'rebind-existing-review.mjs','review QC must reuse a valid existing article before regenerating prose');

need(runner,'ensureMandatoryReview','prepared released games must inject a same-run canonical review');
need(runner,'page-finalize-after-review','a green review must finalize the game page in the same run');
need(runner,'reused verified non-Steam import parser seed','non-Steam verified imports must bypass Steam lookup');
need(runner,'build-game-dna.mjs','page work must refresh persisted Game DNA');
need(enrich,'validate-game-dna.mjs','catalog enrichment must validate persisted Game DNA');
need(similarity,'game-dna-weighted-v1','similarity must use Game DNA');
need(dna,'data/game-dna','Game DNA must persist as canonical data');
need(orchestrator,'review_score','released games must use the canonical review score');
need(publisher,'data/game-dna','production promotion must include Game DNA');
need(diff,'data/game-dna/','automation publication allowlist must include Game DNA');
for(const required of ['prepare-guide-research.mjs','enrich-game-relations.mjs','quality-control-loop.mjs'])need(workflow,required,`lifecycle missing ${required}`);
if(runner.includes('data/ratings/')||enrich.includes('data/ratings/'))errors.push('legacy data/ratings must not be an editorial score authority');

if(errors.length){console.error(`New-game lifecycle contract failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log('New-game lifecycle contract passed.');
