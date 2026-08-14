#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/calculate-ratings-from-research.mjs <slug>');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};

const review=read(`data/reviews/${slug}.json`);
const quality=read('config/game-page-quality-v2.json');
const policy=quality.review_score||{};
const minimum=Number(policy.minimum_sources||3);
const target=Number(policy.target_sources||10);
const decimals=Number(policy.rounding_decimals??1);
const grades=policy.letter_grade_map||{};

const seen=new Set();
const sources=[];
const excluded=[];
for(const item of review.reviews||[]){
  const publication=String(item.publication||item.source||'').trim();
  const key=String(item.configured_source_id||publication).toLowerCase().replace(/\s+/g,' ');
  if(!publication||seen.has(key)) continue;
  if(item.canonical_score_eligible===false||item.score_eligible===false){
    excluded.push({configured_source_id:item.configured_source_id||null,publication,url:item.resolved_url||item.url||'',reason:item.version_validation?.reason||'not_score_eligible'});
    continue;
  }
  const raw=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim().toUpperCase();
  let normalized=null,display='';
  if(Number.isFinite(raw)&&Number.isFinite(scale)&&scale>0){normalized=raw/scale*10;display=`${raw}/${scale}`}
  else if(grade&&Number.isFinite(Number(grades[grade]))){normalized=Number(grades[grade]);display=grade}
  if(!Number.isFinite(normalized)||normalized<0||normalized>10) continue;
  seen.add(key);
  sources.push({
    source_id:item.id||null,
    configured_source_id:item.configured_source_id||null,
    publication,
    title:item.title||'',
    url:item.resolved_url||item.url||'',
    original_score:{score:Number.isFinite(raw)?raw:null,scale:Number.isFinite(scale)?scale:null,grade:grade||null,display},
    normalized_10:Number(normalized.toFixed(3)),
    score_evidence:item.score_evidence||null
  });
}

const values=sources.map(x=>x.normalized_10);
const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const score10=mean===null?null:Number(mean.toFixed(decimals));
const green=sources.length>=minimum&&Number.isFinite(score10);
const checkedAt=new Date().toISOString();
review.schema_version=Math.max(Number(review.schema_version||1),10);
review.updated_at=checkedAt;
review.review_score={
  status:green?'green':'red-needs-revision',
  owner:'review',
  method:{
    name:'Среднее всех явных оценок независимых профессиональных изданий',
    formula:'sum(normalized_10) / source_count',
    minimum_sources:minimum,
    target_sources:target,
    maximum_sources:null,
    use_all_eligible_sources:true,
    output_scale:10,
    rounding_decimals:decimals,
    one_vote_per_publication:true,
    aggregators_forbidden:true,
    invented_scores_forbidden:true,
    exact_canonical_version_required:true
  },
  sources,
  excluded_sources:excluded,
  calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10}
};
write(`data/reviews/${slug}.json`,review);

const compatibility={schema_version:6,deprecated_adapter:true,source_of_truth:`data/reviews/${slug}.json#review_score`,game_slug:slug,checked_at:checkedAt,status:review.review_score.status,method:review.review_score.method,sources,excluded_sources:excluded,calculation:review.review_score.calculation};
write(`data/ratings/${slug}.json`,compatibility);
write(`data/parser-runs/review-score-${slug}.json`,{
  parser:'review-score-all-eligible-canonical-sources-v3',
  status:green?'green':'needs_revision',
  game_slug:slug,
  checked_at:checkedAt,
  source_count:sources.length,
  excluded_source_count:excluded.length,
  minimum,
  target,
  score_10:score10,
  use_all_eligible_sources:true,
  comments:green?[]:[`Недостаточно рецензий с собственной оценкой канонической версии: ${sources.length}/${minimum}. Словесные вердикты и оценки портов/переизданий не конвертируются в число.`]
});
console.log(JSON.stringify({slug,status:review.review_score.status,scored_sources:sources.length,excluded_sources:excluded.length,score_10:score10,use_all_eligible_sources:true,compatibility_adapter:true},null,2));
if(!green) process.exitCode=2;
