#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,editorialSources,regionalEditorialSources,findRegisteredSource} from './lib/review-source-registry.mjs';

const root=process.cwd(),errors=[];
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const synthesis=read('config/parsers/review-synthesis.json');
if(!synthesis.source_registry)errors.push('review-synthesis.json must point to source_registry');
if(Array.isArray(synthesis.sources)&&synthesis.sources.length)errors.push('review-synthesis.json must not duplicate source records');
if(fs.existsSync(path.join(root,'config/parsers/review-sources-ru.json')))errors.push('legacy review-sources-ru.json must be removed');
let registry;
try{registry=loadReviewSourceRegistry(synthesis.source_registry)}catch(error){errors.push(error.message);registry={sources:[]}}
const ids=new Set(),names=new Set();
for(const source of registry.sources||[]){
 if(!source.id||!source.name)errors.push('registry source missing id/name');
 if(ids.has(source.id))errors.push(`duplicate source id: ${source.id}`);ids.add(source.id);
 const name=String(source.name).toLowerCase();if(names.has(name))errors.push(`duplicate source name: ${source.name}`);names.add(name);
 const editorial=source.review;
 if(editorial){
   if(!editorial.discovery_url)errors.push(`${source.id}: editorial source missing discovery_url`);
   if(editorial.score?.policy!=='explicit_only')errors.push(`${source.id}: editorial score policy must be explicit_only`);
 }
}
const ru=regionalEditorialSources(registry,'ru',{historical:false});
if(ru.length<5)errors.push(`need at least 5 modern RU editorial sources, found ${ru.length}`);
for(const source of ru)if(source.review?.score?.policy!=='explicit_only')errors.push(`${source.id}: RU score policy must be explicit_only`);
const witcherPath='data/reviews/the-witcher-3-wild-hunt.json';
if(fs.existsSync(path.join(root,witcherPath))){
 const witcher=read(witcherPath),missing=[];
 for(const review of witcher.reviews||[])if(!findRegisteredSource(registry,review))missing.push(`${review.publication||review.source}: ${review.url||''}`);
 if(missing.length)errors.push(`Witcher 3 contains unregistered publishers: ${missing.join(' | ')}`);
}
const editorial=editorialSources(registry,{historical:true});
if(errors.length){console.error(`Review source registry validation failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log(JSON.stringify({status:'green',registry:synthesis.source_registry,total_sources:registry.sources.length,editorial_sources:editorial.length,modern_ru_sources:ru.length,unknown_publisher_policy:registry.policies?.unknown_publisher_policy},null,2));
