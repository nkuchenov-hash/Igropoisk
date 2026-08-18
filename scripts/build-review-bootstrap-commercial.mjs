#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-bootstrap-commercial <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const request=read(`data/game-enrichment-requests/${slug}.json`,{}),review=read(`data/reviews/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
if(request?.released===false||review?.review_score?.status!=='green'||!Number.isFinite(score)){
  console.log(JSON.stringify({slug,status:'skipped',reason:request?.released===false?'unreleased':'canonical_rating_not_green'},null,2));
  process.exit(0);
}
const relative=`data/review-bootstrap/${slug}.json`,target=path.join(root,relative),articlePath=path.join(root,'article',slug,'index.html');
let existing=read(relative);
if(existing?.publication_status==='published'&&existing?.generation?.grounding_audit?.passed!==true){
  fs.rmSync(target,{force:true});
  fs.rmSync(articlePath,{force:true});
  console.log(`${slug}: removed bootstrap review that lacks a passed factual/language audit before regeneration`);
}
const baseEnv={...process.env,QUICK_REVIEW_MIN_WORDS:'180',QUICK_REVIEW_NUM_CTX:process.env.QUICK_REVIEW_NUM_CTX||'6144',QUICK_REVIEW_NUM_PREDICT:process.env.QUICK_REVIEW_NUM_PREDICT||'1800'};
const build=spawnSync('node',['scripts/build-review-bootstrap-local.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:baseEnv,maxBuffer:32*1024*1024});
if(build.status!==0)process.exit(build.status??1);
let article=read(relative,{}),words=countWords([article.lead,...(article.sections||[]).flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
const shallow=(article.sections||[]).some(section=>(section.paragraphs||[]).length<2);
if(words<240||shallow){
  console.log(`${slug}: bootstrap draft is structurally valid but commercially shallow (${words} words, shallow=${shallow}); expanding against verified evidence`);
  const expansion=spawnSync('node',['scripts/expand-review-bootstrap-local.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
  if(expansion.status!==0)process.exit(expansion.status??1);
  article=read(relative,{});words=countWords([article.lead,...(article.sections||[]).flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
}
if(words<220)throw new Error(`${slug}: commercial quick review remains below 220 words after expansion (${words})`);
const render=spawnSync('node',['scripts/render-review-bootstrap.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
if(render.status!==0)process.exit(render.status??1);
const audit=spawnSync('node',['scripts/audit-review-bootstrap-local.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
process.exit(audit.status??1);
