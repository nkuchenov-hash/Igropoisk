#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const workflow=read('.github/workflows/game-post-create-enrichment.yml');
const publisher=read('scripts/publish-game-post-create-overlay.mjs');
const dna=read('scripts/materialize-post-create-game-dna.mjs');
const media=read('scripts/enrich-game-media-from-sources.mjs');
const quick=read('scripts/build-review-bootstrap-local.mjs');
const fail=message=>{throw new Error(message)};

for(const marker of ['scripts/materialize-post-create-game-dna.mjs','Materialize Game DNA and similarity immediately after page creation','Publish Game DNA checkpoint before network enrichment',"POST_CREATE_PUBLISH_PHASE: dna","game/*/index.html"])if(!workflow.includes(marker))fail(`Fast post-create Game DNA workflow missing: ${marker}`);
const dnaAt=workflow.indexOf('Materialize Game DNA and similarity immediately after page creation'),dnaPublishAt=workflow.indexOf('Publish Game DNA checkpoint before network enrichment'),bootstrapAt=workflow.indexOf('Bootstrap series, rating and bounded media');
if(dnaAt<0||dnaPublishAt<dnaAt||bootstrapAt<dnaPublishAt)fail('Game DNA is not checkpointed before network-heavy bootstrap');
for(const marker of ["'data/game-dna'","'data/similarity'"])if(!publisher.includes(marker))fail(`Post-create publisher does not persist ${marker}`);
for(const marker of ['scripts/build-game-dna.mjs','scripts/validate-game-dna.mjs','scripts/build-similarity-index.mjs','data/parser-runs/game-post-create-dna.json','missingDnaSlugs','game/${slug}/index.html',"game_dna:'ready'","dna:'ready'"])if(!dna.includes(marker))fail(`Post-create DNA materializer missing: ${marker}`);
for(const marker of ['targetScreens','Math.min(15','GAME_MEDIA_TARGET_SCREENSHOTS','discoveryNeeded','discovery_skipped','selectDiverse','candidateLimit=Math.min(72'])if(!media.includes(marker))fail(`Bounded useful-media policy missing: ${marker}`);
if(media.includes('.slice(0,48)')||media.includes('candidateRecords.length>=240'))fail('Legacy excessive 48-shot/240-probe media policy is still active');
if(!quick.includes('QUICK_REVIEW_MIN_WORDS||180'))fail('Quick review still rejects concise source-grounded drafts by default');
if(!quick.includes('"':'&quot;'))fail('Quick review HTML escaping is malformed');
console.log('Post-create DNA and bounded media contract passed.');
