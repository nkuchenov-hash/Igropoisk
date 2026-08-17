#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const requestDir=path.join(root,'data/game-enrichment-requests');
const requestedSlugs=new Set(process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
const maxAttempts=Math.max(1,Number(process.env.POST_CREATE_MAX_ATTEMPTS||3));
const reviewBatch=Math.max(1,Number(process.env.POST_CREATE_REVIEW_BATCH||3));
const results=[];
function run(label,script,args=[]){
  const result=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:32*1024*1024});
  results.push({label,script,status:result.status===0?'completed':'needs_revision',exit_code:result.status,stdout:(result.stdout||'').slice(-5000),stderr:(result.stderr||'').slice(-5000)});
  if(result.stdout)console.log(result.stdout);if(result.stderr)console.error(result.stderr);return result.status===0;
}
const scoreGreen=review=>review?.review_score?.status==='green'&&Number.isFinite(Number(review?.review_score?.calculation?.score_10));
const reviewReady=slug=>{
  const review=read(`data/reviews/${slug}.json`,{}),article=read(`data/articles/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
  return review?.publication_gate?.status==='green'&&scoreGreen(review)&&String(article?.publication_status||'').toLowerCase()==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
};
const mediaState=slug=>{
  const draft=read(`data/drafts/${slug}.json`,{}),screens=(draft?.media?.screenshots||[]).length,art=(draft?.media?.artwork||[]).length;
  return{ready:screens>=12&&art>=3,screenshots:screens,artwork:art};
};
const seriesState=(slug,request)=>{
  if(!request.series)return{ready:true,count:0};
  const franchise=read(`data/franchises/${slug}.json`,{}),count=(franchise.games||[]).length;
  return{ready:Boolean(franchise.name&&count>=2),count};
};
if(!fs.existsSync(requestDir)){console.log('[post-create] no enrichment request directory');process.exit(0)}
const requestFiles=fs.readdirSync(requestDir).filter(name=>name.endsWith('.json')).sort();
const requests=requestFiles.map(file=>({file,request:read(`data/game-enrichment-requests/${file}`,{})})).filter(({request})=>request?.slug&&(!requestedSlugs.size||requestedSlugs.has(String(request.slug).toLowerCase()))).filter(({request})=>!['complete','deferred_to_catalog_lifecycle'].includes(String(request.state||'')));
if(!requests.length){console.log('[post-create] no pending enrichment requests');process.exit(0)}

// Series is deterministic when canonical identity already knows it; never spend AI on this case.
run('known-series','scripts/materialize-known-series.mjs',requests.map(({request})=>request.slug));

// Bootstrap evidence and rating for every released requested game before the slower prose build.
for(const {request} of requests){
  const slug=String(request.slug).toLowerCase();if(!exists(`data/drafts/${slug}.json`))continue;
  const current=read(`data/reviews/${slug}.json`,{});
  if(request.released!==false&&!scoreGreen(current)){
    if(exists('scripts/discover-review-sources-web.mjs'))run(`review-discovery:${slug}`,'scripts/discover-review-sources-web.mjs',[slug,'--all']);
    if(exists('scripts/promote-review-source-audit.mjs'))run(`review-audit:${slug}`,'scripts/promote-review-source-audit.mjs',[slug]);
    run(`review-research:${slug}`,'scripts/prepare-review-research.mjs',[slug]);
    if(exists('scripts/enrich-review-explicit-scores.mjs'))run(`review-scores:${slug}`,'scripts/enrich-review-explicit-scores.mjs',[slug]);
    run(`rating:${slug}`,'scripts/calculate-ratings-from-research.mjs',[slug]);
  }
  run(`media:${slug}`,'scripts/enrich-game-media-from-sources.mjs',[slug]);
}

// Build full published reviews in a bounded batch. Unfinished requests re-trigger this workflow via request-state updates.
const reviewCandidates=requests.filter(({request})=>request.released!==false&&!reviewReady(request.slug)&&Number(request.review_attempts||0)<maxAttempts).sort((a,b)=>Number(a.request.review_attempts||0)-Number(b.request.review_attempts||0)||String(a.request.requested_at||'').localeCompare(String(b.request.requested_at||''))).slice(0,reviewBatch);
const attempted=new Set();
for(const {request} of reviewCandidates){
  const slug=String(request.slug).toLowerCase();if(!exists(`data/drafts/${slug}.json`))continue;
  attempted.add(slug);run(`review:${slug}`,'scripts/quality-control-loop.mjs',['review',slug,String(request.game_id||'')]);
  run(`media-after-review:${slug}`,'scripts/enrich-game-media-from-sources.mjs',[slug]);
}
run('catalog-materialization','scripts/materialize-catalog-game-data.mjs');
if(exists('scripts/materialize-review-publication-feed.mjs'))run('review-feed','scripts/materialize-review-publication-feed.mjs');

let complete=0,deferred=0,pending=0;
for(const {file,request} of requests){
  const slug=String(request.slug).toLowerCase();
  const next={...request,last_run_at:new Date().toISOString(),run_attempts:Number(request.run_attempts||0)+1};
  if(attempted.has(slug))next.review_attempts=Number(request.review_attempts||0)+1;
  const series=seriesState(slug,next),media=mediaState(slug),review=read(`data/reviews/${slug}.json`,{}),ratingReady=scoreGreen(review),articleReady=reviewReady(slug);
  next.modules={...(next.modules||{}),series:series.ready?'ready':'needs_revision',rating:ratingReady?'ready':'needs_revision',review:articleReady?'ready':'needs_revision',media:media.ready?'ready':'needs_revision'};
  next.observed={series_games:series.count,screenshots:media.screenshots,artwork:media.artwork,canonical_score:ratingReady?Number(review.review_score.calculation.score_10):null};
  const reviewExhausted=next.released!==false&&!articleReady&&Number(next.review_attempts||0)>=maxAttempts;
  const repeated=Number(next.run_attempts||0)>=maxAttempts;
  if(articleReady&&series.ready&&media.ready){next.state='complete';complete++}
  else if(reviewExhausted||repeated){next.state='deferred_to_catalog_lifecycle';next.deferred_reason='Immediate enrichment exhausted bounded retries; normal recurring catalog lifecycle keeps red modules queued.';deferred++}
  else{next.state='needs_revision';pending++}
  write(`data/game-enrichment-requests/${file}`,next);
}
write('data/parser-runs/game-post-create-enrichment.json',{parser:'game-post-create-enrichment',status:pending?'needs_revision':'green',checked_at:new Date().toISOString(),requested:requests.length,complete,deferred,pending,review_batch:reviewCandidates.map(({request})=>request.slug),results});
console.log(JSON.stringify({requested:requests.length,complete,deferred,pending,review_batch:reviewCandidates.map(({request})=>request.slug)},null,2));
