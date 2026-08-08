#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {GameRegistryApi} from './lib/game-registry.mjs';

const root=process.cwd();
const readJson=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const writeJson=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const field=(entity,key,fallback=null)=>entity?.fields?.[key]?.value ?? fallback;
const media=(entity,kinds)=>{const list=entity?.media||[];return list.filter(item=>kinds.includes(item.kind)&&item.url).map(item=>({url:item.url,caption:item.caption||item.kind||'',source_url:item.sourceUrl||item.source_url||''}))};
const firstUrl=(entity,kinds)=>media(entity,kinds)[0]?.url||'';
const catalog=readJson('data/catalog-visible.json',[]);
const registryRaw=readJson('data/game-registry/registry.transition.json',null);
if(!registryRaw)throw new Error('Missing data/game-registry/registry.transition.json');
const api=new GameRegistryApi(registryRaw);
const results=[];
for(const entry of catalog){
  const slug=entry.slug;
  const entity=(entry.game_id&&api.findById(entry.game_id))||api.findBySlug(slug);
  if(!entity){results.push({slug,status:'missing_registry'});continue}
  const title=entity.identity?.canonicalTitle?.value||entry.title||slug;
  const year=entry.year||Number(String((entity.releases||[]).find(r=>r.date?.value)?.date?.value||'').match(/(?:19|20)\d{2}/)?.[0])||null;
  const parserPath=`data/parser-output/${slug}.json`;
  const draftPath=`data/drafts/${slug}.json`;
  if(!fs.existsSync(path.join(root,parserPath))&&!fs.existsSync(path.join(root,draftPath))){
    const steamAppId=entity.externalIds?.steamAppId?Number(entity.externalIds.steamAppId):null;
    const platforms=field(entity,'platforms',[]);
    const shots=media(entity,['screenshot']);
    const videos=(entity.media||[]).filter(item=>['video','trailer','gameplay','review','interview'].includes(item.kind)&&item.url).map(item=>({title:item.caption||item.title||'Видео',url:item.url,thumbnail:item.thumbnail||'',source_url:item.sourceUrl||item.source_url||'',category:item.kind==='trailer'?'trailers':item.kind==='gameplay'?'gameplay':item.kind==='review'?'reviews':item.kind==='interview'?'interviews':'other'}));
    writeJson(parserPath,{schema_version:1,identity:{slug,title,steam_appid:steamAppId},release:{date_text:year?String(year):''},companies:{developers:field(entity,'developers',[]),publishers:field(entity,'publishers',[])},classification:{genres:field(entity,'genres',[]),categories:[],platforms:Array.isArray(platforms)?platforms:[platforms].filter(Boolean)},editorial:{short_description:field(entity,'shortDescription',field(entity,'description','')),integrated_description:field(entity,'description',''),campaign:'',features:field(entity,'features',[])||[]},media:{cover:firstUrl(entity,['cover','keyArt']),hero:firstUrl(entity,['hero','keyArt','cover']),screenshots:shots,videos,artwork:media(entity,['artwork','keyArt'])},requirements:{pc:{minimum:{raw:''},recommended:{raw:''}},platforms:Array.isArray(platforms)?platforms:[platforms].filter(Boolean)},links:{store:steamAppId?`https://store.steampowered.com/app/${steamAppId}/`:'',official:typeof field(entity,'officialLinks',{})==='string'?field(entity,'officialLinks',''):field(entity,'officialLinks',{})?.official||''},source:{name:'Game Registry',url:'',checked_at:new Date().toISOString()}});
  }
  const safeTitle=String(title).replace(/[&<>"']/g,'');
  const pagePath=path.join(root,'game',slug,'index.html');
  fs.mkdirSync(path.dirname(pagePath),{recursive:true});
  if(!fs.existsSync(pagePath))fs.writeFileSync(pagePath,`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css"></head><body data-title="${safeTitle}" data-year="${year||''}" data-slug="${slug}" data-game-id="${entity.id}"><script src="../_shared/game-shell.js"></script></body></html>\n`);
  results.push({slug,status:'materialized',game_id:entity.id,page:`game/${slug}/index.html`,has_article:fs.existsSync(path.join(root,'data/articles',`${slug}.json`))});
}
writeJson('data/parser-runs/catalog-no-api-materialization.json',{schema_version:1,mode:'no-openai-api',generated_at:new Date().toISOString(),total:catalog.length,materialized:results.filter(x=>x.status==='materialized').length,missing_registry:results.filter(x=>x.status==='missing_registry').map(x=>x.slug),missing_articles:results.filter(x=>x.status==='materialized'&&!x.has_article).map(x=>x.slug),results});
console.log(JSON.stringify({total:catalog.length,materialized:results.filter(x=>x.status==='materialized').length,missingRegistry:results.filter(x=>x.status==='missing_registry').length,missingArticles:results.filter(x=>x.status==='materialized'&&!x.has_article).length},null,2));
if(results.some(x=>x.status==='missing_registry'))process.exitCode=2;
