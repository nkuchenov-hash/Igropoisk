#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/collect-game-sources.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const canonical=v=>{try{const u=new URL(String(v||''));u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(v||'').trim()}};
const host=v=>{try{return new URL(String(v||'')).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const draft=read(`data/drafts/${slug}.json`);if(!draft?.identity?.title)throw new Error(`Missing game draft for ${slug}`);
const checkedAt=new Date().toISOString();
const quality=read('config/game-page-quality-v2.json',{}),corpusPolicy=quality.game_source_corpus||quality.review_corpus||{},ratingPolicy=quality.rating||{};
const minimumProfessional=Number(corpusPolicy.minimum_professional_sources??corpusPolicy.minimum_sources??10),minimumScored=Number(ratingPolicy.minimum_sources??5);

const legacyRun=spawnSync(process.execPath,[path.join(root,'scripts/prepare-review-research.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024});
const reviews=read(`data/reviews/${slug}.json`,{}),rating=read(`data/ratings/${slug}.json`,{}),parser=read(`data/parser-output/${slug}.json`,{});
const seen=new Map();
function add(raw={}){
  const url=canonical(raw.url||raw.resolved_url||raw.source_url||'');if(!url)return;
  const key=url.toLowerCase(),old=seen.get(key),rawKind=String(raw.kind||raw.type||raw.source_kind||old?.kind||'source'),kind=rawKind==='editorial'?'professional-review':rawKind;
  const roles=[...new Set([...(old?.roles||[]),...(kind==='professional-review'?['description','dna','review','rating','media']:[]),...(raw.roles||[])].filter(Boolean))];
  const next={id:old?.id||`source-${seen.size+1}`,name:String(raw.name||raw.publication||raw.source_name||raw.source||old?.name||host(url)||'Источник'),title:String(raw.title||old?.title||''),url,domain:host(url),kind,roles,score:Number.isFinite(Number(raw.score))?Number(raw.score):(old?.score??null),scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):(old?.scale??null),grade:String(raw.grade||old?.grade||''),score_eligible:Boolean(raw.score_eligible??old?.score_eligible??false),checked_at:String(raw.checked_at||raw.validation?.checked_at||old?.checked_at||checkedAt),provenance:String(raw.provenance||old?.provenance||'game-page-source-corpus')};
  if(Number.isFinite(next.score)&&Number.isFinite(next.scale)&&next.scale>0){next.score_eligible=true;next.normalized_10=Number((next.score/next.scale*10).toFixed(3))}else if(next.grade)next.score_eligible=true;
  seen.set(key,next);
}
for(const item of draft.sources||[])add({...item,roles:['facts','description','dna']});
if(parser?.source?.url)add({name:parser.source.name||'Parser source',url:parser.source.url,type:'structured-source',roles:['identity','facts','requirements','media']});
if(draft.links?.official)add({name:'Официальный сайт',url:draft.links.official,type:'official',roles:['identity','facts','media','description','dna']});
if(draft.links?.store)add({name:'Страница магазина',url:draft.links.store,type:'store',roles:['identity','facts','requirements','media','description','dna']});
for(const item of [...(draft.media?.screenshots||[]),...(draft.media?.artwork||[]),...(draft.media?.videos||[])])if(item&&typeof item==='object'&&item.source_url)add({name:item.source_name||'Медиа-источник',url:item.source_url,type:'media-source',roles:['media','dna']});
for(const item of reviews.reviews||[])add({...item,kind:'professional-review'});
for(const item of reviews.score_sources||[])add({...item,kind:'professional-review'});
for(const item of rating.sources||[])add({name:item.publication,title:item.title,url:item.url,kind:'professional-review',score:item.original_score?.score,scale:item.original_score?.scale,grade:item.original_score?.grade,score_eligible:true});
const countProfessional=()=>[...seen.values()].filter(x=>x.kind==='professional-review').length,countScored=()=>[...seen.values()].filter(x=>x.kind==='professional-review'&&x.score_eligible).length;

let independentFallback={attempted:false,succeeded:false,error:null,source_count:countProfessional(),scored_count:countScored(),exit_code:null};
if(countProfessional()<minimumProfessional||countScored()<minimumScored){
  independentFallback.attempted=true;
  const run=spawnSync(process.execPath,[path.join(root,'scripts/discover-game-sources-web.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024});independentFallback.exit_code=run.status;
  const discovered=read(`data/research/${slug}-independent-web-sources.json`,{});for(const item of discovered.sources||[])add({...item,kind:'professional-review',provenance:item.provenance||'independent-web-search'});
  independentFallback.source_count=countProfessional();independentFallback.scored_count=countScored();independentFallback.succeeded=Boolean((discovered.sources||[]).length);
  if(run.error)independentFallback.error=String(run.error.message||run.error);else if(run.status!==0&&!(discovered.sources||[]).length)independentFallback.error=String(run.stderr||'independent web search found no usable sources').slice(-2000);
}

const sources=[...seen.values()].sort((a,b)=>Number(Boolean(b.score_eligible))-Number(Boolean(a.score_eligible))||Number(b.kind==='professional-review')-Number(a.kind==='professional-review')||a.name.localeCompare(b.name,'ru'));
const professionalCount=sources.filter(x=>x.kind==='professional-review').length,scoredCount=sources.filter(x=>x.kind==='professional-review'&&x.score_eligible).length;
const corpusMinimumPassed=professionalCount>=minimumProfessional,scoreMinimumPassed=scoredCount>=minimumScored,legacyScanComplete=Boolean(reviews?.source_registry_scan?.complete&&reviews?.external_search?.complete);
const scanComplete=Boolean((legacyScanComplete||independentFallback.attempted)&&corpusMinimumPassed&&scoreMinimumPassed);
const output={schema_version:3,game_slug:slug,game_id:draft.game_id||reviews.game_id||null,title:draft.identity.title,generated_at:checkedAt,ownership:'game-page-module',purpose:'Canonical reusable evidence corpus for game page, Game DNA, media, descriptions, rating and editorial review.',discovery:{editorial_registry_complete:Boolean(reviews?.source_registry_scan?.complete),broad_web_complete:Boolean(reviews?.external_search?.complete||independentFallback.succeeded),complete:scanComplete,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,professional_minimum_passed:corpusMinimumPassed,scored_minimum_passed:scoreMinimumPassed,independent_web_fallback:independentFallback,ai_required:false,legacy_discovery_engine:'scripts/prepare-review-research.mjs'},counts:{total:sources.length,scored:scoredCount,professional_reviews:professionalCount},sources};
write(`data/game-sources/${slug}.json`,output);write(`data/parser-runs/game-sources-${slug}.json`,{parser:'game-source-corpus',status:scanComplete?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,total_sources:sources.length,scored_sources:scoredCount,professional_reviews:professionalCount,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,legacy_discovery_exit_code:legacyRun.status,scan_complete:scanComplete,independent_web_fallback:independentFallback,output:`data/game-sources/${slug}.json`});
console.log(JSON.stringify({slug,status:scanComplete?'green':'needs_revision',total:sources.length,professional_reviews:professionalCount,scored:scoredCount,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,scan_complete:scanComplete,independent_web_fallback:independentFallback},null,2));if(!scanComplete)process.exitCode=2;
