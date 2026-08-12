import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/calculate-ratings-from-research.mjs <slug>');process.exit(1)}
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const input=read(`data/reviews/${slug}.json`);const quality=read('config/game-page-quality-v2.json');const policy=quality.rating||{};const minimum=Number(policy.minimum_sources||10),maximum=Number(policy.maximum_sources||20);const gradeMap=policy.letter_grade_map||{};const checkedAt=new Date().toISOString();
const seen=new Set(),sources=[];
for(const item of input.reviews||[]){
  const publication=String(item.publication||item.source||'').trim();const key=publication.toLowerCase();if(!publication||seen.has(key))continue;
  let normalized10=null;let originalDisplay='';
  const score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim().toUpperCase();
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0){normalized10=score/scale*10;originalDisplay=`${score}/${scale}`}
  else if(grade&&Number.isFinite(Number(gradeMap[grade]))){normalized10=Number(gradeMap[grade]);originalDisplay=grade}
  if(!Number.isFinite(normalized10)||normalized10<0||normalized10>10)continue;
  seen.add(key);sources.push({publication,title:item.title||'',url:item.resolved_url||item.url,original_score:{score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade:grade||null,display:originalDisplay},normalized_10:Number(normalized10.toFixed(3)),checked_at:checkedAt});if(sources.length>=maximum)break;
}
const green=sources.length>=minimum;const values=sources.map(item=>item.normalized_10);const mean=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;const decimals=Number(policy.rounding_decimals??1);const score10=mean===null?null:Number(mean.toFixed(decimals));
const output={schema_version:3,game_slug:slug,checked_at:checkedAt,status:green?'green':'red-needs-revision',method:{name:'Среднее независимых профессиональных оценок',formula:'sum(normalized_10) / source_count',minimum_sources:minimum,maximum_sources:maximum,output_scale:10,letter_grade_map:gradeMap,rounding_decimals:decimals},sources,calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10,status:green?'green':'red-needs-revision'}};
write(`data/ratings/${slug}.json`,output);write(`data/parser-runs/ratings-${slug}.json`,{parser:'ratings-from-review-research',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,parsed:sources.length,minimum,score_10:score10,comments:green?[]:[`Недостаточно оценённых профессиональных рецензий: ${sources.length}/${minimum}.`]});
console.log(JSON.stringify({slug,status:output.status,sources:sources.length,score_10:score10},null,2));
