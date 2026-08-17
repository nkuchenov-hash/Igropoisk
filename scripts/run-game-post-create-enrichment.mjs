#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const requestDir=path.join(root,'data/game-enrichment-requests');
const requestedSlugs=new Set(process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
const maxAttempts=Math.max(1,Number(process.env.POST_CREATE_MAX_ATTEMPTS||3));
const reviewBatch=Math.max(1,Number(process.env.POST_CREATE_REVIEW_BATCH||3));
const bootstrapConcurrency=Math.max(1,Math.min(6,Number(process.env.POST_CREATE_BOOTSTRAP_CONCURRENCY||3)));
const phase=String(process.env.POST_CREATE_PHASE||'all').trim().toLowerCase();
if(!['all','bootstrap','review'].includes(phase))throw new Error(`Unsupported POST_CREATE_PHASE: ${phase}`);
const doBootstrap=phase!=='review';
const doReview=phase!=='bootstrap';
const results=[];
function run(label,script,args=[]){
  const result=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:32*1024*1024});
  results.push({label,script,status:result.status===0?'completed':'needs_revision',exit_code:result.status,stdout:(result.stdout||'').slice(-5000),stderr:(result.stderr||'').slice(-5000)});
  if(result.stdout)console.log(result.stdout);if(result.stderr)console.error(result.stderr);return result.status===0;
}
function runAsync(label,script,args=[]){
  return new Promise(resolve=>{
    const child=spawn('node',[script,...args],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const append=(current,chunk)=>`${current}${String(chunk||'')}`.slice(-10000);
    child.stdout.on('data',chunk=>{stdout=append(stdout,chunk)});
    child.stderr.on('data',chunk=>{stderr=append(stderr,chunk)});
    child.on('error',error=>{stderr=append(stderr,error?.stack||error?.message||String(error));finish(1)});
    let finished=false;
    const finish=code=>{
      if(finished)return;finished=true;
      const ok=Number(code)===0;
      results.push({label,script,status:ok?'completed':'needs_revision',exit_code:Number(code),stdout:stdout.slice(-5000),stderr:stderr.slice(-5000)});
      if(stdout)console.log(`[${label}]\n${stdout}`);if(stderr)console.error(`[${label}]\n${stderr}`);
      resolve(ok);
    };
    child.on('close',finish);
  });
}
async function mapLimit(items,limit,worker){
  let cursor=0;
  const count=Math.min(limit,items.length);
  await Promise.all(Array.from({length:count},async()=>{
    while(true){const index=cursor++;if(index>=items.length)return;await worker(items[index],index)}
  }));
}
const scoreGreen=review=>review?.review_score?.status==='green'&&Number.isFinite(Number(review?.review_score?.calculation?.score_10));
const requestScoreGreen=({request})=>scoreGreen(read(`data/reviews/${String(request?.slug||'').toLowerCase()}.json`,{}));
const reviewReady=slug=>{
  const review=read(`data/reviews/${slug}.json`,{}),article=read(`data/articles/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
  return review?.publication_gate?.status==='green'&&scoreGreen(review)&&String(article?.publication_status||'').toLowerCase()==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
};
const quickReviewReady=slug=>{
  const review=read(`data/reviews/${slug}.json`,{}),article=read(`data/review-bootstrap/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
  return scoreGreen(review)&&String(article?.publication_status||'').toLowerCase()==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
};
const mediaState=slug=>{const draft=read(`data/drafts/${slug}.json`,{}),screens=(draft?.media?.screenshots||[]).length,art=(draft?.media?.artwork||[]).length;return{ready:screens>=12&&art>=3,screenshots:screens,artwork:art}};
const seriesState=(slug,request)=>{if(!request.series)return{ready:true,count:0};const franchise=read(`data/franchises/${slug}.json`,{}),count=(franchise.games||[]).length;return{ready:Boolean(franchise.name&&count>=2),count}};
if(!fs.existsSync(requestDir)){console.log('[post-create] no enrichment request directory');process.exit(0)}
const requestFiles=fs.readdirSync(requestDir).filter(name=>name.endsWith('.json')).sort();
const requests=requestFiles.map(file=>({file,request:read(`data/game-enrichment-requests/${file}`,{})})).filter(({request})=>request?.slug&&(!requestedSlugs.size||requestedSlugs.has(String(request.slug).toLowerCase()))).filter(({request})=>!['complete','deferred_to_catalog_lifecycle'].includes(String(request.state||'')));
if(!requests.length){console.log('[post-create] no pending enrichment requests');process.exit(0)}

async function bootstrapOne({request}){
  const slug=String(request.slug).toLowerCase();if(!exists(`data/drafts/${slug}.json`))return;
  const current=read(`data/reviews/${slug}.json`,{});
  if(request.released!==false&&!scoreGreen(current)){
    if(exists('scripts/discover-review-sources-web.mjs'))await runAsync(`review-discovery:${slug}`,'scripts/discover-review-sources-web.mjs',[slug,'--all']);
    if(exists('scripts/promote-review-source-audit.mjs'))await runAsync(`review-audit:${slug}`,'scripts/promote-review-source-audit.mjs',[slug]);
    await runAsync(`review-research:${slug}`,'scripts/prepare-post-create-review-research.mjs',[slug]);
    if(exists('scripts/enrich-review-explicit-scores.mjs'))await runAsync(`review-scores:${slug}`,'scripts/enrich-review-explicit-scores.mjs',[slug]);
    await runAsync(`rating:${slug}`,'scripts/calculate-ratings-from-research.mjs',[slug]);
  }
  await runAsync(`media:${slug}`,'scripts/enrich-game-media-from-sources.mjs',[slug]);
}

if(doBootstrap){
  // Fast deterministic/source-backed modules publish before any prose synthesis.
  // IMPORTANT: bootstrap is request-scoped and must never invoke catalog-wide materializers.
  run('known-series','scripts/materialize-known-series.mjs',requests.map(({request})=>request.slug));
  await mapLimit(requests,bootstrapConcurrency,bootstrapOne);
}

let reviewCandidates=[];
const attempted=new Set();
if(doReview){
  // Green canonical ratings are ready for a useful compact review now, so they must not wait behind red research retries.
  // The remaining batch capacity can still be used by non-green games for the heavier editorial upgrade path.
  reviewCandidates=requests
    .filter(({request})=>request.released!==false&&!reviewReady(request.slug)&&Number(request.review_attempts||0)<maxAttempts)
    .sort((a,b)=>Number(requestScoreGreen(b))-Number(requestScoreGreen(a))||Number(a.request.review_attempts||0)-Number(b.request.review_attempts||0)||String(a.request.requested_at||'').localeCompare(String(b.request.requested_at||'')))
    .slice(0,reviewBatch);
  for(const {request} of reviewCandidates){
    const slug=String(request.slug).toLowerCase();if(!exists(`data/drafts/${slug}.json`))continue;
    attempted.add(slug);
    if(scoreGreen(read(`data/reviews/${slug}.json`,{}))&&!quickReviewReady(slug)&&exists('scripts/build-review-bootstrap-local.mjs'))run(`review-bootstrap:${slug}`,'scripts/build-review-bootstrap-local.mjs',[slug]);
    run(`review-upgrade:${slug}`,'scripts/quality-control-loop.mjs',['review',slug,String(request.game_id||'')]);
    run(`media-after-review:${slug}`,'scripts/enrich-game-media-from-sources.mjs',[slug]);
  }

  // Catalog-wide materialization belongs to the slower review/finalization phase only.
  run('catalog-materialization','scripts/materialize-catalog-game-data.mjs');
  if(exists('scripts/materialize-review-publication-feed.mjs'))run('review-feed','scripts/materialize-review-publication-feed.mjs');
}

let complete=0,deferred=0,pending=0;
if(doReview){
  for(const {file,request} of requests){
    const slug=String(request.slug).toLowerCase();
    const next={...request,last_run_at:new Date().toISOString(),run_attempts:Number(request.run_attempts||0)+1};
    if(attempted.has(slug))next.review_attempts=Number(request.review_attempts||0)+1;
    const series=seriesState(slug,next),media=mediaState(slug),review=read(`data/reviews/${slug}.json`,{}),ratingReady=scoreGreen(review),fullReady=reviewReady(slug),quickReady=quickReviewReady(slug);
    next.modules={...(next.modules||{}),series:series.ready?'ready':'needs_revision',rating:ratingReady?'ready':'needs_revision',review:fullReady?'ready':quickReady?'bootstrap_ready':'needs_revision',media:media.ready?'ready':'needs_revision'};
    next.observed={series_games:series.count,screenshots:media.screenshots,artwork:media.artwork,canonical_score:ratingReady?Number(review.review_score.calculation.score_10):null,review_stage:fullReady?'full':quickReady?'bootstrap':null};
    const reviewExhausted=next.released!==false&&!fullReady&&Number(next.review_attempts||0)>=maxAttempts;
    const repeated=Number(next.run_attempts||0)>=maxAttempts;
    if(fullReady&&series.ready&&media.ready){next.state='complete';complete++}
    else if(reviewExhausted||repeated){next.state='deferred_to_catalog_lifecycle';next.deferred_reason=quickReady?'Bootstrap review is published; full editorial upgrade continues in the recurring catalog lifecycle.':'Immediate review enrichment exhausted bounded retries; normal recurring catalog lifecycle keeps red modules queued.';deferred++}
    else{next.state='needs_revision';pending++}
    write(`data/game-enrichment-requests/${file}`,next);
  }
}else{
  // Bootstrap deliberately leaves request files untouched so its checkpoint does not self-trigger/cancel the same workflow.
  for(const {request} of requests){const slug=String(request.slug).toLowerCase(),series=seriesState(slug,request),media=mediaState(slug);if(reviewReady(slug)&&series.ready&&media.ready)complete++;else pending++}
}
const reportName=phase==='bootstrap'?'game-post-create-bootstrap.json':'game-post-create-enrichment.json';
write(`data/parser-runs/${reportName}`,{parser:'game-post-create-enrichment',phase,status:pending?'needs_revision':'green',checked_at:new Date().toISOString(),requested:requests.length,complete,deferred,pending,bootstrap_concurrency:doBootstrap?bootstrapConcurrency:0,review_batch:reviewCandidates.map(({request})=>request.slug),results});
console.log(JSON.stringify({phase,requested:requests.length,complete,deferred,pending,bootstrap_concurrency:doBootstrap?bootstrapConcurrency:0,review_batch:reviewCandidates.map(({request})=>request.slug)},null,2));
