import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const readJSON=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const writeJSON=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
let plan=readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]});
const catalog=readJSON('data/catalog-visible.json',[]);
plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
const pageSlugs=new Set(plan.pages.map(item=>item.slug));const reviewSlugs=new Set(plan.reviews.map(item=>item.slug));
const mergePlan=next=>{for(const task of next?.pages||[])if(!pageSlugs.has(task.slug)){plan.pages.push(task);pageSlugs.add(task.slug)}for(const task of next?.reviews||[])if(!reviewSlugs.has(task.slug)){plan.reviews.push(task);reviewSlugs.add(task.slug)}};
for(const game of catalog){
  const slug=String(game.slug||'');if(!slug)continue;
  const pageControl=readJSON(`data/quality-control/page-${slug}-control.json`);const mediaControl=readJSON(`data/quality-control/game-page-${slug}.json`);
  if(!pageSlugs.has(slug)&&(pageControl?.status==='red-needs-revision'||mediaControl?.status==='red-needs-revision')){plan.pages.push({type:'build_page',game_id:String(game.game_id||pageControl?.game_id||''),slug,title:game.title||slug,steam_appid:game.steam_appid||null,priority:1100,reason:'game_page_quality_needs_revision'});pageSlugs.add(slug)}
  if(reviewSlugs.has(slug))continue;
  const feed=readJSON(`data/reviews/${slug}.json`);const rating=readJSON(`data/ratings/${slug}.json`);
  const corpusRed=feed?.publication_gate?.status==='red-needs-revision';const ratingRed=rating?.status==='red-needs-revision';
  if(!corpusRed&&!ratingRed)continue;
  plan.reviews.push({type:'build_review',game_id:String(game.game_id||feed?.game_id||''),slug,title:game.title||slug,steam_appid:game.steam_appid||null,priority:1000,reason:[corpusRed?'review_corpus_needs_revision':'',ratingRed?'rating_needs_revision':''].filter(Boolean).join('+')});reviewSlugs.add(slug);
}
const startedAt=new Date().toISOString();const results=[];
const aiEnabled=/^(1|true|yes|on)$/i.test(String(process.env.EDITORIAL_AI_ENABLED||''))||Boolean(process.env.OPENAI_API_KEY);
const aiAvailable=Boolean(process.env.OPENAI_API_KEY);
function run(label,command,args,env={}){const started=Date.now();const child=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,...env},maxBuffer:24*1024*1024});const record={label,command:[command,...args].join(' '),status:child.status===0?'completed':'revision_required',exit_code:child.status,duration_ms:Date.now()-started,stdout:(child.stdout||'').slice(-12000),stderr:(child.stderr||'').slice(-12000)};results.push(record);console.log(`\n[${record.status}] ${record.command}`);if(record.stdout)console.log(record.stdout);if(record.stderr)console.error(record.stderr);return child.status===0}
function qualityStatus(type,slug){return readJSON(`data/quality-control/${type}-${slug}-control.json`,{status:'red-needs-revision',green:false})}
function ensureFranchiseSeed(item){const relative=`data/parser-output/${item.slug}.json`;if(exists(relative))return;writeJSON(relative,{schema_version:1,identity:{slug:item.slug,title:item.title,steam_appid:item.steam_appid||null},release:{date_text:item.release_year?String(item.release_year):''},companies:{developers:[],publishers:[]},classification:{genres:[],categories:[],platforms:[]},editorial:{short_description:'',integrated_description:'',features:[]},media:{hero:'',cover:'',screenshots:[],videos:[],artwork:[]},requirements:{pc:{minimum:{raw:''},recommended:{raw:''}},platforms:[]},links:{official:'',store:item.steam_appid?`https://store.steampowered.com/app/${item.steam_appid}/`:''},source:{name:'Franchise discovery',url:item.source_url||'',checked_at:new Date().toISOString()}})}

const franchiseQueue=readJSON('data/content-pipeline/franchise-queue.json',{schema_version:1,items:[]});
const franchiseTask=(franchiseQueue.items||[]).find(item=>item.status==='queued'||item.status==='needs_revision');
if(franchiseTask&&aiAvailable){
  ensureFranchiseSeed(franchiseTask);
  if(franchiseTask.steam_appid)run(`franchise-parse:${franchiseTask.slug}`,'node',['scripts/parse-game-data.mjs',franchiseTask.slug,String(franchiseTask.steam_appid),franchiseTask.title||'']);
  const built=run(`franchise-page:${franchiseTask.slug}`,'node',['scripts/build-game-page.mjs',franchiseTask.slug]);
  if(built){
    run(`franchise-page-qc:${franchiseTask.slug}`,'node',['scripts/quality-control-loop.mjs','page',franchiseTask.slug]);const qc=qualityStatus('page',franchiseTask.slug);
    franchiseTask.status=qc.green?'page_green':'needs_revision';
    if(qc.green){const replanned=run('replan-after-franchise-page','node',['scripts/orchestrate-content.mjs','--finalize']);if(replanned){run(`canonicalize-franchise:${franchiseTask.slug}`,'node',['scripts/canonicalize-editorial-game-id.mjs',franchiseTask.slug]);mergePlan(readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]}));}}
  }else franchiseTask.status='needs_revision';
  franchiseTask.updated_at=new Date().toISOString();franchiseQueue.updated_at=franchiseTask.updated_at;writeJSON('data/content-pipeline/franchise-queue.json',franchiseQueue);
}

let pageSucceeded=false;
for(const task of plan.pages||[]){
  if(!task.game_id){results.push({label:`page:${task.slug}`,status:'needs_revision',reason:'canonical_game_id_missing'});continue}
  if(task.steam_appid)run(`parse:${task.slug}`,'node',['scripts/parse-game-data.mjs',task.slug,String(task.steam_appid),task.title||'']);
  const built=run(`page:${task.slug}`,'node',['scripts/build-game-page-basic.mjs',task.game_id]);
  if(built){run(`page-qc:${task.slug}`,'node',['scripts/quality-control-loop.mjs','page',task.slug,task.game_id]);const qc=qualityStatus('page',task.slug);if(qc.green){pageSucceeded=true;run(`canonicalize-page:${task.slug}`,'node',['scripts/canonicalize-editorial-game-id.mjs',task.slug])}else results.push({label:`page-qc-state:${task.slug}`,status:'needs_revision',comments:qc.comments||[]})}
}
if(pageSucceeded){const replanned=run('replan-after-pages','node',['scripts/orchestrate-content.mjs','--finalize']);if(replanned)mergePlan(readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]}))}

let reviewSucceeded=false;
for(const task of plan.reviews||[]){
  const slug=task.slug;if(!task.game_id){results.push({label:`review:${slug}`,status:'needs_revision',reason:'canonical_game_id_missing'});continue}
  if(!exists(`data/drafts/${slug}.json`)){results.push({label:`review:${slug}`,status:'needs_revision',reason:`missing data/drafts/${slug}.json`});continue}
  if(!aiAvailable){results.push({label:`review:${slug}`,status:'needs_revision',reason:'AI revision service unavailable; item remains queued'});continue}
  run(`review-qc:${slug}`,'node',['scripts/quality-control-loop.mjs','review',slug,task.game_id]);const qc=qualityStatus('review',slug);if(qc.green){reviewSucceeded=true;run(`canonicalize-review:${slug}`,'node',['scripts/canonicalize-editorial-game-id.mjs',slug])}else results.push({label:`review-qc-state:${slug}`,status:'needs_revision',comments:qc.comments||[]});
}
if(reviewSucceeded&&exists('scripts/render-review-pages.mjs'))run('render-reviews','node',['scripts/render-review-pages.mjs']);
const finishedAt=new Date().toISOString();const summary={completed:results.filter(item=>item.status==='completed').length,needs_revision:results.filter(item=>item.status==='needs_revision'||item.status==='revision_required').length,total:results.length,editorial_ai_enabled:aiEnabled,editorial_ai_available:aiAvailable,quality_policy:'red -> revise/research/rebuild -> recheck; no terminal quality block'};
writeJSON('data/content-pipeline/execution-log.json',{schema_version:7,started_at:startedAt,finished_at:finishedAt,summary,results});console.log(JSON.stringify(summary,null,2));
