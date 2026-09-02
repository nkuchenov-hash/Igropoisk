#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi} from './lib/game-registry.mjs';
import {decodeNewsGameRequests,registerNewsGameCandidates} from './lib/news-game-registry-discovery.mjs';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const run=(command,args,env={})=>spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,...env},maxBuffer:16*1024*1024});
const requests=decodeNewsGameRequests(process.env.NEWS_GAME_REQUESTS_B64||'');
if(!requests.length){write('tmp/news-game-page-fast.json',{schema_version:4,generated_at:new Date().toISOString(),requested:0,ready_count:0,queued_count:0,failed_count:0,ready_games:[],queued_games:[],failed:[],parser_warnings:[],identity_issues:[]});console.log('[news/game-page-fast] no requests');process.exit(0)}

const registryPath='data/game-registry/registry.transition.json';
const registry=read(registryPath);if(!registry)throw new Error('Canonical Game Registry is missing before news page request.');
const discovery=registerNewsGameCandidates(registry,requests);write(registryPath,discovery.registry);const api=new GameRegistryApi(discovery.registry);
const requestByGameId=new Map();
for(const resolved of discovery.resolved){const previous=requestByGameId.get(resolved.game_id);requestByGameId.set(resolved.game_id,previous?{...previous,news_ids:[...new Set([...(previous.news_ids||[]),resolved.news_id].filter(Boolean))],source_url:previous.source_url||resolved.source_url||null}:{...resolved,news_ids:[resolved.news_id].filter(Boolean)})}

const isFinalized=slug=>{
  const draft=read(`data/drafts/${slug}.json`),editorial=read(`data/page-editorial/${slug}.json`),pageQc=read(`data/quality-control/page-${slug}-control.json`),contentQc=read(`data/quality-control/game-page-content-${slug}.json`),mediaQc=read(`data/quality-control/game-page-${slug}.json`),corpus=read(`data/game-sources/${slug}.json`);
  return exists(`game/${slug}/index.html`)&&draft?.publication?.status==='published'&&draft?.publication?.public_ready===true&&editorial?.game_slug===slug&&editorial?.quality_status==='green'&&pageQc?.status==='green'&&pageQc?.green===true&&contentQc?.status==='green'&&mediaQc?.status==='green'&&corpus?.discovery?.complete===true;
};
const queueExisting=(entity,slug,title,reason)=>{
  const plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
  if(!plan.pages.some(item=>item.slug===slug))plan.pages.push({type:'build_page',game_id:entity.id,slug,title,steam_appid:Number(entity.externalIds?.steamAppId)||null,priority:5000,reason});plan.updated_at=new Date().toISOString();write('data/content-pipeline/execution-plan.json',plan);
};

const readyGames=[],queuedGames=[],failed=[],parserWarnings=[];
for(const resolved of requestByGameId.values()){
  const entity=api.findById(resolved.game_id);if(!entity){failed.push({game_id:resolved.game_id,slug:resolved.slug,title:resolved.title,reason:'canonical entity disappeared after registration'});continue}
  const slug=String(entity.identity?.slug?.value||resolved.slug||'').trim().toLowerCase(),title=String(entity.identity?.canonicalTitle?.value||resolved.title||slug).trim(),gameId=entity.id;
  if(!slug||!title||!gameId){failed.push({game_id:gameId||null,slug:slug||null,title:title||null,reason:'canonical identity incomplete'});continue}
  if(isFinalized(slug)){readyGames.push({game_id:gameId,slug,title,reused:true,news_ids:resolved.news_ids||[]});continue}

  const parserPath=`data/parser-output/${slug}.json`,appId=Number(entity.externalIds?.steamAppId)||null;let parserOk=exists(parserPath);
  if(!parserOk){const parsed=run('node',['scripts/parse-game-data.mjs',slug,appId?String(appId):'auto',title]);parserOk=parsed.status===0&&exists(parserPath);if(!parserOk)parserWarnings.push({game_id:gameId,slug,title,reason:'optional structured parser unavailable; Page Assembly remains queued',stderr:(parsed.stderr||'').slice(-3000),stdout:(parsed.stdout||'').slice(-3000),news_ids:resolved.news_ids||[]})}

  if(exists(`game/${slug}/index.html`)||exists(`data/drafts/${slug}.json`)){
    queueExisting(entity,slug,title,'news_requested_page_requires_canonical_repair');
  }else{
    const requested=run('node',['scripts/ensure-game-page.mjs',gameId],{GAME_CREATOR_SOURCE:'news',GAME_SOURCE_URL:resolved.source_url||''});
    if(requested.status!==0){failed.push({game_id:gameId,slug,title,reason:'Page Assembly request failed',stderr:(requested.stderr||'').slice(-3000),stdout:(requested.stdout||'').slice(-3000),news_ids:resolved.news_ids||[]});continue}
  }
  queuedGames.push({game_id:gameId,slug,title,parser_enriched:parserOk,news_ids:resolved.news_ids||[],publication_owner:'scripts/finalize-game-page-publication.mjs'});
}

const requiredGames=[...requestByGameId.values()].map(item=>{const entity=api.findById(item.game_id);return{game_id:item.game_id,slug:String(entity?.identity?.slug?.value||item.slug||''),title:String(entity?.identity?.canonicalTitle?.value||item.title||''),news_ids:item.news_ids||[]}});
const report={schema_version:4,generated_at:new Date().toISOString(),adapter:'news->game-page-assembly',requested:requests.length,canonical_resolved:requestByGameId.size,created_in_registry:discovery.created,matched_in_registry:discovery.matched,ready_count:readyGames.length,queued_count:queuedGames.length,failed_count:failed.length+discovery.issues.length,parser_warning_count:parserWarnings.length,ready_games:readyGames,queued_games:queuedGames,failed,parser_warnings:parserWarnings,identity_issues:discovery.issues};
write('tmp/news-game-page-fast.json',report);write('tmp/news-game-page-plan.json',{schema_version:7,generated_at:report.generated_at,requested:requests,resolved:[...requestByGameId.values()],required_games:requiredGames,finalized_ready_games:readyGames,queued_games:queuedGames,identity_issues:discovery.issues,parser_warnings:parserWarnings,failed});
console.log(JSON.stringify(report,null,2));if(report.ready_count===0&&report.queued_count===0&&report.failed_count>0)process.exitCode=1;
