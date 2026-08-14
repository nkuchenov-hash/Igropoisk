#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/calculate-ratings-from-research.mjs <slug>');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};

const review=read(`data/reviews/${slug}.json`),quality=read('config/game-page-quality-v2.json'),policy=quality.review_score||{};
const minimum=Number(policy.minimum_sources||3),target=Number(policy.target_sources||10),decimals=Number(policy.rounding_decimals??1);
const seen=new Set(),sources=[],excluded=[];
for(const item of review.reviews||[]){
  const publication=String(item.publication||item.source||'').trim(),key=String(item.configured_source_id||publication).toLowerCase().replace(/\s+/g,' ');
  if(!publication||seen.has(key))continue;
  if(item.canonical_score_eligible===false||item.score_eligible===false){excluded.push({configured_source_id:item.configured_source_id||null,publication,url:item.resolved_url||item.url||'',reason:item.version_validation?.reason||'not_score_eligible'});continue}
  if(!isTrustedEditorialScore(item)){excluded.push({configured_source_id:item.configured_source_id||null,publication,url:item.resolved_url||item.url||'',reason:'missing_trusted_editorial_score_evidence'});continue}
  const raw=Number(item.score),scale=Number(item.scale),normalized=raw/scale*10;
  if(!Number.isFinite(normalized)||normalized<0||normalized>10)continue;
  seen.add(key);
  sources.push({source_id:item.id||null,configured_source_id:item.configured_source_id||null,publication,title:item.title||'',url:item.resolved_url||item.url||'',original_score:{score:raw,scale,grade:null,display:`${raw}/${scale}`},normalized_10:Number(normalized.toFixed(3)),score_evidence:item.score_evidence});
}
const values=sources.map(source=>source.normalized_10),mean=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,score10=mean===null?null:Number(mean.toFixed(decimals)),green=sources.length>=minimum&&Number.isFinite(score10),checkedAt=new Date().toISOString();
review.schema_version=Math.max(Number(review.schema_version||1),11);review.updated_at=checkedAt;
review.review_score={status:green?'green':'red-needs-revision',owner:'review',method:{name:'Среднее всех подтверждённых явных оценок независимых профессиональных изданий',formula:'sum(normalized_10) / source_count',minimum_sources:minimum,target_sources:target,maximum_sources:null,use_all_eligible_sources:true,required_evidence_scope:'editorial_review',output_scale:10,rounding_decimals:decimals,one_vote_per_publication:true,aggregators_forbidden:true,invented_scores_forbidden:true,exact_canonical_version_required:true},sources,excluded_sources:excluded,calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10}};
write(`data/reviews/${slug}.json`,review);
const compatibility={schema_version:7,deprecated_adapter:true,source_of_truth:`data/reviews/${slug}.json#review_score`,game_slug:slug,checked_at:checkedAt,status:review.review_score.status,method:review.review_score.method,sources,excluded_sources:excluded,calculation:review.review_score.calculation};write(`data/ratings/${slug}.json`,compatibility);
write(`data/parser-runs/review-score-${slug}.json`,{parser:'review-score-trusted-editorial-evidence-v4',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,source_count:sources.length,excluded_source_count:excluded.length,minimum,target,score_10:score10,use_all_eligible_sources:true,required_evidence_scope:'editorial_review',comments:green?[]:[`Недостаточно рецензий с подтверждённой собственной оценкой канонической версии: ${sources.length}/${minimum}. Агрегатные, пользовательские и неатрибутированные числа не учитываются.`]});
console.log(JSON.stringify({slug,status:review.review_score.status,scored_sources:sources.length,excluded_sources:excluded.length,score_10:score10,use_all_eligible_sources:true,required_evidence_scope:'editorial_review'},null,2));if(!green)process.exitCode=2;
