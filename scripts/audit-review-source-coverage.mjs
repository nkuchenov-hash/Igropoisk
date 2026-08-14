#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,editorialSources,findRegisteredSource} from './lib/review-source-registry.mjs';

const root=process.cwd(),slug=process.argv[2];
if(!slug)throw new Error('Usage: audit-review-source-coverage <slug>');
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const synthesis=read('config/parsers/review-synthesis.json'),registry=loadReviewSourceRegistry(synthesis.source_registry),review=read(`data/reviews/${slug}.json`),research=read(`data/research/${slug}-source-matrix.json`),checks=new Map((research.source_checks||[]).map(item=>[item.source_id,item]));
const bySource=new Map();
for(const item of [...(review.reviews||[]),...(research.accepted||[])]){
 const source=findRegisteredSource(registry,item);if(source&&!bySource.has(source.id))bySource.set(source.id,item);
}
const rows=editorialSources(registry,{historical:true}).map(source=>{
 const item=bySource.get(source.id),check=checks.get(source.id),score=Number(item?.score),scale=Number(item?.scale),scored=Number.isFinite(score)&&Number.isFinite(scale)&&scale>0;
 return {source_id:source.id,publication:source.name,language:source.language,regions:source.regions,corpus_status:item?'found':check?.status||'unchecked',review_url:item?.resolved_url||item?.url||'',score:scored?score:null,scale:scored?scale:null,score_eligible:scored||Boolean(item?.grade),grade:item?.grade||'',check_notes:check?.notes||''};
});
const summary={schema_version:1,game_slug:slug,source_registry:synthesis.source_registry,generated_at:new Date().toISOString(),registered_editorial:rows.length,found:rows.filter(x=>x.corpus_status==='found').length,scored:rows.filter(x=>x.score_eligible).length,not_found:rows.filter(x=>x.corpus_status==='not_found').length,unavailable:rows.filter(x=>x.corpus_status==='unavailable').length,unchecked:rows.filter(x=>x.corpus_status==='unchecked').length,sources:rows};
const out=`data/research/${slug}-registry-coverage.json`;fs.mkdirSync(path.dirname(path.join(root,out)),{recursive:true});fs.writeFileSync(path.join(root,out),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
