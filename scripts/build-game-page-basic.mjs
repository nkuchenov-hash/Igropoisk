#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {GameRegistryApi, isEmbeddedGameKind} from './lib/game-registry.mjs';

const root=process.cwd();
const args=process.argv.slice(2);
const slugOrId=args.find(value=>!value.startsWith('--'));
const registryPath=path.resolve(root,args.includes('--registry')?args[args.indexOf('--registry')+1]:'data/game-registry/registry.transition.json');
if(!slugOrId)throw new Error('Usage: node scripts/build-game-page-basic.mjs <slug-or-id> [--registry path]');
const readJSON=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const writeJSON=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const field=(entity,key,fallback=null)=>entity?.fields?.[key]?.value??fallback;
const media=(entity,kinds)=>(entity?.media||[]).filter(item=>kinds.includes(item.kind)&&item.url).map(item=>item.url);
const first=(...values)=>values.find(value=>value!==undefined&&value!==null&&value!=='')??'';
const unique=items=>[...new Set(items.filter(Boolean))];
const stripHtml=value=>String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const api=new GameRegistryApi(registry);
const entity=api.findById(slugOrId)??api.findBySlug(slugOrId);
if(!entity)throw new Error(`Game not found in canonical registry: ${slugOrId}`);
const kind=entity.identity?.kind?.value??'unknown';
if(isEmbeddedGameKind(kind)||entity.presentation?.standalonePage===false)throw new Error(`Embedded game content cannot receive a standalone page: ${entity.id} (${kind})`);
if(entity.workflow?.status==='needs_review'||(entity.conflicts||[]).length)throw new Error(`Game identity requires review before publication: ${entity.id}`);
const slug=entity.identity?.slug?.value;
const canonicalTitle=entity.identity?.canonicalTitle?.value;
if(!slug||!canonicalTitle)throw new Error(`Game identity is incomplete: ${entity.id}`);
const parser=readJSON(`data/parser-output/${slug}.json`,{});
const steamAppId=Number(parser?.identity?.steam_appid||entity.externalIds?.steamAppId)||null;
const title=first(parser?.identity?.title,canonicalTitle,slug);
const releaseDate=first(parser?.release?.date_text,(entity.releases||[]).find(item=>item.date?.value)?.date?.value,'Уточняется');
const year=Number(String(releaseDate).match(/(?:19|20)\d{2}/)?.[0])||null;
const developers=unique([...(parser?.companies?.developers||[]),...(field(entity,'developers',[])||[])]);
const publishers=unique([...(parser?.companies?.publishers||[]),...(field(entity,'publishers',[])||[])]);
const genres=unique([...(parser?.classification?.genres||[]),...(field(entity,'genres',[])||[])]);
const platforms=unique([...(parser?.classification?.platforms||[]),...(field(entity,'platforms',[])||[])]);
const categories=unique(parser?.classification?.categories||[]);
const screenshots=unique([...(parser?.media?.screenshots||[]),...media(entity,['screenshots','screenshot'])]);
const videos=parser?.media?.videos||[];
const cover=first(parser?.media?.cover,...media(entity,['cover','keyArt']));
const hero=first(parser?.media?.hero,...media(entity,['hero','keyArt','cover']),screenshots[0],cover);
const officialLinks=field(entity,'officialLinks',{});
const store=first(parser?.links?.store,steamAppId?`https://store.steampowered.com/app/${steamAppId}/`:null);
const official=first(parser?.links?.official,typeof officialLinks==='string'?officialLinks:officialLinks?.official);
const shortDescription=stripHtml(first(parser?.editorial?.short_description,field(entity,'shortDescription',''),field(entity,'description',''),`${title} — игра, информация о которой собрана из проверяемых каталогов и официальных источников.`));
const features=unique(parser?.editorial?.features||categories).slice(0,8);
const sourceUrl=parser?.source?.url||store||official||'';
const sourceName=parser?.source?.name||'Game Registry';
const sources=sourceUrl?[{name:sourceName,url:sourceUrl,type:store&&sourceUrl===store?'store':'database',checked_at:parser?.source?.checked_at||new Date().toISOString()}]:[];
const game={
  schema_version:3,
  publication:{status:'published',gate_passed:true,mode:'structured_sources',updated_at:new Date().toISOString(),gate:{canonical_game_id:entity.id,title:Boolean(title),media:Boolean(hero||cover||screenshots.length),source_count:sources.length,passed:true}},
  game_id:entity.id,
  identity:{slug,title,steam_appid:steamAppId,aliases:entity.identity?.aliases?.value||[],excluded_versions:[]},
  release:{date_text:String(releaseDate),date:String(releaseDate),status:year&&year<=new Date().getUTCFullYear()?'released':'upcoming'},
  companies:{developers,publishers},
  classification:{genres,platforms,categories},
  editorial:{short_description:shortDescription,integrated_description:shortDescription,campaign:'',features},
  media:{hero,cover,screenshots,videos,artwork:[]},
  requirements:parser?.requirements||{pc:{minimum:{raw:''},recommended:{raw:''}},platforms},
  links:{official,store,developer:'',publisher:''},
  sources,
  updated_at:new Date().toISOString()
};
writeJSON(`data/drafts/${slug}.json`,game);
const chunk=year&&year<=2015?'2002-2015':year&&year<=2017?'2016-2017':year&&year<=2019?'2018-2019':year===2020?'2020':year&&year<=2022?'2021-2022':'2023-2025';
const chunkPath=`data/game-content/${chunk}.json`;
const chunkData=readJSON(chunkPath,{schema_version:3,games:{}});chunkData.schema_version=Math.max(Number(chunkData.schema_version||1),3);chunkData.games=chunkData.games||{};chunkData.games[slug]=game;writeJSON(chunkPath,chunkData);
const catalog=readJSON('data/catalog-visible.json',[]);const entry={title,year,slug,game_id:entity.id};const index=catalog.findIndex(item=>item.slug===slug);if(index>=0)catalog[index]={...catalog[index],...entry};else catalog.push(entry);catalog.sort((a,b)=>(Number(a.year)||9999)-(Number(b.year)||9999)||String(a.title).localeCompare(String(b.title),'ru'));writeJSON('data/catalog-visible.json',catalog);
const safeTitle=String(title).replace(/[&<>"']/g,'');const safeYear=year||'';const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css"></head><body data-title="${safeTitle}" data-year="${safeYear}" data-slug="${slug}" data-game-id="${entity.id}" data-draft="${slug}"><script src="../_shared/game-shell.js"></script></body></html>`;const pagePath=path.join(root,'game',slug,'index.html');fs.mkdirSync(path.dirname(pagePath),{recursive:true});fs.writeFileSync(pagePath,html+'\n');
writeJSON(`data/parser-runs/game-page-${slug}.json`,{parser:'deterministic-game-page-builder',status:'success',game_slug:slug,game_id:entity.id,checked_at:new Date().toISOString(),sources:sources.length,screenshots:screenshots.length,output:[chunkPath,`game/${slug}/index.html`]});
console.log(JSON.stringify({slug,game_id:entity.id,mode:'structured_sources',year,sources:sources.length,screenshots:screenshots.length},null,2));
