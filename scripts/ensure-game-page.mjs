#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi,isEmbeddedGameKind} from './lib/game-registry.mjs';

const root=process.cwd();
const slugOrId=String(process.argv[2]||'').trim();
if(!slugOrId)throw new Error('Usage: node scripts/ensure-game-page.mjs <slug-or-id>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const registry=read('data/game-registry/registry.transition.json');
if(!registry)throw new Error('Canonical Game Registry is missing.');
const api=new GameRegistryApi(registry);
const entity=api.findById(slugOrId)??api.findBySlug(slugOrId);
if(!entity)throw new Error(`Game not found: ${slugOrId}`);
const kind=entity.identity?.kind?.value??'unknown';
if(isEmbeddedGameKind(kind)||entity.presentation?.standalonePage===false)throw new Error(`Embedded game cannot receive standalone page: ${entity.id}`);
if(entity.workflow?.status==='needs_review'||(entity.conflicts||[]).length)throw new Error(`Game identity requires review: ${entity.id}`);
const slug=String(entity.identity?.slug?.value||'').trim().toLowerCase();
const title=String(entity.identity?.canonicalTitle?.value||'').trim();
if(!slug||!title)throw new Error(`Game identity incomplete: ${entity.id}`);

const built=spawnSync('node',['scripts/build-game-page-basic.mjs',entity.id],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:16*1024*1024});
if(built.stdout)process.stdout.write(built.stdout);
if(built.stderr)process.stderr.write(built.stderr);
if(built.status!==0)process.exit(built.status??2);
const draft=read(`data/drafts/${slug}.json`);
if(!draft||draft.publication?.status==='published'||draft.publication?.public_ready===true)throw new Error(`${slug}: ensure-game-page must remain draft-only`);

const plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});
plan.pages=Array.isArray(plan.pages)?plan.pages:[];
plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
if(!plan.pages.some(item=>item.slug===slug))plan.pages.push({type:'build_page',game_id:entity.id,slug,title,steam_appid:Number(entity.externalIds?.steamAppId)||null,priority:5000,reason:`page_requested_by_${String(process.env.GAME_CREATOR_SOURCE||'generic').toLowerCase()}`});
plan.updated_at=new Date().toISOString();
write('data/content-pipeline/execution-plan.json',plan);
write(`data/parser-runs/game-page-request-${slug}.json`,{parser:'game-page-request-adapter',status:'queued',game_slug:slug,game_id:entity.id,checked_at:plan.updated_at,public_ready:false,publication_owner:'scripts/finalize-game-page-publication.mjs',source:String(process.env.GAME_CREATOR_SOURCE||'generic'),source_url:String(process.env.GAME_SOURCE_URL||'')||null,output:[`data/drafts/${slug}.json`,'data/content-pipeline/execution-plan.json']});
console.log(JSON.stringify({slug,game_id:entity.id,status:'queued',public_ready:false,next:'canonical Page Assembly lifecycle'},null,2));
