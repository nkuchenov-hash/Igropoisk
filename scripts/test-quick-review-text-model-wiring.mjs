#!/usr/bin/env node
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const wrapper=fs.readFileSync('scripts/build-review-bootstrap-commercial.mjs','utf8');
const grounded=fs.readFileSync('scripts/build-review-bootstrap-commercial-grounded.mjs','utf8');
const fail=message=>{throw new Error(message)};

for(const forbidden of ['models: read','GITHUB_REVIEW_MODEL','GITHUB_AUDIT_MODEL','EDITORIAL_PROVIDER','scripts/lib/github-editorial-model.mjs'])if(workflow.includes(forbidden))fail(`Retired/external text-model dependency remains in commercial quick path: ${forbidden}`);
for(const marker of ['build-review-bootstrap-commercial-grounded.mjs',"provider==='deterministic-evidence-v1'",'grounding_audit?.passed===true','editorial_quality?.passed===true'])if(!wrapper.includes(marker))fail(`Commercial deterministic wrapper missing: ${marker}`);
for(const marker of ["provider:'deterministic-evidence-v1'",'grounded_claims:8','claim_support:claimSupport','usedPublications.size<3','words<220||words>500','lowercase latin intrusions','unsupported numbers'])if(!grounded.includes(marker))fail(`Deterministic professional-evidence builder missing: ${marker}`);
for(const marker of ['Build and verify deterministic grounded quick reviews','Publish quick-review checkpoint before full upgrades','Restore local full-review model cache','Start local full-review model service','Ensure local text model for optional full upgrade','Ensure optional local vision model for full upgrades'])if(!workflow.includes(marker))fail(`Quick/full phase wiring missing: ${marker}`);
const quickAt=workflow.indexOf('Build and verify deterministic grounded quick reviews'),quickPublishAt=workflow.indexOf('Publish quick-review checkpoint before full upgrades'),localAt=workflow.indexOf('Restore local full-review model cache');
if(quickAt<0||quickPublishAt<quickAt||localAt<quickPublishAt)fail('Local models can still block the deterministic quick-review checkpoint');
for(const marker of ['LOCAL_TEXT_MODEL: qwen3:4b','LOCAL_EDITORIAL_MODEL: qwen3:4b','LOCAL_VISION_MODEL: qwen3-vl:4b'])if(!workflow.includes(marker))fail(`Optional local full-review model wiring missing: ${marker}`);

console.log('Quick-review model wiring passed: commercial bootstrap is deterministic and model-independent; local qwen models start only after the published quick-review checkpoint for optional full upgrades.');
