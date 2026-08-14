import fs from 'node:fs';
import path from 'node:path';
import { loadPublicationSourceRegistry, publicationSources } from './lib/publication-source-registry.mjs';
import { expandCalendarUrls, extractCalendarClaims, claimsToPublicationRecords } from './lib/release-publication-discovery.mjs';

const root=process.cwd();
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`,'utf8')};
const config=read('config/parsers/releases.json',{});
if(!config.publication_source_registry)throw new Error('releases.json must configure publication_source_registry');
const registry=loadPublicationSourceRegistry(config.publication_source_registry);
const sources=publicationSources(registry,{releaseRole:'calendar_discovery'});
if(!sources.length)throw new Error('Publication Registry has no calendar_discovery sources');
const generatedAt=new Date().toISOString();
const now=new Date();
const horizonDays=Math.max(30,Number(config.publication_discovery_horizon_days||180));
const timeout=Math.max(5000,Number(config.publication_discovery_timeout_ms||18000));
const previous=read('data/release-candidates/publication-discovery.json',{releases:[],claims:[]});

async function fetchText(url,source){
  const language=source.language==='ru'?'ru-RU,ru;q=0.9,en;q=0.5':'en-US,en;q=0.9';
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 IgropoiskPublicationCalendar/1.0','accept-language':language}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function runPool(items,concurrency,worker){
  const results=new Array(items.length);let cursor=0;
  const workers=Array.from({length:Math.min(Math.max(1,concurrency),Math.max(1,items.length))},async()=>{while(cursor<items.length){const index=cursor++;try{results[index]=await worker(items[index],index)}catch(error){results[index]={error}}}});
  await Promise.all(workers);return results;
}

const jobs=[];
for(const source of sources){
  const urls=expandCalendarUrls(source,{now,horizonDays});
  for(const url of urls)jobs.push({source,url});
}
const outcomes=await runPool(jobs,4,async job=>{
  const started=Date.now();
  const html=await fetchText(job.url,job.source);
  const claims=extractCalendarClaims(html,{source:job.source,url:job.url,now:now.getTime(),horizonDays});
  return {source_id:job.source.id,url:job.url,status:'success',items:claims.length,duration_ms:Date.now()-started,claims};
});
const statuses=[],claims=[];
for(let index=0;index<outcomes.length;index++){
  const outcome=outcomes[index],job=jobs[index];
  if(outcome?.error){statuses.push({source_id:job.source.id,url:job.url,status:'error',error:outcome.error.message});continue}
  statuses.push({source_id:outcome.source_id,url:outcome.url,status:outcome.status,items:outcome.items,duration_ms:outcome.duration_ms});
  claims.push(...outcome.claims);
}
const successful=statuses.filter(item=>item.status==='success').length;
const failed=statuses.filter(item=>item.status==='error').length;
const records=claimsToPublicationRecords(claims,generatedAt);
const sourceIds=[...new Set(claims.map(item=>item.source_id))];
const statistics={
  configured_calendar_sources:sources.length,
  calendar_urls_checked:jobs.length,
  successful_urls:successful,
  failed_urls:failed,
  claims:claims.length,
  unique_games:records.length,
  exact_claims:claims.filter(item=>item.date_claim?.precision==='exact').length,
  month_claims:claims.filter(item=>item.date_claim?.precision==='month').length,
  contributing_sources:sourceIds.length,
};
const status=successful===0?'error':failed?'partial':'success';
const snapshot={schema_version:1,generated_at:generatedAt,registry_id:registry.id,registry_path:config.publication_source_registry,horizon_days:horizonDays,status,statistics,sources:statuses,claims,releases:records};
if(successful>0)write('data/release-candidates/publication-discovery.json',snapshot);
write('data/parser-runs/release-publication-discovery.json',{schema_version:1,parser_id:'release-publication-discovery',checked_at:generatedAt,status,output:'data/release-candidates/publication-discovery.json',preserved_previous_snapshot:successful===0&&Boolean(previous?.releases?.length),statistics,sources:statuses});
console.log(JSON.stringify({status,registry_id:registry.id,...statistics,preserved_previous_snapshot:successful===0&&Boolean(previous?.releases?.length)},null,2));
if(successful===0)process.exitCode=1;
