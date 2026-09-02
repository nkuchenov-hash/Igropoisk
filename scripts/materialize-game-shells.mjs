#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const catalog=read('data/catalog-visible.json',[]);
let finalized=0,skipped=0,failed=0;
for(const game of catalog){
  const slug=String(game?.slug||'').trim();if(!slug)continue;
  const draft=read(`data/drafts/${slug}.json`),editorial=read(`data/page-editorial/${slug}.json`),pageQc=read(`data/quality-control/page-${slug}-control.json`),contentQc=read(`data/quality-control/game-page-content-${slug}.json`),mediaQc=read(`data/quality-control/game-page-${slug}.json`),corpus=read(`data/game-sources/${slug}.json`);
  const green=Boolean(draft?.publication?.status==='published'&&draft?.publication?.public_ready===true&&editorial?.game_slug===slug&&editorial?.quality_status==='green'&&pageQc?.status==='green'&&pageQc?.green===true&&contentQc?.status==='green'&&mediaQc?.status==='green'&&corpus?.discovery?.complete===true);
  if(!green){skipped++;continue}
  const gameId=String(game?.game_id||draft?.game_id||'').trim();
  const child=spawnSync(process.execPath,['scripts/finalize-game-page-publication.mjs',slug,gameId],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:8*1024*1024});
  if(child.status===0)finalized++;else{failed++;if(child.stderr)process.stderr.write(child.stderr)}
}
console.log(JSON.stringify({catalog_games:catalog.length,finalized_by_canonical_owner:finalized,skipped_not_green:skipped,failed},null,2));
if(failed)process.exitCode=2;
