#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const requestDir=path.join(root,'data/game-enrichment-requests');
const requested=new Set(process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const run=(script,args=[])=>spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:24*1024*1024});

if(!fs.existsSync(requestDir)){
  console.log(JSON.stringify({status:'no_requests',targets:0},null,2));
  process.exit(0);
}
const slugs=fs.readdirSync(requestDir)
  .filter(name=>name.endsWith('.json'))
  .map(name=>read(`data/game-enrichment-requests/${name}`,{}))
  .filter(request=>request?.slug&&!['complete'].includes(String(request.state||'')))
  .map(request=>String(request.slug).toLowerCase())
  .filter(slug=>!requested.size||requested.has(slug))
  .filter((slug,index,all)=>all.indexOf(slug)===index)
  .filter(slug=>exists(`data/drafts/${slug}.json`));

const results=[];
for(const slug of slugs){
  const dna=run('scripts/build-game-dna.mjs',[slug]);
  results.push({slug,step:'dna',status:dna.status===0?'completed':'needs_revision',exit_code:dna.status,stdout:(dna.stdout||'').slice(-3000),stderr:(dna.stderr||'').slice(-3000)});
}
const validation=run('scripts/validate-game-dna.mjs');
results.push({slug:'*',step:'validate',status:validation.status===0?'completed':'needs_revision',exit_code:validation.status,stdout:(validation.stdout||'').slice(-3000),stderr:(validation.stderr||'').slice(-3000)});
for(const slug of slugs){
  if(!exists(`data/game-dna/${slug}.json`))continue;
  const similarity=run('scripts/build-similarity-index.mjs',[slug]);
  results.push({slug,step:'similarity',status:similarity.status===0?'completed':'needs_revision',exit_code:similarity.status,stdout:(similarity.stdout||'').slice(-3000),stderr:(similarity.stderr||'').slice(-3000)});
}
const missing=slugs.filter(slug=>!exists(`data/game-dna/${slug}.json`));
const failed=results.filter(item=>item.status!=='completed');
const report={parser:'post-create-game-dna',status:missing.length||failed.length?'needs_revision':'green',checked_at:new Date().toISOString(),targets:slugs.length,dna_ready:slugs.length-missing.length,missing,failed:failed.map(item=>({slug:item.slug,step:item.step,exit_code:item.exit_code,stderr:item.stderr}))};
write('data/parser-runs/game-post-create-dna.json',report);
console.log(JSON.stringify(report,null,2));
if(missing.length||failed.length)process.exitCode=2;
