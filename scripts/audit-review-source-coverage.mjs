#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,editorialSources,findRegisteredSource} from './lib/review-source-registry.mjs';

const root=process.cwd(),slug=process.argv[2];
if(!slug)throw new Error('Usage: audit-review-source-coverage <slug>');
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const synthesis=read('config/parsers/review-synthesis.json'),registry=loadReviewSourceRegistry(synthesis.source_registry),review=read(`data/reviews/${slug}.json`),research=read(`data/research/${slug}-source-matrix.json`),game=read(`data/drafts/${slug}.json`),checks=new Map((research.source_checks||[]).map(item=>[item.source_id,item]));
const year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0),historical=year>0&&year<2010;
const bySource=new Map();
// Prefer the fresh registry audit/enriched research result over older persisted review rows.
for(const item of [...(research.accepted||[]),...(review.reviews||[])]){
 const source=findRegisteredSource(registry,item);if(source&&!bySource.has(source.id))bySource.set(source.id,item);
}
const rows=editorialSources(registry,{historical:true}).map(source=>{
 const applicable=!source.historical_only||historical,item=bySource.get(source.id),check=checks.get(source.id),score=Number(item?.score),scale=Number(item?.scale),hasExplicitScore=Number.isFinite(score)&&Number.isFinite(scale)&&scale>0,canonicalScoreEligible=item?.canonical_score_eligible!==false&&item?.score_eligible!==false,scoreEligible=canonicalScoreEligible&&(hasExplicitScore||Boolean(item?.grade));
 return {source_id:source.id,publication:source.name,language:source.language,regions:source.regions,applicable,corpus_status:!applicable?'not_applicable':item?'found':check?.status||'unchecked',review_url:item?.resolved_url||item?.url||'',source_kind:item?.source_kind||'',canonical_score_eligible:canonicalScoreEligible,version_reason:item?.version_validation?.reason||'',score:hasExplicitScore?score:null,scale:hasExplicitScore?scale:null,score_10:hasExplicitScore?Number((score/scale*10).toFixed(4)):null,score_eligible:scoreEligible,grade:item?.grade||'',check_notes:!applicable?'historical-only source outside game era':check?.notes||''};
});
const applicableRows=rows.filter(x=>x.applicable),scoreRows=applicableRows.filter(x=>x.score_eligible&&Number.isFinite(x.score_10)),mean=scoreRows.length?Number((scoreRows.reduce((sum,x)=>sum+x.score_10,0)/scoreRows.length).toFixed(4)):null;
const summary={schema_version:3,game_slug:slug,source_registry:synthesis.source_registry,generated_at:new Date().toISOString(),registered_editorial:rows.length,applicable_editorial:applicableRows.length,found:applicableRows.filter(x=>x.corpus_status==='found').length,scored:scoreRows.length,context_only_versions:applicableRows.filter(x=>x.corpus_status==='found'&&!x.canonical_score_eligible).length,explicit_score_mean_10:mean,not_found:applicableRows.filter(x=>x.corpus_status==='not_found').length,unavailable:applicableRows.filter(x=>x.corpus_status==='unavailable').length,unchecked:applicableRows.filter(x=>x.corpus_status==='unchecked').length,not_applicable:rows.filter(x=>x.corpus_status==='not_applicable').length,sources:rows};
const out=`data/research/${slug}-registry-coverage.json`;fs.mkdirSync(path.dirname(path.join(root,out)),{recursive:true});fs.writeFileSync(path.join(root,out),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
