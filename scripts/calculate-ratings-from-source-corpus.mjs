#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/calculate-ratings-from-source-corpus.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const corpus=read(`data/game-sources/${slug}.json`,{});
if(!corpus?.discovery?.complete)throw new Error(`${slug}: canonical source discovery is not complete`);
const quality=read('config/game-page-quality-v2.json',{}),policy=quality.rating||{},minimum=Number(policy.minimum_sources||5),gradeMap=policy.letter_grade_map||{},decimals=Number(policy.rounding_decimals??1),checkedAt=new Date().toISOString();
const seen=new Set(),sources=[];
for(const item of corpus.sources||[]){
  if(item?.professional!==true||item?.score_eligible!==true)continue;
  const publication=String(item.publication||item.name||item.source_name||'').trim();
  const key=(publication||item.domain||item.url||'').toLowerCase();if(!key||seen.has(key))continue;
  const score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim().toUpperCase();let normalized10=null,display='';
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0&&score>=0&&score<=scale){normalized10=score/scale*10;display=`${score}/${scale}`}
  else if(grade&&Number.isFinite(Number(gradeMap[grade]))){normalized10=Number(gradeMap[grade]);display=grade}
  if(!Number.isFinite(normalized10)||normalized10<0||normalized10>10)continue;
  seen.add(key);sources.push({publication,title:item.title||'',url:item.resolved_url||item.url||'',original_score:{score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade:grade||null,display},normalized_10:Number(normalized10.toFixed(3)),checked_at:item.checked_at||checkedAt});
}
const values=sources.map(x=>x.normalized_10),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,score10=mean===null?null:Number(mean.toFixed(decimals)),green=sources.length>=minimum;
const output={schema_version:7,game_slug:slug,checked_at:checkedAt,status:green?'green':'insufficient-scores',method:{name:'Среднее всех найденных подтверждённых независимых профессиональных оценок canonical source corpus',formula:'sum(normalized_10) / source_count',minimum_sources_for_confident_rating:minimum,maximum_sources:null,use_all_discovered_scores:true,source_of_truth:'data/game-sources',output_scale:10,letter_grade_map:gradeMap,rounding_decimals:decimals},sources,calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10,status:green?'green':'insufficient-scores'}};
write(`data/ratings/${slug}.json`,output);write(`data/parser-runs/ratings-${slug}.json`,{parser:'ratings-from-canonical-source-corpus',status:'completed',game_slug:slug,checked_at:checkedAt,parsed:sources.length,minimum_for_confident_rating:minimum,score_10:score10,use_all_discovered_scores:true});
console.log(JSON.stringify({slug,status:output.status,sources:sources.length,score_10:score10,source_of_truth:'canonical-game-source-corpus'},null,2));
