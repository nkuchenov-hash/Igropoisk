#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi,isEmbeddedGameKind} from './lib/game-registry.mjs';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const top=read('data/top-250/current.json');const registry=read('data/game-registry/registry.transition.json');
if(!top)throw new Error('Missing data/top-250/current.json');if(!registry)throw new Error('Missing canonical Game Registry transition snapshot');
const api=new GameRegistryApi(registry),plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
const queued=[],alreadyFinalized=[],skipped=[];
const green=slug=>{const draft=read(`data/drafts/${slug}.json`),editorial=read(`data/page-editorial/${slug}.json`),pageQc=read(`data/quality-control/page-${slug}-control.json`),contentQc=read(`data/quality-control/game-page-content-${slug}.json`),mediaQc=read(`data/quality-control/game-page-${slug}.json`),corpus=read(`data/game-sources/${slug}.json`);return fs.existsSync(path.join(root,`game/${slug}/index.html`))&&draft?.publication?.status==='published'&&draft?.publication?.public_ready===true&&editorial?.game_slug===slug&&editorial?.quality_status==='green'&&pageQc?.status==='green'&&pageQc?.green===true&&contentQc?.status==='green'&&mediaQc?.status==='green'&&corpus?.discovery?.complete===true};
for(const item of top.ranking||[]){
  let entity=item.game_id?api.findById(String(item.game_id)):null;entity??=api.findBySlug(String(item.slug||''));if(!entity){skipped.push({slug:item.slug,reason:'canonical_identity_missing'});continue}
  const kind=entity.identity?.kind?.value||'unknown';if(isEmbeddedGameKind(kind)||entity.presentation?.standalonePage===false||entity.workflow?.status==='needs_review'||(entity.conflicts||[]).length){skipped.push({slug:item.slug,game_id:entity.id,reason:'canonical_identity_not_publishable'});continue}
  const slug=String(entity.identity?.slug?.value||item.slug||'').trim(),title=String(entity.identity?.canonicalTitle?.value||item.title||slug).trim();if(green(slug)){alreadyFinalized.push(slug);continue}
  if(!fs.existsSync(path.join(root,`data/drafts/${slug}.json`))){const child=spawnSync(process.execPath,['scripts/build-game-page-basic.mjs',entity.id],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:12*1024*1024});if(child.status!==0){skipped.push({slug,game_id:entity.id,reason:'draft_seed_failed',stderr:(child.stderr||'').slice(-2000)});continue}}
  if(!plan.pages.some(task=>task.slug===slug))plan.pages.push({type:'build_page',game_id:entity.id,slug,title,steam_appid:Number(entity.externalIds?.steamAppId)||null,priority:2500,reason:'top_250_requires_canonical_page'});
  queued.push(slug);
}
plan.updated_at=new Date().toISOString();write('data/content-pipeline/execution-plan.json',plan);write('data/top-250/materialization.json',{schema_version:2,generated_at:plan.updated_at,mode:'queue_only',publication_owner:'scripts/finalize-game-page-publication.mjs',queued,already_finalized:alreadyFinalized,skipped});
console.log(JSON.stringify({queued:queued.length,already_finalized:alreadyFinalized.length,skipped:skipped.length,public_pages_created_directly:0},null,2));
if(skipped.length)process.exitCode=2;
