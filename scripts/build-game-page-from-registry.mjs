#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GameRegistryApi,isEmbeddedGameKind} from './lib/game-registry.mjs';

const root=process.cwd();
const args=process.argv.slice(2),slugOrId=args.find(value=>!value.startsWith('--'));
const registryPath=path.resolve(root,args.includes('--registry')?args[args.indexOf('--registry')+1]:'data/game-registry/registry.transition.json');
if(!slugOrId)throw new Error('Usage: node scripts/build-game-page-from-registry.mjs <slug-or-id> [--registry path]');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const run=(script,argv=[])=>{const child=spawnSync(process.execPath,[script,...argv],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:24*1024*1024});if(child.stdout)process.stdout.write(child.stdout);if(child.stderr)process.stderr.write(child.stderr);return child.status===0};
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8')),api=new GameRegistryApi(registry),entity=api.findById(slugOrId)??api.findBySlug(slugOrId);
if(!entity)throw new Error(`Game not found in canonical registry: ${slugOrId}`);
const kind=entity.identity?.kind?.value??'unknown';if(isEmbeddedGameKind(kind)||entity.presentation?.standalonePage===false)throw new Error(`Embedded game content cannot receive a standalone page: ${entity.id} (${kind})`);if(entity.workflow?.status==='needs_review'||(entity.conflicts||[]).length)throw new Error(`Game identity requires review before page assembly: ${entity.id}`);
const slug=String(entity.identity?.slug?.value||'').trim();if(!slug||!entity.identity?.canonicalTitle?.value)throw new Error(`Game identity is incomplete: ${entity.id}`);

// This is a full Page Assembly entry point. It is not a publisher of its own:
// deterministic draft -> canonical QC/revision -> sole green publication finalizer.
if(!run('scripts/build-game-page-basic.mjs',[entity.id]))process.exit(2);
if(!run('scripts/quality-control-loop.mjs',['page',slug,entity.id]))process.exit(2);
const qc=read(`data/quality-control/page-${slug}-control.json`,{});
if(qc?.status!=='green'||qc?.green!==true){console.error(`${slug}: Page Assembly remains needs_revision; public state was not created.`);process.exit(2)}
if(!run('scripts/finalize-game-page-publication.mjs',[slug,entity.id]))process.exit(2);
if(!run('scripts/validate-game-page-publication-state.mjs',[slug]))process.exit(2);
console.log(JSON.stringify({slug,game_id:entity.id,status:'published',publication_owner:'scripts/finalize-game-page-publication.mjs'},null,2));
