#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {extractAudienceSignalIds} from './lib/game-audience-profile.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/collect-game-audience-evidence.mjs <slug>');
const read=(relative,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const clean=value=>String(value??'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const asList=value=>Array.isArray(value)?value.map(item=>clean(typeof item==='object'?(item.name||item.label||item.value||item.title||''):item)).filter(Boolean):[];
const uniq=values=>[...new Set(values.filter(Boolean))];
const draft=read(`data/drafts/${slug}.json`),parser=read(`data/parser-output/${slug}.json`),corpus=read(`data/game-sources/${slug}.json`),reviews=read(`data/reviews/${slug}.json`),research=read(`data/research/${slug}-source-matrix.json`),knowledge=read(`data/game-knowledge/${slug}.json`),demographics=read(`data/research/${slug}-audience-demographics.json`,null);
const prior=read(`data/research/${slug}-audience-evidence.json`,{});
const appid=Number(draft?.identity?.steam_appid||parser?.identity?.steam_appid||0)||null;
const descriptors={
  genres:uniq([...asList(draft?.classification?.genres),...asList(parser?.classification?.genres),...asList(knowledge?.classification?.genres)]),
  categories:uniq([...asList(draft?.classification?.categories),...asList(parser?.classification?.categories)]),
  tags:uniq([...asList(draft?.classification?.tags),...asList(parser?.tags),...asList(parser?.classification?.tags),...asList(corpus?.tags),...asList(corpus?.audience_signals?.tags),...asList(knowledge?.tags)]),
  themes:uniq([...asList(draft?.classification?.themes),...asList(parser?.themes),...asList(parser?.classification?.themes),...asList(corpus?.themes),...asList(knowledge?.themes)]),
  player_perspectives:uniq([...asList(draft?.classification?.player_perspectives),...asList(parser?.player_perspectives),...asList(corpus?.player_perspectives),...asList(knowledge?.player_perspectives)]),
  game_modes:uniq([...asList(draft?.classification?.game_modes),...asList(parser?.game_modes),...asList(corpus?.game_modes),...asList(knowledge?.game_modes)])
};

async function steamTags(){
  if(Array.isArray(prior?.steam?.tags)&&prior.steam.tags.length)return{status:'cached',source_url:prior.steam.source_url||null,tags:prior.steam.tags};
  if(!appid)return{status:'unavailable',reason:'steam_appid_missing',source_url:null,tags:[]};
  const sourceUrl=`https://store.steampowered.com/app/${appid}/?l=english&cc=us`;
  try{
    const response=await fetch(sourceUrl,{headers:{'user-agent':'Mozilla/5.0 IgropoiskAudienceProfile/1.0','cookie':'birthtime=0; lastagecheckage=1-January-1970'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const html=await response.text(),tags=[];
    for(const match of html.matchAll(/<a[^>]*class=["'][^"']*app_tag[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)){
      const tag=clean(match[1]);if(tag&&!tags.includes(tag))tags.push(tag);if(tags.length>=30)break;
    }
    return{status:tags.length?'collected':'empty',source_url:sourceUrl,tags:tags.map((name,index)=>({name,rank:index+1,source:'steam-store-popular-tags'}))};
  }catch(error){return{status:'unavailable',reason:String(error?.message||error),source_url:sourceUrl,tags:[]}}
}
const steam=await steamTags();
for(const item of steam.tags||[])if(item?.name&&!descriptors.tags.includes(item.name))descriptors.tags.push(item.name);

const reviewItems=[...(Array.isArray(reviews?.reviews)?reviews.reviews:[]),...(Array.isArray(research?.accepted)?research.accepted:[]),...(Array.isArray(corpus?.sources)?corpus.sources.filter(item=>item?.professional||item?.kind==='professional-review'):[])];
const recurring=new Map();
reviewItems.forEach((item,index)=>{
  const text=clean(item.excerpt||item.summary||item.snippet||item.description||item.text||item.content||[...(item.praise||[]),...(item.criticism||[])].join(' ')||item.title||'').slice(0,6000);
  if(!text)return;
  const source=clean(item.publication||item.name||item.domain||item.url||`review-${index+1}`);
  for(const signal of extractAudienceSignalIds(text)){const sources=recurring.get(signal)||new Set();sources.add(source);recurring.set(signal,sources)}
});
const review_signals=[...recurring.entries()].filter(([,sources])=>sources.size>=2).map(([signal,sources])=>({signal,independent_sources:sources.size,sources:[...sources].slice(0,8)})).sort((a,b)=>b.independent_sources-a.independent_sources||a.signal.localeCompare(b.signal));
const aggregate_demographics=(demographics&&typeof demographics==='object'&&!Array.isArray(demographics)&&clean(demographics.source||demographics.provenance))?demographics:null;
const explicit_age_rating=clean(draft?.classification?.age_rating||draft?.classification?.content_rating||draft?.classification?.esrb||draft?.classification?.pegi||parser?.age_rating||parser?.content_rating||'')||null;
const content_descriptors=uniq([...asList(draft?.classification?.content_descriptors),...asList(parser?.content_descriptors),...asList(knowledge?.content_descriptors)]);
const output={schema_version:1,game_slug:slug,generated_at:new Date().toISOString(),visibility:'internal_only',collection:{mode:'deterministic-multi-source',ai_required:false,fail_open:true,public_render_allowed:false},steam,descriptors,review_signals,review_items_scanned:reviewItems.length,explicit_age_rating,content_descriptors,aggregate_demographics};
write(`data/research/${slug}-audience-evidence.json`,output);
write(`data/parser-runs/game-audience-evidence-${slug}.json`,{parser:'game-audience-evidence',status:'completed',game_slug:slug,checked_at:output.generated_at,steam_status:steam.status,steam_tags:steam.tags?.length||0,review_items_scanned:reviewItems.length,recurring_review_signals:review_signals.length,aggregate_demographics_provided:Boolean(aggregate_demographics),ai_required:false,fail_open:true,output:`data/research/${slug}-audience-evidence.json`});
console.log(JSON.stringify({slug,status:'completed',steam_status:steam.status,steam_tags:steam.tags?.length||0,review_items_scanned:reviewItems.length,review_signals:review_signals.map(x=>x.signal),aggregate_demographics_provided:Boolean(aggregate_demographics)},null,2));
