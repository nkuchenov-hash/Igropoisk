#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,editorialSources,regionalEditorialSources,findRegisteredSource,classifyReviewPage,classifyCanonicalVersion} from './lib/review-source-registry.mjs';

const root=process.cwd(),errors=[];
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const synthesis=readJson('config/parsers/review-synthesis.json');
if(!synthesis.source_registry)errors.push('review-synthesis.json must point to source_registry');
if(Array.isArray(synthesis.sources)&&synthesis.sources.length)errors.push('review-synthesis.json must not duplicate source records');
if(fs.existsSync(path.join(root,'config/parsers/review-sources-ru.json')))errors.push('legacy review-sources-ru.json must be removed');
let registry;try{registry=loadReviewSourceRegistry(synthesis.source_registry)}catch(error){errors.push(error.message);registry={sources:[]}}
const ids=new Set(),names=new Set();
for(const source of registry.sources||[]){if(!source.id||!source.name)errors.push('registry source missing id/name');if(ids.has(source.id))errors.push(`duplicate source id: ${source.id}`);ids.add(source.id);const name=String(source.name).toLowerCase();if(names.has(name))errors.push(`duplicate source name: ${source.name}`);names.add(name);if(source.review){if(!source.review.discovery_url)errors.push(`${source.id}: editorial source missing discovery_url`);if(source.review.score?.policy!=='explicit_only')errors.push(`${source.id}: editorial score policy must be explicit_only`)}}
const ru=regionalEditorialSources(registry,'ru',{historical:false});
if(ru.length<5)errors.push(`need at least 5 modern RU editorial sources, found ${ru.length}`);
for(const source of ru)if(source.review?.score?.policy!=='explicit_only')errors.push(`${source.id}: RU score policy must be explicit_only`);

const witcherPath='data/reviews/the-witcher-3-wild-hunt.json';
if(fs.existsSync(path.join(root,witcherPath))){const witcher=readJson(witcherPath),missing=[];for(const review of witcher.reviews||[])if(!findRegisteredSource(registry,review))missing.push(`${review.publication||review.source}: ${review.url||''}`);if(missing.length)errors.push(`Witcher 3 contains unregistered publishers: ${missing.join(' | ')}`)}

const stopgame=findRegisteredSource(registry,{configured_source_id:'stopgame'}),playground=findRegisteredSource(registry,{configured_source_id:'playground'}),gamespot=findRegisteredSource(registry,{configured_source_id:'gamespot'}),nintendo=findRegisteredSource(registry,{configured_source_id:'nintendo-life'});
const pageCases=[
 {name:'reject StopGame game card',source:stopgame,input:{url:'https://stopgame.ru/game/witcher_3_wild_hunt',title:'The Witcher 3: Wild Hunt'},want:false},
 {name:'accept StopGame review',source:stopgame,input:{url:'https://stopgame.ru/show/56607/the_witcher_3_wild_hunt_review',title:'The Witcher 3: Wild Hunt: Обзор'},want:true},
 {name:'reject PlayGround file',source:playground,input:{url:'https://www.playground.ru/witcher_3_wild_hunt/file/gameplay',title:'The Witcher 3 gameplay'},want:false},
 {name:'accept PlayGround editorial review',source:playground,input:{url:'https://www.playground.ru/witcher_3_wild_hunt/opinion/shevelis_plotva_retsenziya_na_the_witcher_3_wild_hunt-448217',title:'Рецензия на The Witcher 3: Wild Hunt'},want:true}
];
for(const test of pageCases){const actual=classifyReviewPage(test.source,test.input).accepted;if(actual!==test.want)errors.push(`${test.name}: expected ${test.want}, got ${actual}`)}
const baseGame={identity:{title:'The Witcher 3: Wild Hunt'}};
const versionCases=[
 {name:'accept original review score',input:{title:'The Witcher 3: Wild Hunt review',url:'https://www.pcgamer.com/the-witcher-3-review/',game:baseGame},want:true},
 {name:'reject next-gen score',input:{title:'The Witcher 3: Wild Hunt Next-Gen Update Review',url:'https://www.gamespot.com/reviews/the-witcher-3-wild-hunt-next-gen-update-review/',game:baseGame},want:false},
 {name:'reject Complete Edition port score',input:{title:'The Witcher 3: Wild Hunt - Complete Edition Review',url:'https://www.nintendolife.com/reviews/nintendo-switch/witcher_3_wild_hunt_-_complete_edition',game:baseGame},want:false}
];
for(const test of versionCases){const actual=classifyCanonicalVersion(test.input).score_eligible;if(actual!==test.want)errors.push(`${test.name}: expected ${test.want}, got ${actual}`)}
if(!gamespot||!nintendo)errors.push('version test publishers must be registered');

const calculator=readText('scripts/calculate-ratings-from-research.mjs');
const qc=readText('scripts/quality-control-loop-v4.mjs');
const promote=readText('scripts/promote-review-source-audit.mjs');
const enrich=readText('scripts/enrich-review-explicit-scores.mjs');
if(!calculator.includes('use_all_eligible_sources:true'))errors.push('canonical score calculator must use every eligible explicit publisher score');
if(/sources\.length\s*>=\s*maximum/.test(calculator)||/if\(sources\.length>=maximum\)break/.test(calculator))errors.push('canonical score calculator must not cap the publisher vote count');
if(!qc.includes("[slug,'--all']"))errors.push('review QC must request a complete registered-source web audit');
if(!qc.includes('promote-review-source-audit.mjs'))errors.push('review QC must promote the full audit before scoring');
if(!promote.includes("matrix.policy?.audit_all!==true"))errors.push('audit promotion must reject partial source scans');
if(!enrich.includes('preserved_existing_score'))errors.push('score enrichment must preserve verified explicit scores across transient failures');

const editorial=editorialSources(registry,{historical:true});
if(errors.length){console.error(`Review source registry validation failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log(JSON.stringify({status:'green',registry:synthesis.source_registry,total_sources:registry.sources.length,editorial_sources:editorial.length,modern_ru_sources:ru.length,review_page_contract_cases:pageCases.length,version_contract_cases:versionCases.length,score_all_eligible_sources:true,full_registry_scan_required:true,unknown_publisher_policy:registry.policies?.unknown_publisher_policy},null,2));
