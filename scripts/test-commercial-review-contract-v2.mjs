#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {strengthenJsonSchema} from './lib/local-editorial-model.mjs';

const read=path=>fs.readFileSync(path,'utf8');
const json=path=>JSON.parse(read(path));
const contract=json('config/review-commercial-contract.json');
const post=read('.github/workflows/game-post-create-enrichment.yml');
const continuation=read('.github/workflows/game-post-create-continuation.yml');
const manual=read('.github/workflows/review-synthesis.yml');
const orchestrator=read('scripts/run-commercial-review-contract.mjs');
const resolver=read('scripts/resolve-post-create-event-targets.mjs');
const importance=read('scripts/classify-review-importance.mjs');
const importanceLib=read('scripts/lib/review-importance.mjs');
const postRunner=read('scripts/run-game-post-create-enrichment.mjs');
const corpus=read('scripts/build-review-article-corpus-resilient.mjs');
const synthesis=read('scripts/synthesize-commercial-review-resilient.mjs');
const wrapper=read('scripts/synthesize-commercial-review-resilient-wrapper.mjs');
const metaPreflight=read('scripts/prepare-sectioned-review-meta.mjs');
const carousel=read('scripts/enrich-commercial-review-media-resilient.mjs');
const local=read('scripts/lib/local-editorial-model.mjs');

assert.ok(Number(contract.article?.minimum_words)>=3000,'commercial article minimum must be at least 3000 words');
assert.ok(Number(contract.article?.minimum_words_per_section)>=260,'commercial section minimum must remain at least 260 words');
assert.ok(Number(contract.article?.lead_minimum_words)>=120,'commercial lead minimum must remain at least 120 words');
assert.ok(Number(contract.game_media?.minimum_unique_screenshots)>=15,'commercial game media minimum must be at least 15 screenshots');
assert.ok(Number(contract.game_media?.target_unique_screenshots)>=20,'commercial game media target must be at least 20 screenshots');
assert.equal(contract.game_media?.artwork_must_never_enter_screenshot_pool,true,'artwork must be separate from screenshots');
assert.equal(contract.lifecycle?.forbid_attempt_exhaustion_for_required_full_reviews,true,'required full reviews must never exhaust the game lifecycle');
assert.equal(contract.lifecycle?.keep_working_until_page_complete,true,'page lifecycle must continue until complete');
assert.equal(contract.review_importance?.primary_reference_source_id,'igromania','Игромания must be the primary editorial importance signal');
assert.equal(contract.review_importance?.primary_reference_full_review_requires_full_article,true,'Игромания review must require a full Игропоиск article');
assert.ok(Number(contract.review_importance?.secondary_minimum_independent_full_reviews)>=8,'secondary importance threshold must require substantial independent review coverage');
assert.equal(contract.review_importance?.not_required_only_after_exhaustive_discovery,true,'below-threshold games cannot be declared not-required before exhaustive discovery');
assert.equal(contract.review_importance?.legacy_full_review_required_field_is_not_a_force_override,true,'legacy full_review_required must not bypass editorial selection');
assert.equal(contract.publication?.full_article_required_only_when_review_importance_required,true,'full articles must be gated by editorial importance');

const importanceTest=spawnSync(process.execPath,['scripts/test-review-importance-gate.mjs'],{encoding:'utf8'});
assert.equal(importanceTest.status,0,importanceTest.stderr||importanceTest.stdout||'review importance test failed');
for(const marker of ['classifyReviewImportance','OPENAI_API_KEY:\'\'','COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:\'false\'','full_review_required:required','review_importance'])assert.ok(importance.includes(marker),`importance classifier contract missing: ${marker}`);
for(const marker of ['igromania_full_review_found','professional_review_volume_','exhaustive_discovery_below_'])assert.ok(importanceLib.includes(marker),`importance decision branch missing: ${marker}`);
assert.ok(resolver.includes("request?.review_importance?.status==='required'"),'target resolver does not respect persisted importance');
assert.ok(!resolver.includes("released_incomplete_requires_full_review:true"),'resolver still forces full review for every released incomplete game');

assert.ok(!/OPENAI_API_KEY:\s*\$\{\{/.test(post),'game-page workflow must never expose paid OpenAI API credentials');
assert.ok(!post.includes("vars.POST_CREATE_FULL_UPGRADE == 'true'"),'global full-review opt-in must not bypass editorial importance');
assert.ok(post.includes('Determine whether a full editorial review is required'),'game-page workflow lacks editorial importance selection');
assert.ok(post.includes('node scripts/classify-review-importance.mjs'),'game-page workflow does not execute importance classifier');
assert.ok(post.includes("steps.importance.outputs.full_upgrade == 'true'"),'local full review is not gated by importance output');
assert.ok(post.includes("steps.importance.outputs.full_upgrade != 'true' && steps.importance.outputs.pending != 'true'"),'non-important page finalization path is missing');
assert.ok(post.includes('Finalize page when a full review is not required'),'non-important games cannot complete without a 3000-word review');
assert.ok(post.includes('Publish review-importance decision'),'importance decision is not persisted between cycles');
assert.ok(post.includes('Record unresolved editorial importance for continuation'),'unresolved importance cannot safely continue discovery');

const quickAt=post.indexOf('Build and verify deterministic grounded quick reviews');
const quickPublishAt=post.indexOf('POST_CREATE_PUBLISH_PHASE: quick-review');
const quickSmokeAt=post.indexOf('Verify published quick material on production Pages');
const importanceAt=post.indexOf('Determine whether a full editorial review is required');
const ollamaAt=post.indexOf('Start local full-review model service');
assert.ok(quickAt>=0&&quickPublishAt>quickAt&&quickSmokeAt>quickPublishAt&&importanceAt>quickSmokeAt&&ollamaAt>importanceAt,'required order is quick factual page -> live smoke -> importance decision -> optional local full review');
assert.ok(post.includes('actions/cache/restore@v4')&&post.includes('actions/cache/save@v4'),'local model cache must persist before long generation');
assert.ok(post.includes('LOCAL_TEXT_MODEL: qwen3:4b')&&post.includes('LOCAL_WRITER_MODEL: qwen3:0.6b'),'required local review models are not declared');
assert.ok(post.includes("github.event_name == 'pull_request' && github.event.pull_request.number || 'staging'"),'explicit merged game requests must not share the serialized backlog concurrency lock');
assert.ok(post.includes('cancel-in-progress: true'),'stale same-group background runs must not block the newest page lifecycle run');
assert.ok(!post.includes('fetch-depth: 0'),'post-create critical path must keep bounded checkout depth');

assert.ok(!/OPENAI_API_KEY:\s*\$\{\{/.test(manual),'manual review workflow must not expose paid OpenAI API credentials');
assert.ok(orchestrator.includes("OPENAI_API_KEY:''")&&orchestrator.includes("COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'"),'commercial orchestrator must suppress paid OpenAI access');
assert.ok(orchestrator.includes('fullReviewRequired(request)'),'commercial orchestrator lacks the importance guard');
assert.ok(orchestrator.includes('blocked_by_importance_gate'),'direct full-review invocation can bypass editorial importance');
assert.ok(!orchestrator.includes('useOpenAIAccelerator='),'commercial orchestrator still has a paid-provider routing mode');
assert.ok(wrapper.includes("OPENAI_API_KEY:''")&&wrapper.includes("COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'"),'repair wrapper must independently suppress paid OpenAI access');

for(const marker of ['workflow_run:',"workflows: ['Enrich newly created Игропоиск games']",'Detect incomplete released game page','Dispatch next page worker cycle'])assert.ok(continuation.includes(marker),`automatic page continuation missing: ${marker}`);
assert.ok(continuation.includes("r?.review_importance?.status==='required'"),'continuation does not prioritize editorially required full reviews');
assert.ok(!continuation.includes("String(r?.modules?.review||'').toLowerCase()!=='ready'"),'continuation still interprets every incomplete review module as a mandatory full review');

for(const marker of ['commercialMediaReady','commercial_media_ready===true','screens>=commercialMinScreens','artwork>=commercialTargetArt','preserve existing commercial media; bootstrap discovery is non-destructive'])assert.ok(postRunner.includes(marker),`bootstrap can regress already-commercial media: ${marker}`);
for(const marker of ['provider-free-html-search','wayback','registered_sources_checked','provider_independent:true','historical-pdf','legacy-mirror'])assert.ok(corpus.includes(marker),`provider-independent corpus contract missing: ${marker}`);
for(const marker of ['SEARCH_TIMEOUT_MS=8000','PAGE_TIMEOUT_MS=10000','ARCHIVE_SNAPSHOT_LIMIT=2','SEARCH_CONCURRENCY=10','VALIDATION_CONCURRENCY=8','bounded_network_latency:true'])assert.ok(corpus.includes(marker),`bounded commercial research safeguard missing: ${marker}`);
assert.ok(!corpus.includes("OPENAI_API_KEY is required"),'provider-independent corpus must not require OpenAI');

for(const marker of ['local-ollama-fallback','chatJson','LOCAL_EDITORIAL_MODEL','data/article-section-drafts','incremental_persistence:true','generateSectionContinuation','topUpSection','continuation_parts'])assert.ok(synthesis.includes(marker),`persistent local synthesis safeguard missing: ${marker}`);
assert.ok(synthesis.includes("required:['paragraph']"),'section continuation must request one bounded paragraph');
assert.ok(synthesis.includes('for(let i=0;i<themes.length;i++)await buildSection(i)'),'local review is not generated as independently persisted sections');
assert.ok(synthesis.includes('persist()'),'sectioned local review does not persist progress');
assert.ok(!synthesis.includes('numPredict:10000'),'monolithic 3000+ word local generation was reintroduced');
for(const marker of ['repair_cursor','repair_attempts_total','markContinuation(true','full-review-incomplete'])assert.ok(wrapper.includes(marker),`cross-run repair persistence missing: ${marker}`);
assert.ok(!wrapper.includes('MAX_TOTAL_REPAIR_ATTEMPTS'),'terminal global repair-attempt budget was reintroduced');

for(const marker of ['deterministic-preflight-v1-single-final-editor-audit','generateLeadPackage','quality_reuse_audit','section_quality_rejections'])assert.ok(metaPreflight.includes(marker),`fast deterministic preflight safeguard missing: ${marker}`);
for(const marker of ['deterministic-fallback','screenshots_only:true','artwork_in_carousels:false'])assert.ok(carousel.includes(marker),`provider-free carousel fallback missing: ${marker}`);
for(const marker of ["'qwen3:4b'",'repeatPenalty=1.18','repeatLastN=1024','strengthenJsonSchema'])assert.ok(local.includes(marker),`local editorial transport contract missing: ${marker}`);

const sampleSchema={type:'object',required:['title','lead'],properties:{title:{type:'string'},lead:{type:'string'},optional:{type:'string'}}};
const strengthened=strengthenJsonSchema(sampleSchema);
assert.equal(strengthened.properties.title.minLength,1,'required local editorial title must reject an empty string');
assert.equal(strengthened.properties.lead.minLength,1,'required local editorial lead must reject an empty string');
assert.equal(strengthened.properties.optional.minLength,undefined,'optional strings must not be made mandatory by transport hardening');
assert.equal(sampleSchema.properties.title.minLength,undefined,'schema hardening must not mutate the caller schema');

const validator=read('scripts/validate-commercial-review-v2.mjs');
assert.ok(validator.includes('exhaustive_discovery'),'validator must understand exhaustive below-preferred fallback for games that require a full review');
assert.ok(!validator.includes("status:'blocked'"),'validator must not emit terminal blocked state');
const media=read('scripts/enforce-commercial-game-media.mjs');
assert.ok(!media.includes("status:'blocked'"),'media enrichment must not emit terminal blocked state');
const overlay=read('scripts/publish-game-post-create-overlay.mjs');
for(const marker of ["'data/review-bootstrap'","'data/review-article-corpus'","'data/review-discovery-audits'","'data/article-drafts'","'data/article-section-drafts'"])assert.ok(overlay.includes(marker),`overlay persistence missing: ${marker}`);

console.log('Commercial review contract passed: every released game gets the page/quick factual path, editorial importance is decided from Игромания first and professional review volume second, only important games enter the persistent 3000+ local review pipeline, and paid OpenAI API access is absent from page/review workflows.');
