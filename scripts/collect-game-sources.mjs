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

// The page module owns source discovery. Use the broad, parallel web search first and cache it
// for the remaining QC passes. Do not serially scan every configured publication here.
let discovered=read(`data/research/${slug}-independent-web-sources.json`,null);
let webRun={status:0,cached:Boolean(discovered)};
if(!discovered){
  const run=spawnSync(process.execPath,[path.join(root,'scripts/discover-game-sources-web.mjs'),slug],{
    cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024
  });
  webRun={status:run.status,cached:false};
  discovered=read(`data/research/${slug}-independent-web-sources.json`,{});
}

const reviews=read(`data/reviews/${slug}.json`,{});
const rating=read(`data/ratings/${slug}.json`,{});
const parser=read(`data/parser-output/${slug}.json`,{});
const seen=new Map();
function add(raw={}){
  const url=canonical(raw.url||raw.resolved_url||raw.source_url||'');
  if(!url)return;
  const key=url.toLowerCase();
  const existing=seen.get(key);
  const rawKind=String(raw.kind||raw.type||raw.source_kind||existing?.kind||'source');
  const kind=['editorial','review','retrospective_review','opinion','longread'].includes(rawKind)?'professional-review':rawKind;
  const roles=[...new Set([...(existing?.roles||[]),...(kind==='professional-review'?['description','dna','review','rating','media']:[]),...(raw.roles||[])].filter(Boolean))];
  const hasScore=raw.score!==null&&raw.score!==''&&raw.scale!==null&&raw.scale!==''&&Number.isFinite(Number(raw.score))&&Number.isFinite(Number(raw.scale))&&Number(raw.scale)>0;
  const next={
    id:existing?.id||`source-${seen.size+1}`,
    name:String(raw.name||raw.publication||raw.source_name||raw.source||existing?.name||host(url)||'Источник'),
    title:String(raw.title||existing?.title||''),
    url,
    domain:host(url),
    kind,
    roles,
    score:hasScore?Number(raw.score):(existing?.score??null),
    scale:hasScore?Number(raw.scale):(existing?.scale??null),
    grade:String(raw.grade||existing?.grade||''),
    score_eligible:Boolean(raw.score_eligible??existing?.score_eligible??false),
    checked_at:String(raw.checked_at||raw.validation?.checked_at||existing?.checked_at||checkedAt),
    provenance:String(raw.provenance||existing?.provenance||'game-page-source-corpus')
  };
  if(Number.isFinite(next.score)&&Number.isFinite(next.scale)&&next.scale>0){next.score_eligible=true;next.normalized_10=Number((next.score/next.scale*10).toFixed(3));}
  else if(next.grade)next.score_eligible=true;
  seen.set(key,next);
}

for(const item of draft.sources||[])add({...item,roles:['facts','description','dna']});
if(parser?.source?.url)add({name:parser.source.name||'Parser source',url:parser.source.url,type:'structured-source',roles:['identity','facts','requirements','media']});
if(draft.links?.official)add({name:'Официальный сайт',url:draft.links.official,type:'official',roles:['identity','facts','media','description','dna']});
if(draft.links?.store)add({name:'Страница магазина',url:draft.links.store,type:'store',roles:['identity','facts','requirements','media','description','dna']});
for(const item of [...(draft.media?.screenshots||[]),...(draft.media?.artwork||[]),...(draft.media?.videos||[])])if(item&&typeof item==='object'&&item.source_url)add({name:item.source_name||'Медиа-источник',url:item.source_url,type:'media-source',roles:['media','dna']});

// Existing verified sources are useful seeds, but they no longer control or delay page discovery.
for(const item of reviews.reviews||[])add({...item,kind:'professional-review'});
for(const item of reviews.score_sources||[])add({...item,kind:'professional-review'});
for(const item of discovered?.sources||[])add({...item,kind:'professional-review',provenance:item.provenance||'independent-web-search'});
for(const item of rating.sources||[])add({name:item.publication,title:item.title,url:item.url,kind:'professional-review',score:item.original_score?.score,scale:item.original_score?.scale,grade:item.original_score?.grade,score_eligible:true});

const sources=[...seen.values()].sort((a,b)=>Number(Boolean(b.score_eligible))-Number(Boolean(a.score_eligible))||Number(b.kind==='professional-review')-Number(a.kind==='professional-review')||a.name.localeCompare(b.name,'ru'));
const professionalCount=sources.filter(item=>item.kind==='professional-review').length;
const scoredCount=sources.filter(item=>item.kind==='professional-review'&&item.score_eligible).length;
const corpusMinimumPassed=professionalCount>=minimumProfessional;
const scoreMinimumPassed=scoredCount>=minimumScored;
const scanComplete=Boolean(corpusMinimumPassed&&scoreMinimumPassed);
const output={
  schema_version:5,
  game_slug:slug,
  game_id:draft.game_id||reviews.game_id||null,
  title:draft.identity.title,
  generated_at:checkedAt,
  ownership:'game-page-module',
  purpose:'Canonical reusable evidence corpus for game page, Game DNA, media, descriptions, rating and editorial review.',
  discovery:{
    method:'broad-parallel-web-search-plus-live-verification',
    complete:scanComplete,
    minimum_professional_sources:minimumProfessional,
    minimum_scored_sources:minimumScored,
    professional_minimum_passed:corpusMinimumPassed,
    scored_minimum_passed:scoreMinimumPassed,
    web_search_cached:webRun.cached,
    web_discovery_exit_code:webRun.status,
    providers:discovered?.providers||{},
    query_count:discovered?.queries||0,
    candidate_count:discovered?.candidates||0,
    accepted_count:discovered?.accepted||0,
    ai_required:false
  },
  counts:{total:sources.length,scored:scoredCount,professional_reviews:professionalCount},
  sources
};
write(`data/game-sources/${slug}.json`,output);
write(`data/parser-runs/game-sources-${slug}.json`,{parser:'game-source-corpus',status:scanComplete?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,total_sources:sources.length,scored_sources:scoredCount,professional_reviews:professionalCount,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,web_search_cached:webRun.cached,web_discovery_exit_code:webRun.status,scan_complete:scanComplete,output:`data/game-sources/${slug}.json`});
console.log(JSON.stringify({slug,status:scanComplete?'green':'needs_revision',total:sources.length,professional_reviews:professionalCount,scored:scoredCount,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,scan_complete:scanComplete,web_search_cached:webRun.cached,web_discovery_ms:discovered?.elapsed_ms??null},null,2));
if(!scanComplete)process.exitCode=2;
