#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const workflow=read('.github/workflows/game-post-create-enrichment.yml');
const publisher=read('scripts/publish-game-post-create-overlay.mjs');
const dna=read('scripts/materialize-post-create-game-dna.mjs');
const builder=read('scripts/build-game-dna.mjs');
const validator=read('scripts/validate-game-dna.mjs');
const media=read('scripts/enrich-game-media-from-sources.mjs');
const quick=read('scripts/build-review-bootstrap-local.mjs');
const runner=read('scripts/run-game-post-create-enrichment.mjs');
const fail=message=>{throw new Error(message)};

for(const marker of ['scripts/materialize-post-create-game-dna.mjs','Materialize Game DNA and similarity immediately after page creation','Publish Game DNA checkpoint before network enrichment',"POST_CREATE_PUBLISH_PHASE: dna","game/*/index.html"])if(!workflow.includes(marker))fail(`Fast post-create Game DNA workflow missing: ${marker}`);
const dnaAt=workflow.indexOf('Materialize Game DNA and similarity immediately after page creation'),dnaPublishAt=workflow.indexOf('Publish Game DNA checkpoint before network enrichment'),bootstrapAt=workflow.indexOf('Bootstrap series, rating and bounded media');
if(dnaAt<0||dnaPublishAt<dnaAt||bootstrapAt<dnaPublishAt)fail('Game DNA is not checkpointed before network-heavy bootstrap');
for(const marker of ["'data/game-dna'","'data/similarity'"])if(!publisher.includes(marker))fail(`Post-create publisher does not persist ${marker}`);
for(const marker of ['scripts/build-game-dna.mjs','scripts/validate-game-dna.mjs','scripts/build-similarity-index.mjs','data/parser-runs/game-post-create-dna.json','missingDnaSlugs','game/${slug}/index.html',"game_dna:'ready'","dna:'ready'",'validation_scope:\'per_game_targeted_commercial_quality\'',"run('scripts/validate-game-dna.mjs',[slug])",'publication_policy:\'only_valid_commercial_quality_dna_changes_survive_to_checkpoint\'','ready_slugs:validDnaSlugs','previousDnaText','previousIndexText','restoreText'])if(!dna.includes(marker))fail(`Post-create DNA materializer missing commercial-quality safeguard: ${marker}`);
if(dna.includes('process.exitCode=2'))fail('Independent DNA/similarity failures can still block the valid DNA checkpoint');
for(const marker of ['data/reviews/${slug}.json','acceptedProfessionalReview','professional_review_evidence','turn-based combat','ranged combat','create your character','side quest','story-rich','strongFastPacingEvidence','derived_hints: reviewEvidence.hints'])if(!builder.includes(marker))fail(`Game DNA builder is not using bounded professional review evidence correctly: ${marker}`);
if(!builder.includes('...reviewEvidence.hints')||builder.includes('    reviewEvidence.text,\n    ...reviewEvidence.hints'))fail('Raw professional review prose can still bleed into the generic DNA keyword matcher');
for(const marker of ['const requested = new Set(process.argv.slice(2)','requested.size ? allFiles.filter','requested DNA entity is missing',"requested.size ? 'targeted commercial-quality' : 'catalog'",'ready_for_similarity','needs_enrichment','requires >=9 populated axes and >=4 core axes'])if(!validator.includes(marker))fail(`Targeted commercial-quality Game DNA validation missing: ${marker}`);
for(const marker of ['targetScreens','Math.min(15','GAME_MEDIA_TARGET_SCREENSHOTS','discoveryNeeded','discovery_skipped','selectDiverse','candidateLimit=Math.min(72'])if(!media.includes(marker))fail(`Bounded useful-media policy missing: ${marker}`);
if(media.includes('.slice(0,48)')||media.includes('candidateRecords.length>=240'))fail('Legacy excessive 48-shot/240-probe media policy is still active');
if(!quick.includes('Math.max(180')||!quick.includes('QUICK_REVIEW_MIN_WORDS||220'))fail('Quick review editorial floor/default contract is missing');
if(!quick.includes('QUICK_REVIEW_TIMEOUT_MS||300000')||!quick.includes("provider:'local-ollama'"))fail('Quick review is not using the durable local editorial path');
if(quick.includes('models.github.ai')||quick.includes("provider:'github-models'"))fail('Retired GitHub Models dependency is still present in quick-review production code');
if(!quick.includes('&quot;'))fail('Quick review HTML escaping is malformed');
for(const marker of ['const quickOnly=doQuickReview&&!doFullReview','quickOnly?!quickReviewReady(slug):!reviewReady(slug)',"String(b.request.requested_at||'').localeCompare(String(a.request.requested_at||''))",'wasAttempted=attempted.has(slug)','run_attempts:Number(request.run_attempts||0)+(wasAttempted?1:0)','reviewExhausted=wasAttempted'])if(!runner.includes(marker))fail(`Post-create review queue starvation safeguard missing: ${marker}`);
console.log('Post-create semantic-precision DNA, durable local quick review, fair queue and bounded media contract passed.');
