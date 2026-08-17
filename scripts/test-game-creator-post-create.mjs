#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const creator=read('scripts/ensure-game-page.mjs');
const verified=read('scripts/lib/verified-game-import.mjs');
const series=read('scripts/materialize-known-series.mjs');
const runner=read('scripts/run-game-post-create-enrichment.mjs');
const publisher=read('scripts/publish-game-post-create-overlay.mjs');
const media=read('scripts/enrich-game-media-from-sources.mjs');
const runtime=read('game/_shared/game-page-materialized-data.js');
const verifiedWorkflow=read('.github/workflows/verified-game-import-fast.yml');
const newsWorkflow=read('.github/workflows/news-game-page-fast.yml');
const enrichmentWorkflow=read('.github/workflows/game-post-create-enrichment.yml');
const fail=message=>{throw new Error(message)};

if(!creator.includes('series: series || null'))fail('Game Creator does not preserve canonical series');
if(!creator.includes('data/game-enrichment-requests/${slug}.json'))fail('Game Creator does not emit post-create enrichment request');
if(!creator.includes("reason: 'post_create_enrichment_must_not_block_base_page'"))fail('Post-create request does not document non-blocking boundary');
if(!creator.includes('reviewNeeded = released && !reviewReady'))fail('Released game without review is not an automatic review trigger');
if(!verified.includes('verified_series_attached'))fail('Matched verified imports still lose supplied series');
if(!series.includes('data/franchises/${slug}.json'))fail('Known series does not materialize franchise payloads');
if(!series.includes('canonical_series_backfilled'))fail('Known series cannot repair existing matched registry entities');
if(!runner.includes("'scripts/calculate-ratings-from-research.mjs'"))fail('Post-create runner does not bootstrap canonical ratings');
if(!runner.includes("'scripts/quality-control-loop.mjs'"))fail('Post-create runner does not build the canonical review');
if(runner.indexOf("'scripts/calculate-ratings-from-research.mjs'")>runner.indexOf("'scripts/quality-control-loop.mjs'"))fail('Rating bootstrap must happen before the slower full review build');
if(!runner.includes("'scripts/enrich-game-media-from-sources.mjs'"))fail('Post-create runner does not enrich media from verified source pages');
if(!media.includes('provider:\'verified-source-page\''))fail('Media provenance is not retained');
if(!media.includes('Search engines may aid human/source discovery'))fail('Media policy does not forbid retaining search-engine proxy images');
if(!runtime.includes('renderEnrichedMedia(draft,title)'))fail('Enriched draft media is not exposed by the game page runtime');
if(!/paths=\([^\n]*data\/game-enrichment-requests/.test(verifiedWorkflow))fail('Verified-import wrapper discards Game Creator enrichment requests before staging');
if(!/paths=\([^\n]*data\/game-enrichment-requests/.test(newsWorkflow))fail('News wrapper discards Game Creator enrichment requests before staging');
if(!enrichmentWorkflow.includes("OPENAI_API_KEY: ''"))fail('Immediate enrichment still depends on paid OpenAI quota');
if(!enrichmentWorkflow.includes('qwen3:1.7b')||!enrichmentWorkflow.includes('qwen3-vl:4b'))fail('Immediate enrichment lacks local text/vision fallbacks');
if(!enrichmentWorkflow.includes('scripts/publish-game-post-create-overlay.mjs'))fail('Immediate enrichment does not use conflict-safe publication');
if(!enrichmentWorkflow.includes('cancel-in-progress: true'))fail('Fresh Game Creator enrichment cannot cancel a stale run');
if(!publisher.includes("freshObj!==baseObj"))fail('Conflict-safe publisher does not preserve newer parallel staging updates');
if(!publisher.includes('for(let publishAttempt=1;publishAttempt<=5;publishAttempt++)'))fail('Conflict-safe publisher does not retry moving staging');

console.log('Game Creator post-create contract passed: series, rating/review and verified-source media enrichment are automatic, persisted by every fast creator wrapper, locally model-capable, conflict-safe, stale-run cancelling, and remain non-blocking for base page existence.');
