import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const readJSON=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const writeJSON=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const remove=relative=>{const target=path.join(root,relative);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true})};
let plan=readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]});
const catalog=readJSON('data/catalog-visible.json',[]);
const acceptancePath='data/content-pipeline/page-acceptance-target.json';
const acceptance=readJSON(acceptancePath,{enabled:false});
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
  if(corpusRed||ratingRed){plan.reviews.push({type:'build_review',game_id:String(game.game_id||feed?.game_id||''),slug,title:game.title||slug,steam_appid:game.steam_appid||null,priority:1000,reason:[corpusRed?'review_corpus_needs_revision':'',ratingRed?'rating_needs_revision':''].filter(Boolean).join('+')});reviewSlugs.add(slug)}
}
const targetSlug=String(process.env.GAME_TARGET_SLUG||(acceptance.enabled?acceptance.slug:'')||'').trim();
if(targetSlug&&!pageSlugs.has(targetSlug)){const game=catalog.find(item=>item.slug===targetSlug);if(game){plan.pages.push({type:'build_page',game_id:String(game.game_id||''),slug:targetSlug,title:game.title||targetSlug,steam_appid:game.steam_appid||null,priority:9999,reason:'explicit_page_acceptance'});pageSlugs.add(targetSlug)}}
if(targetSlug){plan.pages=plan.pages.filter(item=>item.slug===targetSlug);plan.reviews=plan.reviews.filter(item=>item.slug===targetSlug)}

const startedAt=new Date().toISOString();const results=[];
const freePageAiConfigured=/^(1|true|yes|on)$/i.test(String(process.env.FREE_EDITORIAL_AI_ENABLED||''))||Boolean(process.env.OLLAMA_BASE_URL);
const reviewAiAvailable=Boolean(process.env.OPENAI_API_KEY); // Separate Review subsystem only; never used by Game Page Assembly.
function run(label,command,args,env={}){const started=Date.now();const child=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,...env},maxBuffer:24*1024*1024});const record={label,command:[command,...args].join(' '),status:child.status===0?'completed':'revision_required',exit_code:child.status,duration_ms:Date.now()-started,stdout:(child.stdout||'').slice(-12000),stderr:(child.stderr||'').slice(-12000)};results.push(record);console.log(`\n[${record.status}] ${record.command}`);if(record.stdout)console.log(record.stdout);if(record.stderr)console.error(record.stderr);return child.status===0}
function qualityStatus(type,slug){return readJSON(`data/quality-control/${type}-${slug}-control.json`,{status:'red-needs-revision',green:false})}
function ensureFranchiseSeed(item){const relative=`data/parser-output/${item.slug}.json`;if(exists(relative))return;writeJSON(relative,{schema_version:1,identity:{slug:item.slug,title:item.title,steam_appid:item.steam_appid||null},release:{date_text:item.release_year?String(item.release_year):''},companies:{developers:[],publishers:[]},classification:{genres:[],categories:[],platforms:[]},editorial:{short_description:'',integrated_description:'',features:[]},media:{hero:'',cover:'',screenshots:[],videos:[],artwork:[]},requirements:{pc:{minimum:{raw:''},recommended:{raw:''}},platforms:[]},links:{official:'',store:item.steam_appid?`https://store.steampowered.com/app/${item.steam_appid}/`:''},source:{name:'Franchise discovery',url:item.source_url||'',checked_at:new Date().toISOString()}})}
const preserveOfficialSteamVideos=slug=>exists('scripts/merge-official-steam-videos.mjs')?run(`official-steam-videos:${slug}`,'node',['scripts/merge-official-steam-videos.mjs',slug]):true;

function fileSnapshot(relative){return exists(relative)?fs.readFileSync(path.join(root,relative)):null}
function restoreFile(relative,value){if(value===null){remove(relative);return}const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value)}
function publicationSnapshot(slug){
  const currentCatalog=readJSON('data/catalog-visible.json',[]);const catalogEntry=currentCatalog.find(item=>item.slug===slug)||null;
  const draft=readJSON(`data/drafts/${slug}.json`,null);const wasPublished=Boolean(catalogEntry&&draft?.publication?.status==='published'&&draft?.publication?.public_ready===true);
  const page=`game/${slug}/index.html`;const pageHtml=fileSnapshot(page);const chunks=[];const dir=path.join(root,'data/game-content');
  if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.json'))){const relative=`data/game-content/${file}`;const data=readJSON(relative);if(data?.games&&Object.prototype.hasOwnProperty.call(data.games,slug))chunks.push({relative,game:structuredClone(data.games[slug])})}
  const canonicalFiles=[`data/drafts/${slug}.json`,`data/page-editorial/${slug}.json`,`data/game-sources/${slug}.json`,`data/ratings/${slug}.json`];
  return{wasPublished,catalogEntry,pageHtml,chunks,canonicalFiles:Object.fromEntries(canonicalFiles.map(relative=>[relative,fileSnapshot(relative)]))};
}
function restorePublishedSnapshot(slug,snapshot){
  if(!snapshot?.wasPublished)return false;
  let currentCatalog=readJSON('data/catalog-visible.json',[]).filter(item=>item.slug!==slug);if(snapshot.catalogEntry)currentCatalog.push(snapshot.catalogEntry);currentCatalog.sort((a,b)=>Number(a.year)-Number(b.year)||String(a.title).localeCompare(String(b.title),'ru'));writeJSON('data/catalog-visible.json',currentCatalog);
  const dir=path.join(root,'data/game-content');if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.json'))){const relative=`data/game-content/${file}`;const data=readJSON(relative);if(!data?.games||!Object.prototype.hasOwnProperty.call(data.games,slug))continue;delete data.games[slug];writeJSON(relative,data)}
  for(const saved of snapshot.chunks){const data=readJSON(saved.relative,{schema_version:4,games:{}});data.games=data.games||{};data.games[slug]=saved.game;writeJSON(saved.relative,data)}
  restoreFile(`game/${slug}/index.html`,snapshot.pageHtml);
  for(const [relative,value] of Object.entries(snapshot.canonicalFiles||{}))restoreFile(relative,value);
  results.push({label:`page-rollback:${slug}`,status:'completed',reason:'failed revision restored last published canonical page package'});return true;
}
function canonicalizePage(slug,snapshot){const ok=run(`canonicalize-page:${slug}`,'node',['scripts/canonicalize-editorial-game-id.mjs',slug]);if(ok)return true;restorePublishedSnapshot(slug,snapshot);results.push({label:`page-identity:${slug}`,status:'needs_revision',reason:'canonical identity could not be applied before finalization'});return false}
function finalizePage(slug,gameId,snapshot){const ok=run(`page-finalize:${slug}`,'node',['scripts/finalize-game-page-publication.mjs',slug,gameId||'']);if(ok)return true;restorePublishedSnapshot(slug,snapshot);results.push({label:`page-publication:${slug}`,status:'needs_revision',reason:'strict finalizer rejected revision'});return false}

const relationTask=catalog.find(item=>{const slug=String(item.slug||'');if(!slug||targetSlug&&slug!==targetSlug)return false;const draft=readJSON(`data/drafts/${slug}.json`);return Boolean(draft?.identity)&&!draft?.relations?.checked_at;});
if(relationTask&&freePageAiConfigured){const relationOk=run(`relations:${relationTask.slug}`,'node',['scripts/enrich-game-relations.mjs',relationTask.slug]);if(relationOk)run(`similarity-after-relations:${relationTask.slug}`,'node',['scripts/build-similarity-index.mjs',relationTask.slug])}

const franchiseQueue=readJSON('data/content-pipeline/franchise-queue.json',{schema_version:1,items:[]});
const franchiseTask=(franchiseQueue.items||[]).find(item=>(item.status==='queued'||item.status==='needs_revision')&&(!targetSlug||item.slug===targetSlug));
if(franchiseTask){
  ensureFranchiseSeed(franchiseTask);const snapshot=publicationSnapshot(franchiseTask.slug);
  if(franchiseTask.steam_appid)run(`franchise-parse:${franchiseTask.slug}`,'node',['scripts/parse-game-data.mjs',franchiseTask.slug,String(franchiseTask.steam_appid),franchiseTask.title||'']);
  const registryId=String(franchiseTask.game_id||'').trim();const built=registryId?run(`franchise-page:${franchiseTask.slug}`,'node',['scripts/build-game-page-basic.mjs',registryId]):false;
  if(built){run(`franchise-page-qc:${franchiseTask.slug}`,'node',['scripts/quality-control-loop.mjs','page',franchiseTask.slug,registryId]);preserveOfficialSteamVideos(franchiseTask.slug);const qc=qualityStatus('page',franchiseTask.slug);const identityReady=qc.green&&canonicalizePage(franchiseTask.slug,snapshot);if(identityReady&&finalizePage(franchiseTask.slug,registryId,snapshot)){franchiseTask.status='page_green';const replanned=run('replan-after-franchise-page','node',['scripts/orchestrate-content.mjs','--finalize']);if(replanned)mergePlan(readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]}))}else{franchiseTask.status='needs_revision';restorePublishedSnapshot(franchiseTask.slug,snapshot)}}else{franchiseTask.status='needs_revision';restorePublishedSnapshot(franchiseTask.slug,snapshot)}
  franchiseTask.updated_at=new Date().toISOString();franchiseQueue.updated_at=franchiseTask.updated_at;writeJSON('data/content-pipeline/franchise-queue.json',franchiseQueue);
}

let pageSucceeded=false;
for(const task of plan.pages||[]){
  if(!task.game_id){results.push({label:`page:${task.slug}`,status:'needs_revision',reason:'canonical_game_id_missing'});continue}
  const snapshot=publicationSnapshot(task.slug);
  if(task.steam_appid)run(`parse:${task.slug}`,'node',['scripts/parse-game-data.mjs',task.slug,String(task.steam_appid),task.title||'']);
  const built=run(`page:${task.slug}`,'node',['scripts/build-game-page-basic.mjs',task.game_id]);
  if(!built){restorePublishedSnapshot(task.slug,snapshot);continue}
  run(`page-qc:${task.slug}`,'node',['scripts/quality-control-loop.mjs','page',task.slug,task.game_id]);preserveOfficialSteamVideos(task.slug);
  const qc=qualityStatus('page',task.slug);const identityReady=qc.green&&canonicalizePage(task.slug,snapshot);
  if(identityReady&&finalizePage(task.slug,task.game_id,snapshot))pageSucceeded=true;
  else{restorePublishedSnapshot(task.slug,snapshot);results.push({label:`page-qc-state:${task.slug}`,status:'needs_revision',comments:qc.comments||[]})}
}
if(pageSucceeded){const replanned=run('replan-after-pages','node',['scripts/orchestrate-content.mjs','--finalize']);if(replanned)mergePlan(readJSON('data/content-pipeline/execution-plan.json',{pages:[],reviews:[]}))}

// Review article is a separate subsystem. Its availability never changes page publication state.
let reviewSucceeded=false;
for(const task of plan.reviews||[]){
  const slug=task.slug;if(!task.game_id){results.push({label:`review:${slug}`,status:'needs_revision',reason:'canonical_game_id_missing'});continue}
  if(!exists(`data/drafts/${slug}.json`)){results.push({label:`review:${slug}`,status:'needs_revision',reason:`missing data/drafts/${slug}.json`});continue}
  if(!reviewAiAvailable){results.push({label:`review:${slug}`,status:'needs_revision',reason:'Optional Review editorial service unavailable; Game Page publication is unaffected'});continue}
  run(`review-qc:${slug}`,'node',['scripts/quality-control-loop.mjs','review',slug,task.game_id]);const qc=qualityStatus('review',slug);if(qc.green){reviewSucceeded=true;run(`canonicalize-review:${slug}`,'node',['scripts/canonicalize-editorial-game-id.mjs',slug])}else results.push({label:`review-qc-state:${slug}`,status:'needs_revision',comments:qc.comments||[]});
}
if(reviewSucceeded&&exists('scripts/render-review-pages.mjs'))run('render-reviews','node',['scripts/render-review-pages.mjs']);

if(acceptance.enabled&&targetSlug===acceptance.slug){const draft=readJSON(`data/drafts/${targetSlug}.json`,{}),qc=qualityStatus('page',targetSlug);const passed=Boolean(qc.green&&draft.publication?.status==='published'&&draft.publication?.public_ready===true);acceptance.status=passed?'passed':'needs_revision';acceptance.last_checked_at=new Date().toISOString();acceptance.enabled=!passed;acceptance.last_comments=qc.comments||[];writeJSON(acceptancePath,acceptance)}
const finishedAt=new Date().toISOString();
const summary={completed:results.filter(item=>item.status==='completed').length,needs_revision:results.filter(item=>item.status==='needs_revision'||item.status==='revision_required').length,total:results.length,free_page_ai_configured:freePageAiConfigured,review_ai_available:reviewAiAvailable,target_slug:targetSlug||null,page_builder:'draft-first-structured-sources',quality_policy:'draft -> canonical source corpus -> free page editorial -> content/media/page QC -> canonical identity -> sole finalizer -> public; published package is immutable and failed revision restores the previous canonical package'};
writeJSON('data/content-pipeline/execution-log.json',{schema_version:14,started_at:startedAt,finished_at:finishedAt,summary,results});console.log(JSON.stringify(summary,null,2));
