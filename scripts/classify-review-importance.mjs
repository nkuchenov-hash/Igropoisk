#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {classifyReviewImportance} from './lib/review-importance.mjs';

const root=process.cwd();
const slugs=[...new Set(process.argv.slice(2).map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))];
if(!slugs.length)throw new Error('Usage: classify-review-importance <slug...>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const now=()=>new Date().toISOString();
const contract=read('config/review-commercial-contract.json',{});
const policy=contract.review_importance||{};
const threshold=Math.max(1,Number(policy.secondary_minimum_independent_full_reviews||8));
const primaryId=String(policy.primary_reference_source_id||'igromania').toLowerCase();
const primaryName=String(policy.primary_reference_source_name||'Игромания');

function requestPath(slug){return `data/game-enrichment-requests/${slug}.json`}
function ensureCorpus(slug){
  let corpus=read(`data/review-article-corpus/${slug}.json`,{});
  if(corpus?.coverage?.passed===true&&Array.isArray(corpus.sources))return{corpus,built:false,ok:true};
  const result=spawnSync('node',['scripts/build-review-article-corpus-resilient.mjs',slug],{
    cwd:root,
    encoding:'utf8',
    stdio:'inherit',
    env:{...process.env,OPENAI_API_KEY:'',COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'},
    maxBuffer:48*1024*1024
  });
  corpus=read(`data/review-article-corpus/${slug}.json`,{});
  return{corpus,built:true,ok:result.status===0};
}
function saveDecision(slug,request,decision){
  const status=decision.status;
  const required=status==='required';
  const next={
    ...request,
    full_review_required:required,
    review_importance:{
      status,
      required,
      checked_at:now(),
      primary_reference_source_id:primaryId,
      primary_reference_source_name:primaryName,
      primary_reference_review_found:decision.primaryFound,
      independent_full_reviews:decision.independent,
      threshold:decision.threshold,
      exhaustive_discovery:decision.exhaustive,
      reason:decision.reason
    },
    modules:{
      ...(request.modules||{}),
      review:status==='required'?'needs_revision':status==='not_required'?'not_required':'needs_search'
    },
    state:status==='required'?'needs_revision':status==='not_required'?'needs_finalize':'needs_search',
    last_run_at:now(),
    retry:{
      ...(request.retry||{}),
      terminal:false,
      retryable:true,
      stage:status==='pending'?'review-importance-search':status==='required'?'full-review-required':'quick-page-finalize',
      last_error:status==='pending'?'Review importance is still unresolved after the current bounded discovery pass.':null,
      updated_at:now()
    }
  };
  write(requestPath(slug),next);
  return next;
}

const results=[];
for(const slug of slugs){
  const request=read(requestPath(slug),{});
  const draft=read(`data/drafts/${slug}.json`,{});
  const released=request?.released===true||String(draft?.release?.status||'').toLowerCase()==='released';
  if(!released){
    results.push({slug,status:'not_applicable',required:false,reason:'unreleased'});
    continue;
  }

  const {corpus,built,ok}=ensureCorpus(slug);
  let decision=classifyReviewImportance({corpus,force:request?.force_full_review===true,threshold,primaryId,primaryName});
  if(decision.status==='pending'&&!ok)decision={...decision,reason:'importance_discovery_worker_failed_before_exhaustive_result'};
  saveDecision(slug,request,decision);
  results.push({slug,status:decision.status,required:decision.required,reason:decision.reason,primary_reference_review_found:decision.primaryFound,independent_full_reviews:decision.independent,threshold:decision.threshold,exhaustive_discovery:decision.exhaustive,corpus_built_this_pass:built});
}

const fullUpgrade=results.some(x=>x.status==='required');
const pending=results.some(x=>x.status==='pending');
const output=process.env.GITHUB_OUTPUT;
if(output)fs.appendFileSync(output,`full_upgrade=${fullUpgrade?'true':'false'}\npending=${pending?'true':'false'}\n`);
console.log(JSON.stringify({policy:'igromania-or-review-volume-v1',primary_reference:primaryName,threshold,full_upgrade:fullUpgrade,pending,results},null,2));
