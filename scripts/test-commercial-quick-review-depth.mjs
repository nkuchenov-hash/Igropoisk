#!/usr/bin/env node
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8'),fail=message=>{throw new Error(message)};
const wrapper=read('scripts/build-review-bootstrap-commercial.mjs'),expander=read('scripts/expand-review-bootstrap-local.mjs'),renderer=read('scripts/render-review-bootstrap.mjs'),workflow=read('.github/workflows/game-post-create-enrichment.yml');
for(const marker of ["QUICK_REVIEW_MIN_WORDS:'180'",'expand-review-bootstrap-local.mjs','render-review-bootstrap.mjs','if(words<220)','audit-review-bootstrap-local.mjs'])if(!wrapper.includes(marker))fail(`Commercial quick-review wrapper missing: ${marker}`);
if(wrapper.indexOf('expand-review-bootstrap-local.mjs')>wrapper.indexOf('if(words<220)'))fail('Commercial expansion is not executed before the final 220-word publication assertion');
if(wrapper.indexOf('render-review-bootstrap.mjs')>wrapper.indexOf('audit-review-bootstrap-local.mjs'))fail('Expanded prose is not rendered before the factual/language audit');
for(const marker of ['260–360','EVIDENCE','words<220','paragraphs||[]).length<2','commercial_depth_gate:true','canonical_score_eligible'])if(!expander.includes(marker))fail(`Grounded commercial expander missing: ${marker}`);
for(const marker of ['data/review-bootstrap/${slug}.json',"path.join(root,'article',slug,'index.html')",'data/reviews/${slug}.json'])if(!renderer.includes(marker))fail(`Bootstrap renderer does not synchronize ${marker}`);
const pushStart=workflow.indexOf('  push:'),pullStart=workflow.indexOf('  pull_request:');if(pushStart<0||pullStart<pushStart)fail('Workflow trigger blocks missing');
const pushBlock=workflow.slice(pushStart,pullStart),pullBlock=workflow.slice(pullStart,workflow.indexOf('\npermissions:',pullStart));
for(const forbidden of ["data/game-enrichment-requests/*.json","game/*/index.html"])if(pushBlock.includes(forbidden))fail(`Request/page trigger still duplicates merged-PR execution through push: ${forbidden}`);
for(const required of ["data/game-enrichment-requests/*.json","game/*/index.html"])if(!pullBlock.includes(required))fail(`Merged-PR trigger lost required path: ${required}`);
for(const marker of ['scripts/expand-review-bootstrap-local.mjs','scripts/render-review-bootstrap.mjs','node --check scripts/expand-review-bootstrap-local.mjs','node --check scripts/render-review-bootstrap.mjs','node scripts/test-commercial-quick-review-depth.mjs'])if(!workflow.includes(marker))fail(`Commercial depth workflow wiring missing: ${marker}`);
console.log('Commercial quick-review depth contract passed: draft threshold may be 180 internally, but publication remains >=220 with grounded expansion, factual audit and one merged-PR trigger.');
