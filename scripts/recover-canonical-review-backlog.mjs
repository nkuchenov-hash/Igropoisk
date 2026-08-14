#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd();
const args=process.argv.slice(2);
const getArg=(name,fallback)=>{const i=args.indexOf(name);return i>=0&&args[i+1]!==undefined?args[i+1]:fallback};
const rebind=args.includes('--rebind');
const local=args.includes('--local');
const phase=rebind?'rebind':local?'model-assisted':'deterministic';
const strict=args.includes('--strict');
const concurrency=Math.max(1,Math.min(12,Number(getArg('--concurrency',rebind?3:local?1:6))||1));
const timeoutMs=Math.max(60_000,Number(getArg('--timeout-ms',local?1_200_000:rebind?300_000:720_000))||720_000);
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
function canonicalReady(slug){
  const review=read(`data/reviews/${slug}.json`);
  return review?.publication_gate?.status==='green'&&review?.review_score?.status==='green'&&review?.regional_discovery?.complete===true;
}
function reusableArticle(slug){return canonicalReady(slug)&&Boolean(read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`))?.sections?.length)};
function eligibleForLocal(slug){return canonicalReady(slug)&&!alreadyGreen(slug)};

const catalog=read('data/catalog-visible.json',[]);
let slugs=catalog.filter(item=>item?.slug&&released(read(`data/drafts/${item.slug}.json`),item)).map(item=>item.slug);
if(only)slugs=slugs.filter(slug=>only.has(slug));
slugs=slugs.filter(slug=>!alreadyGreen(slug));
if(rebind)slugs=slugs.filter(reusableArticle);
if(local)slugs=slugs.filter(eligibleForLocal);
if(limit)slugs=slugs.slice(0,limit);

const startedAt=new Date().toISOString(),started=Date.now(),results=new Array(slugs.length);
let cursor=0,active=0;
console.log(JSON.stringify({phase,released_candidates:slugs.length,concurrency,timeout_ms:timeoutMs},null,2));

function spawnNode(script,scriptArgs,env,timeout){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[script,...scriptArgs],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const keep=(current,chunk)=>(current+String(chunk)).slice(-20000);
    child.stdout.on('data',chunk=>{stdout=keep(stdout,chunk)});
    child.stderr.on('data',chunk=>{stderr=keep(stderr,chunk)});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref()},timeout);
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal:signal||null,timedOut,stdout,stderr})});
  });
}
async function runOne(slug,index){
  const env={...process.env,OPENAI_API_KEY:local?(process.env.OPENAI_API_KEY||''):'',REVIEW_DETERMINISTIC_ONLY:phase==='deterministic'?'1':'0'};
  let execution;
  if(rebind){
    execution=await spawnNode('scripts/rebind-existing-review.mjs',[slug],env,timeoutMs);
    if(execution.code===0){
      const rendered=await spawnNode('scripts/render-review-pages.mjs',[slug],env,120_000);
      execution={...execution,code:rendered.code,signal:rendered.signal,timedOut:execution.timedOut||rendered.timedOut,stdout:`${execution.stdout}\n${rendered.stdout}`.slice(-20000),stderr:`${execution.stderr}\n${rendered.stderr}`.slice(-20000)};
    }
  }else{
    execution=await spawnNode('scripts/quality-control-loop.mjs',['review',slug],env,timeoutMs);
  }
  const control=read(`data/quality-control/review-${slug}-control.json`,{}),review=read(`data/reviews/${slug}.json`,{}),article=read(`data/articles/${slug}.json`,{}),greenNow=alreadyGreen(slug);
  const row={slug,index:index+1,exit_code:execution.code,signal:execution.signal,timed_out:execution.timedOut,green:greenNow,control_green:control?.green===true,corpus_status:review?.publication_gate?.status||null,score_status:review?.review_score?.status||null,score:Number.isFinite(Number(review?.review_score?.calculation?.score_10))?Number(review.review_score.calculation.score_10):null,regional_complete:review?.regional_discovery?.complete===true,article_status:article?.publication_status||null,comments:control?.comments||[],stdout_tail:execution.stdout,stderr_tail:execution.stderr};
  results[index]=row;
  console.log(JSON.stringify({slug:row.slug,green:row.green,corpus:row.corpus_status,score:row.score_status,regional:row.regional_complete,article:row.article_status,timed_out:row.timed_out},null,2));
}

await new Promise(resolve=>{
  const launch=()=>{
    while(active<concurrency&&cursor<slugs.length){const index=cursor++,slug=slugs[index];active++;runOne(slug,index).finally(()=>{active--;if(cursor>=slugs.length&&active===0)resolve();else launch()})}
    if(!slugs.length)resolve();
  };
  launch();
});

const completed=results.filter(Boolean),green=completed.filter(row=>row.green),pending=completed.filter(row=>!row.green),report={schema_version:2,phase,started_at:startedAt,checked_at:new Date().toISOString(),duration_ms:Date.now()-started,concurrency,timeout_ms:timeoutMs,selected:slugs.length,green:green.length,pending:pending.length,timed_out:completed.filter(row=>row.timed_out).length,results:completed};
write(`data/parser-runs/review-backlog-${phase}.json`,report);
fs.mkdirSync(path.join(root,'tmp'),{recursive:true});write(`tmp/review-backlog-${phase}.json`,report);
console.log(JSON.stringify({phase:report.phase,selected:report.selected,green:report.green,pending:report.pending,timed_out:report.timed_out,duration_ms:report.duration_ms,pending_slugs:pending.slice(0,30).map(row=>row.slug)},null,2));
if(strict&&pending.length)process.exitCode=2;
