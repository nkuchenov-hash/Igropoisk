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

// Editorial publications are one class of evidence in the Game Page source corpus.
// Keep the existing discovery engine for compatibility, but the canonical ownership/output
// is data/game-sources/<slug>.json and is consumed by page, DNA, media, rating and review systems.
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
  const roles=[...new Set([...(existing?.roles||[]),...(raw.roles||[])].filter(Boolean))];
  const next={
    id:existing?.id||`source-${seen.size+1}`,
    name:String(raw.name||raw.publication||raw.source_name||raw.source||existing?.name||host(url)||'Источник'),
    title:String(raw.title||existing?.title||''),
    url,
    domain:host(url),
    kind:String(raw.kind||raw.type||raw.source_kind||existing?.kind||'source'),
    roles,
    score:Number.isFinite(Number(raw.score))?Number(raw.score):(existing?.score??null),
    scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):(existing?.scale??null),
    grade:String(raw.grade||existing?.grade||''),
    score_eligible:Boolean(raw.score_eligible??existing?.score_eligible??false),
    checked_at:String(raw.checked_at||raw.validation?.checked_at||existing?.checked_at||checkedAt),
    provenance:String(raw.provenance||existing?.provenance||'game-page-source-corpus')
  };
  if(Number.isFinite(next.score)&&Number.isFinite(next.scale)&&next.scale>0){next.score_eligible=true;next.normalized_10=Number((next.score/next.scale*10).toFixed(3));}
  seen.set(key,next);
}

for(const item of draft.sources||[])add({...item,roles:['facts','description','dna']});
if(parser?.source?.url)add({name:parser.source.name||'Parser source',url:parser.source.url,type:'structured-source',roles:['identity','facts','requirements','media']});
if(draft.links?.official)add({name:'Официальный сайт',url:draft.links.official,type:'official',roles:['identity','facts','media','description','dna']});
if(draft.links?.store)add({name:'Страница магазина',url:draft.links.store,type:'store',roles:['identity','facts','requirements','media','description','dna']});
for(const item of [...(draft.media?.screenshots||[]),...(draft.media?.artwork||[]),...(draft.media?.videos||[])]){
  if(item&&typeof item==='object'&&item.source_url)add({name:item.source_name||'Медиа-источник',url:item.source_url,type:'media-source',roles:['media','dna']});
}
for(const item of reviews.reviews||[])add({...item,kind:'professional-review',roles:['description','dna','review','rating','media']});
for(const item of reviews.score_sources||[])add({...item,kind:'professional-review',roles:['rating','review','dna']});
for(const item of rating.sources||[])add({name:item.publication,title:item.title,url:item.url,kind:'professional-review',roles:['rating','review','dna'],score:item.original_score?.score,scale:item.original_score?.scale,grade:item.original_score?.grade,score_eligible:true});

for(const value of seen.values())sources.push(value);
sources.sort((a,b)=>Number(Boolean(b.score_eligible))-Number(Boolean(a.score_eligible))||a.name.localeCompare(b.name,'ru'));
const scanComplete=Boolean(reviews?.source_registry_scan?.complete&&reviews?.external_search?.complete);
const output={
  schema_version:1,
  game_slug:slug,
  game_id:draft.game_id||reviews.game_id||null,
  title:draft.identity.title,
  generated_at:checkedAt,
  ownership:'game-page-module',
  purpose:'Canonical reusable evidence corpus for game page, Game DNA, media, descriptions, rating and editorial review.',
  discovery:{editorial_registry_complete:Boolean(reviews?.source_registry_scan?.complete),broad_web_complete:Boolean(reviews?.external_search?.complete),complete:scanComplete,legacy_discovery_engine:'scripts/prepare-review-research.mjs'},
  counts:{total:sources.length,scored:sources.filter(item=>item.score_eligible).length,professional_reviews:sources.filter(item=>item.kind==='professional-review').length},
  sources
};
write(`data/game-sources/${slug}.json`,output);
write(`data/parser-runs/game-sources-${slug}.json`,{parser:'game-source-corpus',status:scanComplete?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,total_sources:output.counts.total,scored_sources:output.counts.scored,professional_reviews:output.counts.professional_reviews,editorial_discovery_exit_code:research.status,scan_complete:scanComplete,output:`data/game-sources/${slug}.json`});
console.log(JSON.stringify({slug,status:scanComplete?'green':'needs_revision',...output.counts,scan_complete:scanComplete},null,2));
if(!scanComplete)process.exitCode=2;
