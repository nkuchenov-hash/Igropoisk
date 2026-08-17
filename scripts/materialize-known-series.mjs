#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fieldValue, isEmbeddedGameKind, normalizeText} from './lib/game-registry.mjs';

const root=process.cwd();
const requested=new Set(process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const yearOf=entity=>{
  const years=(entity?.releases||[]).map(item=>Number(String(item?.date?.value??item?.date??'').match(/(?:19|20)\d{2}/)?.[0]||0)).filter(Boolean);
  return years.length?Math.min(...years):null;
};
const registryPath='data/game-registry/registry.transition.json';
const registry=read(registryPath);
if(!registry)throw new Error('Canonical Game Registry is missing.');
const imports=read('data/game-import-requests.json',{imports:[]});
const importBySlug=new Map((imports.imports||[]).filter(item=>item?.slug).map(item=>[String(item.slug).toLowerCase(),item]));
const entities=Object.values(registry.games||{}).filter(entity=>{
  const slug=String(entity?.identity?.slug?.value||'').toLowerCase();
  const kind=entity?.identity?.kind?.value||'unknown';
  return slug&&entity?.workflow?.status!=='merged_into_another_game'&&!isEmbeddedGameKind(kind)&&entity?.presentation?.standalonePage!==false;
});
const seriesName=entity=>{
  const direct=String(entity?.identity?.series?.value||'').trim();
  if(direct)return direct;
  const slug=String(entity?.identity?.slug?.value||'').toLowerCase();
  return String(importBySlug.get(slug)?.series||'').trim();
};
let registryChanged=false;
for(const entity of entities){
  const slug=String(entity.identity?.slug?.value||'').toLowerCase();
  const fallback=String(importBySlug.get(slug)?.series||'').trim();
  if(fallback&&!entity.identity?.series?.value){
    const request=importBySlug.get(slug)||{};
    const source=(request.verification_sources||[])[0]||{type:'manual',name:'verified game import'};
    entity.identity=entity.identity||{};
    entity.identity.series=fieldValue(fallback,{type:source.type||'manual',name:source.name||'verified game import',url:source.url||null},{confidence:Number(request.confidence||0.99)});
    entity.updatedAt=new Date().toISOString();
    entity.auditLog=Array.isArray(entity.auditLog)?entity.auditLog:[];
    entity.auditLog.push({at:entity.updatedAt,action:'canonical_series_backfilled',actor:'known-series-materializer',reason:'verified import series backfill'});
    registryChanged=true;
  }
}
if(registryChanged)write(registryPath,registry);

const requestedSeries=new Set();
if(requested.size){
  for(const entity of entities){
    const slug=String(entity.identity?.slug?.value||'').toLowerCase();
    if(requested.has(slug)||requested.has(String(entity.id||'').toLowerCase())){
      const name=seriesName(entity);if(name)requestedSeries.add(normalizeText(name));
    }
  }
}
const candidates=entities.filter(entity=>{
  const name=seriesName(entity);if(!name)return false;
  return !requested.size||requested.has(String(entity.identity?.slug?.value||'').toLowerCase())||requested.has(String(entity.id||'').toLowerCase())||requestedSeries.has(normalizeText(name));
});
const groups=new Map();
for(const entity of candidates){
  const name=seriesName(entity);const key=normalizeText(name);if(!key)continue;
  if(!groups.has(key))groups.set(key,{name,entities:[]});
  groups.get(key).entities.push(entity);
}
let written=0;
for(const {name,entities:groupEntities} of groups.values()){
  const members=entities.filter(entity=>normalizeText(seriesName(entity))===normalizeText(name)).filter(entity=>{
    const slug=String(entity.identity?.slug?.value||'').toLowerCase();
    return exists(`game/${slug}/index.html`)||exists(`data/drafts/${slug}.json`);
  }).sort((a,b)=>(yearOf(a)||9999)-(yearOf(b)||9999)||String(a.identity?.canonicalTitle?.value||'').localeCompare(String(b.identity?.canonicalTitle?.value||'')));
  if(members.length<2)continue;
  const games=members.map(entity=>{
    const slug=String(entity.identity?.slug?.value||'').toLowerCase();
    const sourceUrl=entity.identity?.series?.source?.url||entity.discovery?.find(item=>item?.source?.url)?.source?.url||'';
    return {game_id:entity.id,title:String(entity.identity?.canonicalTitle?.value||slug),slug,release_year:yearOf(entity),relationship:'series',source_url:sourceUrl};
  });
  for(const target of members){
    const slug=String(target.identity?.slug?.value||'').toLowerCase();
    const payload={schema_version:2,game_slug:slug,checked_at:new Date().toISOString(),name,games,evidence:games.filter(item=>item.source_url).map(item=>({game_id:item.game_id,source_url:item.source_url,basis:'canonical Game Registry series identity'}))};
    write(`data/franchises/${slug}.json`,payload);
    const draft=read(`data/drafts/${slug}.json`);
    if(draft){
      draft.identity={...(draft.identity||{}),series:name};
      draft.relations={...(draft.relations||{}),franchise:payload};
      write(`data/drafts/${slug}.json`,draft);
    }
    written++;
  }
}
console.log(JSON.stringify({requested:[...requested],series_groups:groups.size,files_written:written,registry_backfilled:registryChanged},null,2));
