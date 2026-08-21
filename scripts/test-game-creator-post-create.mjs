#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const fail=message=>{throw new Error(message)};
const requireMarkers=(text,markers,label)=>{for(const marker of markers)if(!text.includes(marker))fail(`${label} missing: ${marker}`)};
const forbidMarkers=(text,markers,label)=>{for(const marker of markers)if(text.includes(marker))fail(`${label} contains forbidden marker: ${marker}`)};

const creator=read('scripts/ensure-game-page.mjs');
const verified=read('scripts/lib/verified-game-import.mjs');
const series=read('scripts/materialize-known-series.mjs');
const runner=read('scripts/run-game-post-create-enrichment.mjs');
const publisher=read('scripts/publish-game-post-create-overlay.mjs');
const media=read('scripts/enrich-game-media-from-sources.mjs');
const reviewDiscovery=read('scripts/discover-review-sources-web.mjs');
const criticV15=read('scripts/discover-review-sources-web-v15.mjs');
const postCreateResearch=read('scripts/prepare-post-create-review-research.mjs');
const reviewRegistry=read('scripts/lib/review-source-registry.mjs');
const scoreExtractor=read('scripts/lib/review-score-extractor.mjs');
const commercial=read('scripts/build-review-bootstrap-commercial.mjs');
const grounded=read('scripts/build-review-bootstrap-commercial-grounded.mjs');
const smoke=read('scripts/smoke-published-review-pages.mjs');
const quickVerifier=read('scripts/verify-post-create-quick-reviews.mjs');
const reviewFeed=read('scripts/materialize-review-publication-feed.mjs');
const runtime=read('game/_shared/game-page-materialized-data.js');
const verifiedWorkflow=read('.github/workflows/verified-game-import-fast.yml');
const newsWorkflow=read('.github/workflows/news-game-page-fast.yml');
const workflow=read('.github/workflows/game-post-create-enrichment.yml');
const continuation=read('.github/workflows/game-post-create-continuation.yml');
const resolver=read('scripts/resolve-post-create-event-targets.mjs');
const classifier=read('scripts/classify-review-importance.mjs');
const importance=read('scripts/lib/review-importance.mjs');
const orchestrator=read('scripts/run-commercial-review-contract.mjs');
const wrapper=read('scripts/synthesize-commercial-review-resilient-wrapper.mjs');

requireMarkers(creator,['series: series || null','data/game-enrichment-requests/${slug}.json',"reason: 'post_create_enrichment_must_not_block_base_page'",'reviewNeeded = released && !reviewReady'],'Game Creator base-page/post-create boundary');
if(!verified.includes('verified_series_attached')||!series.includes('canonical_series_backfilled'))fail('Canonical series preservation/backfill regressed');
requireMarkers(runner,["'all','bootstrap','review','quick-review','full-review'",'commercialMediaReady',"run('unified-commercial-review','scripts/run-commercial-review-contract.mjs',slugs)"],'Unified post-create runner contract');
requireMarkers(media,["provider:'verified-source-page'",'search engines may aid source discovery','removed_stale_screenshots','media.url_template'],'Verified bounded media provenance contract');
if(!reviewDiscovery.includes('discover-review-sources-web-v15.mjs'))fail('Review discovery no longer routes through critic index');
requireMarkers(criticV15,['metacritic','historical-critic-index-attribution','critic-index-attribution','metascore_as_vote:false','user_scores_as_votes:false','professional_only:true'],'Professional critic-index policy');
requireMarkers(postCreateResearch,['isTrustedEditorialScore','historical_index_preserved','post_create_verified_corpus_preserved','metascore_as_vote:false','user_scores_as_votes:false'],'Verified review-corpus preservation');
if(!reviewRegistry.includes('user_generated_review')||!reviewRegistry.includes('от\\s+пользователя'))fail('User-generated reviews are not excluded');
requireMarkers(scoreExtractor,["method==='historical-critic-index-attribution'","method==='critic-index-attribution'","evidence.index_source==='metacritic'",'evidence.aggregate_score_used!==true','evidence.user_score_used!==true'],'Critic score evidence contract');
requireMarkers(commercial,['build-review-bootstrap-commercial-grounded.mjs',"provider==='deterministic-evidence-v1'",'grounding_audit?.passed===true','editorial_quality?.passed===true'],'Deterministic commercial quick-review wrapper');
forbidMarkers(commercial,['build-review-bootstrap-commercial-local.mjs','audit-review-bootstrap-local.mjs'],'Commercial quick review');
requireMarkers(grounded,["source?.canonical_score_eligible!==false","source?.source_kind==='review'",'claimSupport.length!==8','usedPublications.size<3',"provider:'deterministic-evidence-v1'",'claim_support:claimSupport'],'Grounded semantic quick-review contract');
requireMarkers(smoke,['https://${owner}.github.io/${name}','REVIEW_SMOKE_ATTEMPTS','expectedTitle','expectedScore','data-article='],'Live review verification');
if(!quickVerifier.includes("editorial_quality?.passed===true")||!quickVerifier.includes("grounding_audit?.passed===true")||!quickVerifier.includes('process.exit(2)'))fail('Quick-review verifier is not fail-closed');
if(!reviewFeed.includes('bootstrapDesired')||!reviewFeed.includes("feed.igropoisk_article.review_stage==='full'"))fail('Full review can erase valid quick factual material');
if(!publisher.includes("'data/review-bootstrap'")||!publisher.includes('createPrWithRetry'))fail('Conflict-safe quick-review publisher contract regressed');
if(!runtime.includes('renderEnrichedMedia(draft,title)'))fail('Enriched media is not exposed by game runtime');
if(!/paths=\([^\n]*data\/game-enrichment-requests/.test(verifiedWorkflow)||!/paths=\([^\n]*data\/game-enrichment-requests/.test(newsWorkflow))fail('Fast creator workflow discards enrichment requests');

forbidMarkers(workflow,['models: read','GITHUB_REVIEW_MODEL','GITHUB_AUDIT_MODEL','EDITORIAL_PROVIDER','scripts/lib/github-editorial-model.mjs','OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}','Run accelerated full commercial review upgrade',"COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR: 'true'",'POST_CREATE_FULL_UPGRADE'],'Game-page workflow');
requireMarkers(workflow,[
  'Build and verify deterministic grounded quick reviews',
  'build-review-bootstrap-commercial.mjs',
  'verify-post-create-quick-reviews.mjs',
  'POST_CREATE_PUBLISH_PHASE: quick-review',
  'Verify published quick material on production Pages',
  'Determine whether a full editorial review is required',
  'classify-review-importance.mjs',
  'Publish review-importance decision',
  'Finalize page when a full review is not required',
  'Restore local full-review model cache',
  'Start local full-review model service',
  'Ensure required local review models',
  'Save local full-review model cache before generation',
  'Run required local full commercial review upgrade',
  'Persist incomplete full-review state for automatic continuation',
  'Record automatic continuation requirement',
  'POST_CREATE_PUBLISH_PHASE: commercial-review',
  'Verify full commercial reviews on production Pages'
],'Importance-gated post-create workflow');

const quickAt=workflow.indexOf('Build and verify deterministic grounded quick reviews');
const quickPubAt=workflow.indexOf('POST_CREATE_PUBLISH_PHASE: quick-review');
const liveAt=workflow.indexOf('Verify published quick material on production Pages');
const importanceAt=workflow.indexOf('Determine whether a full editorial review is required');
const localAt=workflow.indexOf('Restore local full-review model cache');
const fullAt=workflow.indexOf('Run required local full commercial review upgrade');
const publishAt=workflow.indexOf('Publish full commercial review checkpoint');
if([quickAt,quickPubAt,liveAt,importanceAt,localAt,fullAt,publishAt].some(x=>x<0)||!(quickAt<quickPubAt&&quickPubAt<liveAt&&liveAt<importanceAt&&importanceAt<localAt&&localAt<fullAt&&fullAt<publishAt))fail('Post-create order must be quick factual live -> importance decision -> local full review only when required -> publication');

const importanceCondition="steps.importance.outputs.full_upgrade == 'true'";
const cacheBlock=workflow.slice(workflow.indexOf('- name: Restore local full-review model cache'),workflow.indexOf('- name: Start local full-review model service'));
const serviceBlock=workflow.slice(workflow.indexOf('- name: Start local full-review model service'),workflow.indexOf('- name: Ensure required local review models'));
const fullBlock=workflow.slice(workflow.indexOf('- name: Run required local full commercial review upgrade'),workflow.indexOf('- name: Persist incomplete full-review state for automatic continuation'));
const publishFullBlock=workflow.slice(workflow.indexOf('- name: Publish full commercial review checkpoint'),workflow.indexOf('- name: Resolve completed full reviews for live smoke'));
for(const [name,block] of [['cache',cacheBlock],['service',serviceBlock],['full',fullBlock]])if(!block.includes(importanceCondition))fail(`${name} can start without a required editorial-importance decision`);
if(!serviceBlock.includes('continue-on-error: true')||!fullBlock.includes('continue-on-error: true')||!fullBlock.includes('id: full_upgrade'))fail('Local full-review worker cycle is not retry-safe');
if(!publishFullBlock.includes(importanceCondition)||!publishFullBlock.includes("steps.full_upgrade.outcome == 'success'"))fail('Failed/non-required full review can publish as final');
if(!workflow.includes('cancel-in-progress: true')||workflow.includes('fetch-depth: 0'))fail('Concurrency or bounded-checkout protection regressed');

requireMarkers(resolver,["request?.force_full_review===true||request?.review_importance?.status==='required'||request?.review_importance?.required===true","importancePending(request)","review_selection:'igromania-or-review-volume'",'full_upgrade=${fullUpgrade}','importance_needed=${importanceNeeded}'],'Event target resolver');
if(resolver.includes('request?.full_review_required===true'))fail('Resolver still treats the legacy full_review_required flag as an editorial decision');
requireMarkers(classifier,['igromania','secondary_minimum_independent_full_reviews','review_importance','OPENAI_API_KEY:\'\'','COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:\'false\''],'Review-importance classifier');
requireMarkers(importance,['igromania','professional_review_volume','exhaustive'],'Review-importance policy');

for(const text of [workflow,orchestrator,wrapper])if(/OPENAI_API_KEY:\s*\$\{\{/.test(text))fail('Paid OpenAI API credential is exposed in the page/review lifecycle');
requireMarkers(orchestrator,["OPENAI_API_KEY:''","COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'","provider_policy:'local_only'"],'Local-only commercial orchestrator');
requireMarkers(wrapper,["OPENAI_API_KEY:''","COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'"],'Local-only resilient wrapper');
requireMarkers(continuation,['workflow_run:',"workflows: ['Enrich newly created Игропоиск games']",'Dispatch next worker cycle','gh workflow run game-post-create-enrichment.yml --ref staging'],'Automatic continuation workflow');

console.log('Game Creator post-create contract passed: every released game gets an immediate canonical page and grounded quick factual material; editorial importance is classified from Игромания first and professional-review volume second; only required games start the local-only persistent 3000+ review lifecycle, and incomplete required work continues automatically.');
