#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
const gameIdArg=String(process.argv[3]||'').trim();
if(!slug)throw new Error('Usage: node scripts/finalize-game-page-publication.mjs <game-slug> [game-id]');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`);
const pageQc=read(`data/quality-control/page-${slug}-control.json`,{});
const contentQc=read(`data/quality-control/game-page-content-${slug}.json`,{});
const mediaQc=read(`data/quality-control/game-page-${slug}.json`,{});
const corpus=read(`data/game-sources/${slug}.json`,{});
const editorial=read(`data/page-editorial/${slug}.json`);
const errors=[];
if(!draft?.identity?.title)errors.push('draft missing');
if(pageQc?.status!=='green'||pageQc?.green!==true)errors.push('page QC is not green');
if(contentQc?.status!=='green')errors.push('content QC is not green');
if(mediaQc?.status!=='green')errors.push('media QC is not green');
if(!corpus?.discovery?.complete)errors.push('source discovery is incomplete');
if(editorial?.quality_status!=='green'||editorial?.game_slug!==slug)errors.push('canonical page editorial is not green');
if(errors.length){console.error(JSON.stringify({slug,status:'blocked',errors},null,2));process.exit(2)}
const now=new Date().toISOString();
const year=Number(editorial.release_year||String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
if(!year)throw new Error(`Cannot determine release year for ${slug}`);
const gameId=gameIdArg||String(draft.game_id||pageQc.game_id||'').trim();
draft.publication={...(draft.publication||{}),status:'published',gate_passed:true,public_ready:true,quality_status:'green',finalized_at:now};
draft.editorial={...(draft.editorial||{}),short_description:editorial.short_description,integrated_description:editorial.integrated_description,campaign:editorial.campaign,features:editorial.features};
draft.updated_at=now;if(gameId)draft.game_id=gameId;
write(`data/drafts/${slug}.json`,draft);
const chunk=year<=2015?'2002-2015':year<=2017?'2016-2017':year<=2019?'2018-2019':year===2020?'2020':year<=2022?'2021-2022':'2023-2025';
const chunkPath=`data/game-content/${chunk}.json`;const chunkData=read(chunkPath,{schema_version:4,games:{}});chunkData.schema_version=Math.max(Number(chunkData.schema_version||1),4);chunkData.games=chunkData.games||{};chunkData.games[slug]=draft;write(chunkPath,chunkData);
const catalog=read('data/catalog-visible.json',[]);const entry={title:draft.identity.title,year,slug,...(gameId?{game_id:gameId}:{}),...(draft.identity?.steam_appid?{steam_appid:draft.identity.steam_appid}:{})};const index=catalog.findIndex(item=>item.slug===slug);if(index>=0)catalog[index]={...catalog[index],...entry};else catalog.push(entry);catalog.sort((a,b)=>Number(a.year)-Number(b.year)||String(a.title).localeCompare(String(b.title),'ru'));write('data/catalog-visible.json',catalog);
const pagePath=path.join(root,'game',slug,'index.html');if(!fs.existsSync(pagePath)){const safeTitle=String(draft.identity.title).replace(/[&<>"']/g,'');const idAttr=gameId?` data-game-id="${gameId}"`:'';const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body data-title="${safeTitle}" data-year="${year}" data-slug="${slug}" data-draft="${slug}"${idAttr}><script src="../_shared/game-shell.js"></script><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>`;fs.mkdirSync(path.dirname(pagePath),{recursive:true});fs.writeFileSync(pagePath,html+'\n')}
write(`data/parser-runs/game-page-finalize-${slug}.json`,{parser:'game-page-publication-finalizer',status:'green',game_slug:slug,game_id:gameId||null,checked_at:now,quality:{page:'green',content:'green',media:'green',sources:'complete',editorial:'green'},output:[`data/page-editorial/${slug}.json`,chunkPath,`game/${slug}/index.html`,'data/catalog-visible.json']});
console.log(JSON.stringify({slug,status:'published',year,game_id:gameId||null},null,2));
