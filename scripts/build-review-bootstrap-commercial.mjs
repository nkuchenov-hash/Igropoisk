#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-bootstrap-commercial <slug>');
const relative=`data/review-bootstrap/${slug}.json`,target=path.join(root,relative),articlePath=path.join(root,'article',slug,'index.html');
let existing=null;
try{existing=JSON.parse(fs.readFileSync(target,'utf8'))}catch{}
if(existing?.publication_status==='published'&&existing?.generation?.grounding_audit?.passed!==true){
  fs.rmSync(target,{force:true});
  fs.rmSync(articlePath,{force:true});
  console.log(`${slug}: removed bootstrap review that lacks a passed factual/language audit before regeneration`);
}
const result=spawnSync('node',['scripts/build-review-bootstrap-local.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
process.exit(result.status??1);
