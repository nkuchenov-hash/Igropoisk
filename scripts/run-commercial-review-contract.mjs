#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slugs=[...new Set(process.argv.slice(2).map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))];
if(!slugs.length)throw new Error('Usage: run-commercial-review-contract <slug...>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const exists=r=>fs.existsSync(path.join(root,r));
const now=()=>new Date().toISOString();
const ORCHESTRATOR='commercial-review-contract-v7-importance-gated-local-only';

function requestPath(slug){
  const direct=`data/game-enrichment-requests/${slug}.json`;
  if(exists(direct))return direct;
  const dir=path.join(root,'data/game-enrichment-requests');
  if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
    const relative=`data/game-enrichment-requests/${file}`,request=read(relative,{});
    if(String(request?.slug||'').toLowerCase()===slug)return relative;
  }
  return direct;
}
function isReleased(slug,request,draft){
  if(request?.released===true||String(draft?.release?.status||'').toLowerCase()==='released')return true;
  const raw=draft?.release?.canonical_date_text||draft?.release?.date_text||draft?.release?.date||'',date=Date.parse(raw);
  if(Number.isFinite(date))return date<=Date.now();
  return request?.released!==false&&!/(?:upcoming|announced|tba|coming)/i.test(String(draft?.release?.status||''));
}
function ensureRequest(slug,draft){
  const relative=requestPath(slug);
  if(exists(relative))return read(relative,{});
  const base={schema_version:3,slug,game_id:draft?.game_id||draft?.identity?.game_id||null,requested_at:now(),last_run_at:null,run_attempts:0,review_attempts:0,released:isReleased(slug,{},draft),state:'needs_search',modules:{review:'needs_search',media:'needs_search',rating:'needs_revision',dna:'needs_revision',similarity:'needs_revision'},origin:'unified-commercial-review-contract',provider_policy:'local_only',review_importance:{status:'pending',required:false}};
  write(relative,base);
  return base;
}
function fullReviewRequired(request){return request?.force_full_review===true||request?.review_importance?.status==='required'||request?.review_importance?.required===true}
function run(label,script,args=[],envOverrides={}){
  const env={...process.env,...envOverrides,OPENAI_API_KEY:'',COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'};
  const result=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env,maxBuffer:48*1024*1024});
  if(result.stdout)console.log(`[${label}]\n${result.stdout}`);
  if(result.stderr)console.error(`[${label}]\n${result.stderr}`);
  return{ok:result.status===0,code:Number(result.status),error:String(result.stderr||result.stdout||'').trim().slice(-5000)};
}

const contract=read('config/review-commercial-contract.json',{});
const preferred=Number(contract.source_corpus?.preferred_minimum_independent_full_reviews||15);
const minScreens=Number(contract.game_media?.minimum_unique_screenshots||15);
const minWords=Number(contract.article?.minimum_words||3000);
function corpusReady(slug){
  const corpus=read(`data/review-article-corpus/${slug}.json`,{}),audit=read(`data/review-discovery-audits/${slug}.json`,{}),count=Number(corpus?.coverage?.accepted_dossiers||corpus?.sources?.length||0);
  return corpus?.coverage?.passed===true&&count>0&&(count>=preferred||(corpus?.coverage?.exhaustive_discovery===true&&audit?.exhaustive===true));
}
function mediaReady(slug){
  const draft=read(`data/drafts/${slug}.json`,{});
  return draft?.publication?.commercial_media_ready===true&&(draft?.media?.screenshots||[]).length>=minScreens;
}
function synthesisReady(slug){
  const article=read(`data/articles/${slug}.json`,{});
  return ['awaiting_media','published'].includes(String(article?.publication_status||''))&&Number(article?.generation?.words||0)>=minWords&&article?.generation?.editorial_audit?.passed===true;
}
function carouselReady(slug){const article=read(`data/articles/${slug}.json`,{});return article?.publication_status==='published'&&article?.media_gate?.passed===true}
function validationReady(slug){return read(`data/parser-runs/review-commercial-v2-${slug}.json`,{})?.passed===true}
function renderReady(slug){return exists(`article/${slug}/index.html`)}
function updateRequest(slug,state,details={}){
  const relative=requestPath(slug),request=read(relative,{}),draft=read(`data/drafts/${slug}.json`,{}),screens=(draft?.media?.screenshots||[]).length,artwork=(draft?.media?.artwork||[]).length;
  const next={...request,slug,game_id:request.game_id||draft?.game_id||draft?.identity?.game_id||null,state,last_run_at:now(),run_attempts:Number(request.run_attempts||0)+1,review_attempts:Number(request.review_attempts||0)+(details.attemptedReview===false?0:1),provider_policy:'local_only',modules:{...(request.modules||{}),review:details.reviewModule||request.modules?.review||'needs_search',media:mediaReady(slug)?'ready':details.mediaModule||request.modules?.media||'needs_search'},observed:{...(request.observed||{}),screenshots:screens,artwork,review_stage:validationReady(slug)?'full':null},retry:{terminal:false,retryable:state!=='complete',stage:details.stage||null,last_error:details.error||null,updated_at:now()}};
  delete next.deferred_reason;delete next.exhausted_reason;
  write(relative,next);
}

const failures=[],completed=[],waiting=[];
for(const slug of slugs){
  const draft=read(`data/drafts/${slug}.json`);
  if(!draft?.identity?.title){failures.push({slug,stage:'identity',error:'canonical draft missing'});continue}
  const request=ensureRequest(slug,draft);
  if(!isReleased(slug,request,draft)){
    waiting.push(slug);
    updateRequest(slug,'waiting_release',{attemptedReview:false,stage:'release',reviewModule:'waiting_release',mediaModule:mediaReady(slug)?'ready':'needs_search'});
    write(`data/parser-runs/commercial-review-orchestrator-${slug}.json`,{orchestrator:ORCHESTRATOR,status:'waiting_release',game_slug:slug,checked_at:now(),terminal:false,retryable:true,provider_policy:'local_only'});
    continue;
  }
  if(!fullReviewRequired(request)){
    const error='full commercial review invoked without review_importance=required or force_full_review=true';
    write(`data/parser-runs/commercial-review-orchestrator-${slug}.json`,{orchestrator:ORCHESTRATOR,status:'blocked_by_importance_gate',game_slug:slug,checked_at:now(),terminal:false,retryable:false,provider_policy:'local_only',error});
    failures.push({slug,stage:'review-importance',error});
    continue;
  }

  const prereq=[];
  if(!corpusReady(slug)){const result=run(`${slug}:article-corpus`,'scripts/build-review-article-corpus-resilient.mjs',[slug]);if(!result.ok)prereq.push({stage:'article-corpus',error:result.error})}
  if(!mediaReady(slug)){const result=run(`${slug}:commercial-media`,'scripts/enforce-commercial-game-media.mjs',[slug]);if(!result.ok)prereq.push({stage:'commercial-media',error:result.error})}
  if(prereq.length||!corpusReady(slug)||!mediaReady(slug)){
    const error=prereq.map(x=>`${x.stage}: ${x.error}`).join('\n')||'research/media prerequisites still need search';
    updateRequest(slug,'needs_search',{stage:prereq.map(x=>x.stage).join(',')||'prerequisites',error,reviewModule:'needs_search',mediaModule:mediaReady(slug)?'ready':'needs_search'});
    write(`data/parser-runs/commercial-review-orchestrator-${slug}.json`,{orchestrator:ORCHESTRATOR,status:'needs_search',game_slug:slug,checked_at:now(),terminal:false,retryable:true,provider_policy:'local_only',failures:prereq});
    failures.push({slug,stage:'prerequisites',error});
    continue;
  }

  const stages=[];
  if(!synthesisReady(slug)){
    stages.push(['meta-preflight','scripts/prepare-sectioned-review-meta.mjs',[slug],{}]);
    stages.push(['long-review','scripts/synthesize-commercial-review-resilient-wrapper.mjs',[slug],{}]);
  }
  if(exists('scripts/canonicalize-editorial-game-id.mjs'))stages.push(['canonical-game-id','scripts/canonicalize-editorial-game-id.mjs',[slug],{}]);
  if(!carouselReady(slug))stages.push(['article-carousels','scripts/enrich-commercial-review-media-resilient.mjs',[slug],{}]);
  if(!validationReady(slug))stages.push(['commercial-validator','scripts/validate-commercial-review-v2.mjs',[slug],{}]);
  if(!renderReady(slug))stages.push(['render','scripts/render-review-pages.mjs',[slug],{}]);

  let failed=null;
  for(const [label,script,args,envOverrides] of stages){
    const result=run(`${slug}:${label}`,script,args,envOverrides||{});
    if(!result.ok){failed={stage:label,error:result.error||`${script} exited ${result.code}`};break}
  }
  if(failed){
    updateRequest(slug,'needs_revision',{stage:failed.stage,error:failed.error,reviewModule:'needs_revision',mediaModule:'ready'});
    write(`data/parser-runs/commercial-review-orchestrator-${slug}.json`,{orchestrator:ORCHESTRATOR,status:'needs_revision',game_slug:slug,checked_at:now(),terminal:false,retryable:true,provider_policy:'local_only',...failed});
    failures.push({slug,...failed});
    continue;
  }
  completed.push(slug);
}

if(completed.length){
  const feed=run('review-feed','scripts/materialize-review-publication-feed.mjs',completed);
  if(!feed.ok){
    for(const slug of completed)updateRequest(slug,'needs_revision',{stage:'review-feed',error:feed.error,reviewModule:'needs_revision',mediaModule:'ready'});
    failures.push({slug:completed.join(','),stage:'review-feed',error:feed.error});
  }else{
    const finalize=run('finalize-commercial-post-create','scripts/finalize-commercial-post-create.mjs',completed);
    if(!finalize.ok){
      for(const slug of completed)updateRequest(slug,'needs_revision',{stage:'finalize',error:finalize.error,reviewModule:'needs_revision',mediaModule:'ready'});
      failures.push({slug:completed.join(','),stage:'finalize',error:finalize.error});
    }else for(const slug of completed)write(`data/parser-runs/commercial-review-orchestrator-${slug}.json`,{orchestrator:ORCHESTRATOR,status:'green',game_slug:slug,checked_at:now(),terminal:true,retryable:false,provider_policy:'local_only'});
  }
}

write('data/parser-runs/commercial-review-orchestrator.json',{orchestrator:ORCHESTRATOR,checked_at:now(),requested:slugs,completed,waiting_release:waiting,failures,status:failures.length?'needs_revision':'green',provider_policy:'local_only'});
console.log(JSON.stringify({requested:slugs,completed,waiting_release:waiting,failures,provider_policy:'local_only'},null,2));
if(failures.length)process.exit(75);
