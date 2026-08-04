import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/calculate-ratings-from-research.mjs <slug>');process.exit(1)}
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const input=read(`data/reviews/${slug}.json`);
const checkedAt=new Date().toISOString();
const seen=new Set();
const sources=[];
for(const item of input.reviews||[]){
  const publication=String(item.publication||item.source||'').trim();
  const key=publication.toLowerCase();
  const score=Number(item.score),scale=Number(item.scale);
  if(!publication||seen.has(key)||!Number.isFinite(score)||!Number.isFinite(scale)||scale<=0)continue;
  const normalized=Number((score/scale*100).toFixed(2));
  if(normalized<0||normalized>100)continue;
  seen.add(key);
  sources.push({publication,url:item.resolved_url||item.url,score,scale,normalized,status:'parsed',checked_at:checkedAt});
}
const values=sources.map(item=>item.normalized).sort((a,b)=>a-b);
if(values.length<3){console.error(`Only ${values.length} scored publications; at least 3 are required.`);process.exit(2)}
const middle=Math.floor(values.length/2);
const median100=values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
const output={schema_version:2,game_slug:slug,checked_at:checkedAt,method:{name:'Robust editorial median',description:'Одна нормализованная оценка на независимое издание; медиана снижает влияние выбросов.',scale:100,rounding:'one decimal on a 10-point scale'},sources,calculation:{values,sorted:values,median_100:Number(median100.toFixed(2)),score_10:Number((median100/10).toFixed(1))}};
write(`data/ratings/${slug}.json`,output);
write(`data/parser-runs/ratings-${slug}.json`,{parser:'ratings-from-review-research',status:'success',game_slug:slug,checked_at:checkedAt,parsed:sources.length,result:output.calculation,output:`data/ratings/${slug}.json`});
console.log(JSON.stringify({slug,sources:sources.length,score_10:output.calculation.score_10},null,2));
