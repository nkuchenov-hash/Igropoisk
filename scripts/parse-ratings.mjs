import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/parse-ratings.mjs <game-slug>');process.exit(1)}
const configPath=path.join(root,'data','rating-sources',`${slug}.json`);
if(!fs.existsSync(configPath)){console.error(`Missing ${path.relative(root,configPath)}`);process.exit(1)}
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const checkedAt=new Date().toISOString();

const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
const extractNumber=(text,patterns)=>{
  for(const pattern of patterns||[]){
    const match=text.match(new RegExp(pattern,'is'));
    if(!match)continue;
    const candidate=match.slice(1).find(value=>value!==undefined)||match[0].match(/[0-9]+(?:\.[0-9]+)?/)?.[0];
    const number=Number(candidate);
    if(Number.isFinite(number))return number;
  }
  return null;
};

const results=[];
for(const source of config.sources||[]){
  const started=Date.now();
  try{
    const response=await fetch(source.url,{headers:{'user-agent':'Mozilla/5.0 IgropoiskRatingParser/1.0','accept-language':'en-US,en;q=0.8'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const text=await response.text();
    const score=extractNumber(text,source.patterns);
    if(score===null)throw new Error('Score pattern not found');
    const normalized=Number(((score/Number(source.scale||100))*100).toFixed(2));
    if(normalized<0||normalized>100)throw new Error(`Normalized score out of range: ${normalized}`);
    results.push({...source,score,normalized,status:'parsed',duration_ms:Date.now()-started,checked_at:checkedAt});
  }catch(error){
    results.push({...source,status:'error',error:error.message,duration_ms:Date.now()-started,checked_at:checkedAt});
  }
}

const values=results.filter(item=>item.status==='parsed').map(item=>item.normalized);
if(values.length<3){
  console.error(`Only ${values.length} rating sources parsed; at least 3 are required.`);
  process.exitCode=2;
}
const median100=values.length?median(values):null;
const output={
  schema_version:1,
  game_slug:slug,
  checked_at:checkedAt,
  method:{name:'Robust critic median',description:'One normalized score per verified publication; the median limits outlier influence.',scale:100,rounding:'one decimal on a 10-point scale'},
  sources:results,
  calculation:{values,sorted:[...values].sort((a,b)=>a-b),median_100:median100,score_10:median100===null?null:Number((median100/10).toFixed(1))}
};
fs.mkdirSync(path.join(root,'data','ratings'),{recursive:true});
fs.writeFileSync(path.join(root,'data','ratings',`${slug}.json`),`${JSON.stringify(output,null,2)}\n`);
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','parser-runs','ratings.json'),`${JSON.stringify({parser:'ratings',status:values.length>=3?'success':'partial',game_slug:slug,checked_at:checkedAt,parsed:values.length,total:results.length,result:output.calculation,sources:results},null,2)}\n`);
console.log(`Rating parser: ${values.length}/${results.length} sources, score ${output.calculation.score_10??'—'}`);
