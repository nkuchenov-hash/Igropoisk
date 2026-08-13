#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/calculate-review-score.mjs <slug>');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const review=read(`data/reviews/${slug}.json`);
const quality=read('config/game-page-quality-v2.json');
const policy=quality.review_score||{};
const minimum=Number(policy.minimum_sources||3),target=Number(policy.target_sources||10),maximum=Number(policy.maximum_sources||20),decimals=Number(policy.rounding_decimals??1);const gradeMap=policy.letter_grade_map||{};
const seen=new Set(),sources=[];
for(const item of review.reviews||[]){
  const publication=String(item.publication||item.source||'').trim();const key=publication.toLowerCase().replace(/\s+/g,' ');if(!publication||seen.has(key))continue;
  const score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim().toUpperCase();let normalized10=null,display='';
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0){normalized10=score/scale*10;display=`${score}/${scale}`}
  else if(grade&&Number.isFinite(Number(gradeMap[grade]))){normalized10=Number(gradeMap[grade]);display=grade}
  if(!Number.isFinite(normalized10)||normalized10<0||normalized10>10)continue;
  seen.add(key);sources.push({source_id:item.id||null,publication,title:item.title||'',url:item.resolved_url||item.url||'',original_score:{score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade:grade||null,display},normalized_10:Number(normalized10.toFixed(3))});
  if(sources.length>=maximum)break;
}
const values=sources.map(item=>item.normalized_10);const mean=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;const score10=mean===null?null:Number(mean.toFixed(decimals));const green=sources.length>=minimum&&Number.isFinite(score10);
review.schema_version=Math.max(Number(review.schema_version||1),6);review.updated_at=new Date().toISOString();review.review_score={status:green?'green':'red-needs-revision',owner:'review',method:{name:'Среднее оценок независимых профессиональных изданий',formula:'sum(normalized_10) / source_count',minimum_sources:minimum,target_sources:target,maximum_sources:maximum,output_scale:10,rounding_decimals:decimals,one_vote_per_publication:true,aggregators_forbidden:true,invented_scores_forbidden:true},sources,calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10}};
write(`data/reviews/${slug}.json`,review);
write(`data/parser-runs/review-score-${slug}.json`,{parser:'review-score',status:green?'green':'needs_revision',game_slug:slug,checked_at:review.updated_at,source_count:sources.length,minimum,target,score_10:score10,comments:green?[]:[`Недостаточно рецензий с собственной числовой/буквенной оценкой: ${sources.length}/${minimum}. Словесные вердикты не конвертируются в число.`]});
console.log(JSON.stringify({slug,status:review.review_score.status,scored_sources:sources.length,score_10:score10},null,2));
if(!green)process.exitCode=2;
