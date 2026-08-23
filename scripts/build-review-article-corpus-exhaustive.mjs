#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-article-corpus-exhaustive <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const contract=read('config/review-commercial-contract.json',{}).source_corpus||{};
const corpusPath=path.join(root,`data/review-article-corpus/${slug}.json`);
const auditPath=path.join(root,`data/review-discovery-audits/${slug}.json`);
const existing=read(`data/review-article-corpus/${slug}.json`,{});
const requestedTarget=Math.max(12,Number(contract.target_independent_full_reviews||20));
const existingTarget=Number(existing?.policy?.target_full_reviews||0);
const exhaustiveContract=contract.collect_all_discovered_independent_full_reviews===true&&contract.full_text_download_required_before_article_acceptance===true;
const currentContract=existing?.coverage?.passed===true&&existingTarget>=requestedTarget;

if(exhaustiveContract&&!currentContract){
  fs.rmSync(corpusPath,{force:true});
  fs.rmSync(auditPath,{force:true});
  console.log(JSON.stringify({slug,status:'stale-corpus-invalidated',existing_target:existingTarget,required_target:requestedTarget},null,2));
}

const result=spawnSync('node',['scripts/build-review-article-corpus-resilient.mjs',slug],{
  cwd:root,
  encoding:'utf8',
  stdio:'inherit',
  env:{...process.env,OPENAI_API_KEY:'',COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'},
  maxBuffer:64*1024*1024
});
if(result.error)throw result.error;
process.exit(result.status??1);
