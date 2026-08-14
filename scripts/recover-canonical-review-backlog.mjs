#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd();
const args=process.argv.slice(2);
const getArg=(name,fallback)=>{const i=args.indexOf(name);return i>=0&&args[i+1]!==undefined?args[i+1]:fallback};
const local=args.includes('--local');
const strict=args.includes('--strict');
const concurrency=Math.max(1,Math.min(12,Number(getArg('--concurrency',local?2:6))||1));
const timeoutMs=Math.max(60_000,Number(getArg('--timeout-ms',local?1_200_000:720_000))||720_000);
const limit=Math.max(0,Number(getArg('--limit','0'))||0);
const only=args.includes('--only')?new Set(String(getArg('--only','')).split(',').map(x=>x.trim()).filter(Boolean)):null;
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const exists=relative=>fs.existsSync(path.join(root,relative));

function released(draft,item){
  const release=draft?.release||{},status=String(release.status||'').toLowerCase();
  if(/upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида/i.test(status))return false;
  const exact=Date.parse(String(release.date||''));
  if(Number.isFinite(exact))return exact<=Date.now();
  const year=Number(String(release.date_text||item?.year||'').match(/(?:19|20)\d{2}/)?.[0]||item?.year||0);
  return !year||year<=new Date().getUTCFullYear();
}
function alreadyGreen(slug){
  const review=read(`data/reviews/${slug}.json`),article=read(`data/articles/${slug}.json`);
  const score=Number(review?.review_score?.calculation?.score_10);
  return review?.publication_gate?.status==='green'&&review?.review_score?.status==='green'&&review?.regional_discovery?.complete===true&&Number.isFinite(score)&&article?.publication_status==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
}
function eligibleForLocal(slug){
  const review=read(`data/reviews/${slug}.json`),control=read(`data/quality-control/review-${slug}-control.json`);
  return review?.publication_gate?.status==='green'&&review?.review_score?.status==='green'&&control?.green!==true;
}

const catalog=read('data/catalog-visible.json',[]);
let slugs=catalog.filter(item=>item?.slug&&released(read(`data/drafts/${item.slug}.json`),item)).map(item=>item.slug);
if(only)slugs=slugs.filter(slug=>only.has(slug));
slugs=slugs.filter(slug=>!alreadyGreen(slug));
if(local)slugs=slugs.filter(eligibleForLocal);
if(limit)slugs=slugs.slice(0,limit);

const startedAt=new Date().toISOString(),started=Date.now(),results=new Array(slugs.length);
let cursor=0,active=0;
console.log(JSON.stringify({phase:local?'model-assisted':'deterministic',released_candidates:slugs.length,concurrency,timeout_ms:timeoutMs},null,2));

function runOne(slug,index){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,['scripts/quality-control-loop.mjs','review',slug],{
      cwd:root,
      env:{...process.env,OPENAI_API_KEY:local?(process.env.OPENAI_API_KEY||''):'',REVIEW_DETERMINISTIC_ONLY:local?'0':'1'},
      stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='',timedOut=false;
    const keep=(current,chunk)=>(current+String(chunk)).slice(-20000);
    child.stdout.on('data',chunk=>{stdout=keep(stdout,chunk)});
    child.stderr.on('data',chunk=>{stderr=keep(stderr,chunk)});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref()},timeoutMs);
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      const control=read(`data/quality-control/review-${slug}-control.json`,{}),review=read(`data/reviews/${slug}.json`,{}),article=read(`data/articles/${slug}.json`,{});
      const row={slug,index:index+1,exit_code:code,signal:signal||null,timed_out:timedOut,green:control?.green===true,corpus_status:review?.publication_gate?.status||null,score_status:review?.review_score?.status||null,score:Number.isFinite(Number(review?.review_score?.calculation?.score_10))?Number(review.review_score.calculation.score_10):null,regional_complete:review?.regional_discovery?.complete===true,article_status:article?.publication_status||null,comments:control?.comments||[],stdout_tail:stdout,stderr_tail:stderr};
      results[index]=row;
      console.log(JSON.stringify({slug:row.slug,green:row.green,corpus:row.corpus_status,score:row.score_status,regional:row.regional_complete,article:row.article_status,timed_out:row.timed_out},null,2));
      resolve();
    });
  });
}

await new Promise(resolve=>{
  const launch=()=>{
    while(active<concurrency&&cursor<slugs.length){const index=cursor++,slug=slugs[index];active++;runOne(slug,index).finally(()=>{active--;if(cursor>=slugs.length&&active===0)resolve();else launch()})}
    if(!slugs.length)resolve();
  };
  launch();
});

const completed=results.filter(Boolean),green=completed.filter(row=>row.green),pending=completed.filter(row=>!row.green),report={schema_version:1,phase:local?'model-assisted':'deterministic',started_at:startedAt,checked_at:new Date().toISOString(),duration_ms:Date.now()-started,concurrency,timeout_ms:timeoutMs,selected:slugs.length,green:green.length,pending:pending.length,timed_out:completed.filter(row=>row.timed_out).length,results:completed};
write(`data/parser-runs/review-backlog-${local?'local':'deterministic'}.json`,report);
fs.mkdirSync(path.join(root,'tmp'),{recursive:true});write(`tmp/review-backlog-${local?'local':'deterministic'}.json`,report);
console.log(JSON.stringify({phase:report.phase,selected:report.selected,green:report.green,pending:report.pending,timed_out:report.timed_out,duration_ms:report.duration_ms,pending_slugs:pending.slice(0,30).map(row=>row.slug)},null,2));
if(strict&&pending.length)process.exitCode=2;
