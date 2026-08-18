#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-bootstrap-commercial <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const request=read(`data/game-enrichment-requests/${slug}.json`,{}),review=read(`data/reviews/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10),relative=`data/review-bootstrap/${slug}.json`,articlePath=path.join(root,'article',slug,'index.html');
if(request?.released===false||review?.review_score?.status!=='green'||!Number.isFinite(score)){console.log(JSON.stringify({slug,status:'skipped',reason:request?.released===false?'unreleased':'canonical_rating_not_green'},null,2));process.exit(0)}
let existing=read(relative),existingWords=countWords([existing?.lead,...(existing?.sections||[]).flatMap(section=>section.paragraphs||[]),existing?.verdict?.summary].join(' '));
const requestFresh=String(request?.requested_at||''),existingFresh=String(existing?.updated_at||'');
if(existing?.publication_status==='published'&&existing?.generation?.provider==='deterministic-evidence-v1'&&existing?.generation?.grounding_audit?.passed===true&&existing?.generation?.editorial_quality?.passed===true&&Number(existing.score)===score&&existingWords>=220&&(!requestFresh||existingFresh>=requestFresh)){
  const render=spawnSync('node',['scripts/render-review-bootstrap.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
  console.log(JSON.stringify({slug,status:'already_commercial',words:existingWords,provider:existing.generation?.provider||null},null,2));process.exit(render.status??1);
}
fs.rmSync(articlePath,{force:true});
const synthesis=spawnSync('node',['scripts/build-review-bootstrap-commercial-grounded.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
if(synthesis.status!==0)process.exit(synthesis.status??1);
const article=read(relative,{}),words=countWords([article.lead,...(article.sections||[]).flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
if(words<220)throw new Error(`${slug}: grounded commercial quick review below 220 words (${words})`);
if(article?.publication_status!=='published'||article?.quality_status!=='green'||article?.generation?.provider!=='deterministic-evidence-v1'||article?.generation?.grounding_audit?.passed!==true||article?.generation?.editorial_quality?.passed!==true)throw new Error(`${slug}: deterministic evidence builder returned without a publishable commercial review`);
const render=spawnSync('node',['scripts/render-review-bootstrap.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:32*1024*1024});
process.exit(render.status??1);
