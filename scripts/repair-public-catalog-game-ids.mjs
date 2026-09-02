#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {migrateRepository} from './lib/game-registry-migration.mjs';
import {projectPublicCatalog} from './lib/system-game-registry-adapter.mjs';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const catalog=read('data/catalog-visible.json',[]),{registry}=migrateRepository(root,{dryRun:true,publicBaseUrl:'/game'}),projected=projectPublicCatalog(catalog,registry),unresolved=projected.issues.filter(issue=>issue.status==='unresolved');if(unresolved.length)throw new Error(`Public catalog contains unresolved Game Registry identities: ${JSON.stringify(unresolved)}`);
const plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
let missingIds=0,queued=0,conflicts=0;
for(let index=0;index<catalog.length;index++){
  const item=catalog[index],projectedId=String(projected.records[index]?.game_id||'').trim(),pinned=String(item?.game_id||'').trim(),slug=String(item?.slug||'').trim();
  if(pinned&&projectedId&&projectedId!==pinned){conflicts++;continue}
  if(pinned||!projectedId||!slug)continue;missingIds++;
  if(!plan.pages.some(task=>task.slug===slug)){plan.pages.push({type:'build_page',game_id:projectedId,slug,title:item.title||slug,steam_appid:Number(item.steam_appid)||null,priority:1200,reason:'public_catalog_identity_requires_canonical_page_revision'});queued++}
}
if(conflicts)throw new Error(`Public catalog contains ${conflicts} canonical identity conflict(s); direct public repair is forbidden.`);
plan.updated_at=new Date().toISOString();write('data/content-pipeline/execution-plan.json',plan);
console.log(JSON.stringify({records:catalog.length,missing_game_ids:missingIds,queued_canonical_revisions:queued,public_catalog_mutations:0,policy:'public identity changes are applied only by the Game Page finalizer'},null,2));
