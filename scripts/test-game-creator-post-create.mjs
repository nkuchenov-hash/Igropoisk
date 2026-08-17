#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const creator=read('scripts/ensure-game-page.mjs');
const verified=read('scripts/lib/verified-game-import.mjs');
const series=read('scripts/materialize-known-series.mjs');
const runner=read('scripts/run-game-post-create-enrichment.mjs');
const media=read('scripts/enrich-game-media-from-sources.mjs');
const runtime=read('game/_shared/game-page-materialized-data.js');
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

console.log('Game Creator post-create contract passed: series, rating/review and verified-source media enrichment are automatic and remain non-blocking for base page existence.');
