#!/usr/bin/env node
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const wrapper=fs.readFileSync('scripts/build-review-bootstrap-commercial.mjs','utf8');
const grounded=fs.readFileSync('scripts/build-review-bootstrap-commercial-grounded.mjs','utf8');
const fail=message=>{throw new Error(message)};

for(const forbidden of ['models: read','GITHUB_REVIEW_MODEL','GITHUB_AUDIT_MODEL','EDITORIAL_PROVIDER','scripts/lib/github-editorial-model.mjs'])if(workflow.includes(forbidden))fail(`Retired/external text-model dependency remains in commercial quick path: ${forbidden}`);
for(const marker of ['build-review-bootstrap-commercial-grounded.mjs',"provider==='deterministic-evidence-v1'",'grounding_audit?.passed===true','editorial_quality?.passed===true'])if(!wrapper.includes(marker))fail(`Commercial deterministic wrapper missing: ${marker}`);
for(const marker of ["provider:'deterministic-evidence-v1'",'grounded_claims:8','claim_support:claimSupport','usedPublications.size<3','words<220||words>500','lowercase latin intrusions','unsupported numbers'])if(!grounded.includes(marker))fail(`Deterministic professional-evidence builder missing: ${marker}`);
for(const marker of ['Build and verify deterministic grounded quick reviews','Publish quick-review checkpoint before full upgrades','Verify published quick reviews on production Pages','Restore local full-review model cache','Start local full-review model service','Ensure local text model for optional full upgrade','Ensure optional local vision model for full upgrades','Run bounded full-review upgrades for event-scoped games'])if(!workflow.includes(marker))fail(`Quick/full phase wiring missing: ${marker}`);
const quickAt=workflow.indexOf('Build and verify deterministic grounded quick reviews'),quickPublishAt=workflow.indexOf('Publish quick-review checkpoint before full upgrades'),liveAt=workflow.indexOf('Verify published quick reviews on production Pages'),localAt=workflow.indexOf('Restore local full-review model cache');
if(quickAt<0||quickPublishAt<quickAt||liveAt<quickPublishAt||localAt<liveAt)fail('Local models can still block deterministic quick-review publication/live proof');
for(const marker of ['LOCAL_TEXT_MODEL: qwen3:4b','LOCAL_EDITORIAL_MODEL: qwen3:4b','LOCAL_VISION_MODEL: qwen3-vl:4b'])if(!workflow.includes(marker))fail(`Optional local full-review model wiring missing: ${marker}`);
const cacheBlock=workflow.slice(workflow.indexOf('- name: Restore local full-review model cache'),workflow.indexOf('- name: Start local full-review model service'));
if(!cacheBlock.includes("if: vars.POST_CREATE_FULL_UPGRADE == 'true'")||!cacheBlock.includes('continue-on-error: true'))fail('Local model cache is not explicit opt-in/non-blocking');
const startBlock=workflow.slice(workflow.indexOf('- name: Start local full-review model service'),workflow.indexOf('- name: Ensure local text model for optional full upgrade'));
if(!startBlock.includes("if: vars.POST_CREATE_FULL_UPGRADE == 'true'")||!startBlock.includes('continue-on-error: true')||!startBlock.includes('id: full_model_service'))fail('Optional local model service can still run by default or fail the commercial run');
const textBlock=workflow.slice(workflow.indexOf('- name: Ensure local text model for optional full upgrade'),workflow.indexOf('- name: Ensure optional local vision model for full upgrades'));
const visionBlock=workflow.slice(workflow.indexOf('- name: Ensure optional local vision model for full upgrades'),workflow.indexOf('- name: Run bounded full-review upgrades for event-scoped games'));
for(const [name,block] of [['text',textBlock],['vision',visionBlock]])if(!block.includes("vars.POST_CREATE_FULL_UPGRADE == 'true' && steps.full_model_service.outcome == 'success'"))fail(`${name} full-review model can run without explicit opt-in`);
const fullBlock=workflow.slice(workflow.indexOf('- name: Run bounded full-review upgrades for event-scoped games'),workflow.indexOf('- name: Publish full-review checkpoint conflict-safely'));
if(!fullBlock.includes("vars.POST_CREATE_FULL_UPGRADE == 'true' && steps.full_model_service.outcome == 'success'")||!fullBlock.includes('continue-on-error: true')||!fullBlock.includes('id: full_upgrade'))fail('Optional full-review upgrade is not explicit opt-in/non-blocking');
const publishBlock=workflow.slice(workflow.indexOf('- name: Publish full-review checkpoint conflict-safely'));
if(!publishBlock.includes("vars.POST_CREATE_FULL_UPGRADE == 'true' && steps.full_upgrade.outcome == 'success'"))fail('Failed or non-opted-in full-review output can still be published');

console.log('Quick-review model wiring passed: commercial bootstrap finishes after live Pages proof; expensive local full-review work runs only with explicit POST_CREATE_FULL_UPGRADE=true and cannot invalidate the commercial run.');
