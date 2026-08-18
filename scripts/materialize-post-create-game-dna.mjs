#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const requestDir=path.join(root,'data/game-enrichment-requests');
const draftDir=path.join(root,'data/drafts');
const requested=new Set(process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const run=(script,args=[])=>spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:24*1024*1024});

const requestSlugs=fs.existsSync(requestDir)?fs.readdirSync(requestDir)
  .filter(name=>name.endsWith('.json'))
  .map(name=>read(`data/game-enrichment-requests/${name}`,{}))
  .filter(request=>request?.slug&&!['complete'].includes(String(request.state||'')))
  .map(request=>String(request.slug).toLowerCase()):[];
const missingDnaSlugs=fs.existsSync(draftDir)?fs.readdirSync(draftDir)
  .filter(name=>name.endsWith('.json'))
  .map(name=>name.replace(/\.json$/,''))
  .filter(slug=>exists(`game/${slug}/index.html`)&&!exists(`data/game-dna/${slug}.json`)):[];
const slugs=[...new Set([...requestSlugs,...missingDnaSlugs])]
  .filter(slug=>!requested.size||requested.has(slug))
  .filter(slug=>exists(`data/drafts/${slug}.json`));

const results=[];
const validDnaSlugs=[];
for(const slug of slugs){
  const dna=run('scripts/build-game-dna.mjs',[slug]);
  results.push({slug,step:'dna',status:dna.status===0?'completed':'needs_revision',exit_code:dna.status,stdout:(dna.stdout||'').slice(-3000),stderr:(dna.stderr||'').slice(-3000)});
  if(dna.status!==0||!exists(`data/game-dna/${slug}.json`))continue;
  const validation=run('scripts/validate-game-dna.mjs',[slug]);
  results.push({slug,step:'validate',status:validation.status===0?'completed':'needs_revision',exit_code:validation.status,stdout:(validation.stdout||'').slice(-3000),stderr:(validation.stderr||'').slice(-3000)});
  if(validation.status===0)validDnaSlugs.push(slug);
}
for(const slug of validDnaSlugs){
  const similarity=run('scripts/build-similarity-index.mjs',[slug]);
  results.push({slug,step:'similarity',status:similarity.status===0?'completed':'needs_revision',exit_code:similarity.status,stdout:(similarity.stdout||'').slice(-3000),stderr:(similarity.stderr||'').slice(-3000)});
  const draft=read(`data/drafts/${slug}.json`,{});
  draft.modules={...(draft.modules||{}),game_dna:'ready',similarity:similarity.status===0?'ready':'pending'};
  write(`data/drafts/${slug}.json`,draft);
  const requestPath=`data/game-enrichment-requests/${slug}.json`,request=read(requestPath,null);
  if(request){request.modules={...(request.modules||{}),dna:'ready',similarity:similarity.status===0?'ready':'needs_revision'};request.observed={...(request.observed||{}),game_dna:true,similarity:similarity.status===0};write(requestPath,request)}
}
const invalidOrMissing=slugs.filter(slug=>!validDnaSlugs.includes(slug));
for(const slug of invalidOrMissing){
  const requestPath=`data/game-enrichment-requests/${slug}.json`,request=read(requestPath,null);
  if(request){request.modules={...(request.modules||{}),dna:'needs_revision'};request.observed={...(request.observed||{}),game_dna:false};write(requestPath,request)}
}
const similarityFailed=results.filter(item=>item.step==='similarity'&&item.status!=='completed').map(item=>item.slug);
const failed=results.filter(item=>item.status!=='completed');
const report={parser:'post-create-game-dna-v4-partial-progress',status:invalidOrMissing.length||failed.length?'needs_revision':'green',checked_at:new Date().toISOString(),targets:slugs.length,from_pending_requests:requestSlugs.length,from_missing_dna_backfill:missingDnaSlugs.length,dna_ready:validDnaSlugs.length,validation_scope:'per_game_targeted',publication_policy:'valid_dna_publishes_even_if_other_games_or_similarity_need_revision',ready_slugs:validDnaSlugs,invalid_or_missing:invalidOrMissing,similarity_needs_revision:similarityFailed,failed:failed.map(item=>({slug:item.slug,step:item.step,exit_code:item.exit_code,stderr:item.stderr}))};
write('data/parser-runs/game-post-create-dna.json',report);
console.log(JSON.stringify(report,null,2));
