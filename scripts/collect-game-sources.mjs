#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/collect-game-sources.mjs <game-slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const canonical=value=>{try{const u=new URL(String(value||''));u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(String(value||'')).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const draft=read(`data/drafts/${slug}.json`);
if(!draft?.identity?.title)throw new Error(`Missing game draft for ${slug}`);
const checkedAt=new Date().toISOString();
const quality=read('config/game-page-quality-v2.json',{});
const corpusPolicy=quality.game_source_corpus||quality.review_corpus||{};
const ratingPolicy=quality.rating||{};
const minimumProfessional=Number(corpusPolicy.minimum_professional_sources??corpusPolicy.minimum_sources??10);
const minimumScored=Number(ratingPolicy.minimum_sources??5);

const research=spawnSync(process.execPath,[path.join(root,'scripts/prepare-review-research.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024});
const reviews=read(`data/reviews/${slug}.json`,{});
const rating=read(`data/ratings/${slug}.json`,{});
const parser=read(`data/parser-output/${slug}.json`,{});

const sources=[];
const seen=new Map();
function add(raw={}){
  const url=canonical(raw.url||raw.resolved_url||raw.source_url||'');
  if(!url)return;
  const key=url.toLowerCase();
  const existing=seen.get(key);
  const rawKind=String(raw.kind||raw.type||raw.source_kind||existing?.kind||'source');
  const kind=rawKind==='editorial'?'professional-review':rawKind;
  const defaultRoles=kind==='professional-review'?['description','dna','review','rating','media']:[];
  const roles=[...new Set([...(existing?.roles||[]),...defaultRoles,...(raw.roles||[])].filter(Boolean))];
  const next={id:existing?.id||`source-${seen.size+1}`,name:String(raw.name||raw.publication||raw.source_name||raw.source||existing?.name||host(url)||'Источник'),title:String(raw.title||existing?.title||''),url,domain:host(url),kind,roles,score:Number.isFinite(Number(raw.score))?Number(raw.score):(existing?.score??null),scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):(existing?.scale??null),grade:String(raw.grade||existing?.grade||''),score_eligible:Boolean(raw.score_eligible??existing?.score_eligible??false),checked_at:String(raw.checked_at||raw.validation?.checked_at||existing?.checked_at||checkedAt),provenance:String(raw.provenance||existing?.provenance||'game-page-source-corpus')};
  if(Number.isFinite(next.score)&&Number.isFinite(next.scale)&&next.scale>0){next.score_eligible=true;next.normalized_10=Number((next.score/next.scale*10).toFixed(3));}else if(next.grade)next.score_eligible=true;
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
const countProfessional=()=>[...seen.values()].filter(item=>item.kind==='professional-review').length;
const countScored=()=>[...seen.values()].filter(item=>item.kind==='professional-review'&&item.score_eligible).length;

let independentFallback={attempted:false,succeeded:false,error:null,source_count:0,scored_count:0,exit_code:null};
if(countProfessional()<minimumProfessional||countScored()<minimumScored){
  independentFallback.attempted=true;
  const run=spawnSync(process.execPath,[path.join(root,'scripts/discover-game-sources-web.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024});
  independentFallback.exit_code=run.status;
  const discovered=read(`data/research/${slug}-independent-web-sources.json`,{});
  for(const item of discovered.sources||[])add({...item,kind:'professional-review',provenance:item.provenance||'independent-web-search'});
  independentFallback.source_count=countProfessional();independentFallback.scored_count=countScored();independentFallback.succeeded=Boolean(discovered.accepted>0);
  if(run.error)independentFallback.error=String(run.error.message||run.error);else if(run.status!==0&&!(discovered.sources||[]).length)independentFallback.error=String(run.stderr||'independent web search found no usable sources').slice(-2000);
}

let aiFallback={attempted:false,succeeded:false,error:null,source_count:0,scored_count:0};
async function discoverWithOpenAI(){
  if(!process.env.OPENAI_API_KEY)return null;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:`Найди максимально полный корпус прямых профессиональных рецензий именно на игру "${draft.identity.title}". Нужны прямые URL конкретных рецензий. Ищи английские и русские издания. Для каждой рецензии извлеки оценку и шкалу только если они явно опубликованы. Цель: минимум ${minimumProfessional} материалов и ${minimumScored} подтверждённых оценок. Не используй Metacritic/OpenCritic как рецензии.`,text:{format:{type:'json_schema',name:'game_professional_sources',strict:true,schema:{type:'object',additionalProperties:false,required:['sources'],properties:{sources:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,required:['publication','title','url','source_kind','score','scale','grade'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},source_kind:{type:'string'},score:{type:['number','null']},scale:{type:['number','null']},grade:{type:'string'}}}}}}}})});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('OpenAI source discovery returned no structured output');return JSON.parse(text);
}
if(countProfessional()<minimumProfessional||countScored()<minimumScored){
  aiFallback.attempted=true;try{const discovered=await discoverWithOpenAI();for(const item of discovered?.sources||[]){const url=canonical(item.url);if(!url||/(metacritic\.com|opencritic\.com|reddit\.com|steamcommunity\.com)/i.test(host(url)))continue;add({...item,kind:'professional-review',score_eligible:Boolean((Number.isFinite(Number(item.score))&&Number.isFinite(Number(item.scale))&&Number(item.scale)>0)||String(item.grade||'').trim()),provenance:'openai-web-search-fallback'});}aiFallback.succeeded=true;aiFallback.source_count=countProfessional();aiFallback.scored_count=countScored();}catch(error){aiFallback.error=String(error?.message||error);}
}
for(const value of seen.values())sources.push(value);
sources.sort((a,b)=>Number(Boolean(b.score_eligible))-Number(Boolean(a.score_eligible))||Number(b.kind==='professional-review')-Number(a.kind==='professional-review')||a.name.localeCompare(b.name,'ru'));
const legacyScanComplete=Boolean(reviews?.source_registry_scan?.complete&&reviews?.external_search?.complete);
const professionalCount=sources.filter(item=>item.kind==='professional-review').length,scoredCount=sources.filter(item=>item.kind==='professional-review'&&item.score_eligible).length;
const corpusMinimumPassed=professionalCount>=minimumProfessional,scoreMinimumPassed=scoredCount>=minimumScored;
const discoveryAttempted=legacyScanComplete||independentFallback.attempted||aiFallback.attempted;
const scanComplete=Boolean(discoveryAttempted&&corpusMinimumPassed&&scoreMinimumPassed);
const output={schema_version:3,game_slug:slug,game_id:draft.game_id||reviews.game_id||null,title:draft.identity.title,generated_at:checkedAt,ownership:'game-page-module',purpose:'Canonical reusable evidence corpus for game page, Game DNA, media, descriptions, rating and editorial review.',discovery:{editorial_registry_complete:Boolean(reviews?.source_registry_scan?.complete),broad_web_complete:Boolean(reviews?.external_search?.complete||independentFallback.succeeded||aiFallback.succeeded),complete:scanComplete,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,professional_minimum_passed:corpusMinimumPassed,scored_minimum_passed:scoreMinimumPassed,independent_web_fallback:independentFallback,ai_fallback:aiFallback,legacy_discovery_engine:'scripts/prepare-review-research.mjs'},counts:{total:sources.length,scored:scoredCount,professional_reviews:professionalCount},sources};
write(`data/game-sources/${slug}.json`,output);write(`data/parser-runs/game-sources-${slug}.json`,{parser:'game-source-corpus',status:scanComplete?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,total_sources:output.counts.total,scored_sources:output.counts.scored,professional_reviews:output.counts.professional_reviews,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,editorial_discovery_exit_code:research.status,scan_complete:scanComplete,independent_web_fallback:independentFallback,ai_fallback:aiFallback,output:`data/game-sources/${slug}.json`});
console.log(JSON.stringify({slug,status:scanComplete?'green':'needs_revision',...output.counts,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,scan_complete:scanComplete,independent_web_fallback:independentFallback,ai_fallback:aiFallback},null,2));if(!scanComplete)process.exitCode=2;
