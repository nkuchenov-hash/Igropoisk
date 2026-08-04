import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const now=new Date();
const nowIso=now.toISOString();
const args=new Set(process.argv.slice(2));
const finalize=args.has('--finalize');
const readJSON=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const writeJSON=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const daysSince=value=>{const time=Date.parse(value||'');return Number.isFinite(time)?Math.floor((Date.now()-time)/86400000):null};
const parseYear=value=>Number(String(value||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const slugify=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const config=readJSON('config/content-pipeline.json',{});
const pageGate=config.page_gate||{};
const cadence=config.refresh_cadence_days||{};
const limits=config.execution_limits||{};

function loadCurated(){
  const directory=path.join(root,'data/game-content');
  const records=new Map();
  if(!fs.existsSync(directory))return records;
  for(const file of fs.readdirSync(directory).filter(name=>name.endsWith('.json'))){
    const payload=readJSON(`data/game-content/${file}`,{});
    for(const [slug,game] of Object.entries(payload?.games||{}))records.set(slug,{game,file});
  }
  return records;
}
function releaseCandidates(){
  const payload=readJSON('data/releases/current.json',{});
  const rows=payload.releases||payload.games||payload.items||[];
  return rows.map(item=>{
    const event=(item.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
    const date=event.date||event.date_start||item.release_date||null;
    return {slug:item.slug||slugify(item.title),title:item.title||item.name,year:parseYear(date),release_date:date,steam_appid:Number(item.external_ids?.steam||item.steam_appid)||null,origin:'release-calendar'};
  }).filter(item=>item.slug&&item.title);
}
function computedPageGate(game){
  if(!game)return{passed:false,missing:['curated_record']};
  const missing=[];
  const sources=Array.isArray(game.sources)?game.sources.filter(item=>item?.url):[];
  const screenshots=Array.isArray(game.media?.screenshots)?game.media.screenshots.filter(Boolean):[];
  const features=Array.isArray(game.editorial?.features)?game.editorial.features.filter(Boolean):[];
  const requireField=(value,key)=>{if(!value||(Array.isArray(value)&&!value.length))missing.push(key)};
  requireField(game.identity?.title,'identity.title');
  requireField(game.release?.date_text||game.release?.date||game.release?.status,'release');
  requireField(game.companies?.developers,'companies.developers');
  requireField(game.companies?.publishers,'companies.publishers');
  requireField(game.classification?.genres,'classification.genres');
  requireField(game.classification?.platforms,'classification.platforms');
  requireField(game.editorial?.short_description,'editorial.short_description');
  requireField(game.editorial?.integrated_description,'editorial.integrated_description');
  requireField(game.media?.hero,'media.hero');
  requireField(game.media?.cover,'media.cover');
  if(features.length<Number(pageGate.minimum_features||4))missing.push(`editorial.features:${features.length}`);
  if(screenshots.length<Number(pageGate.minimum_screenshots||6))missing.push(`media.screenshots:${screenshots.length}`);
  if(sources.length<Number(pageGate.minimum_sources||10))missing.push(`sources:${sources.length}`);
  return{passed:missing.length===0,missing,metrics:{sources:sources.length,screenshots:screenshots.length,features:features.length}};
}
function articleState(slug){
  const article=readJSON(`data/articles/${slug}.json`,null);
  if(!article)return{published:false,updated_at:null};
  const published=article.publication_status==='published'||article.status==='published'||article.gate?.passed===true||article.source_gate_passed===true;
  return{published,updated_at:article.updated_at||article.published_at||null,title:article.title||null};
}
function newestTimestamp(...values){return values.filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null}

const curated=loadCurated();
const catalog=readJSON('data/catalog-visible.json',[]);
const candidates=new Map();
for(const item of catalog)candidates.set(item.slug,{slug:item.slug,title:item.title,year:Number(item.year)||0,steam_appid:Number(item.steam_appid)||null,origin:'catalog'});
for(const item of releaseCandidates())candidates.set(item.slug,{...(candidates.get(item.slug)||{}),...item,origin:candidates.has(item.slug)?'catalog+release':'release-calendar'});
for(const [slug,{game}] of curated)candidates.set(slug,{...(candidates.get(slug)||{}),slug,title:game.identity?.title||candidates.get(slug)?.title||slug,year:parseYear(game.release?.date_text||game.release?.date)||candidates.get(slug)?.year||0,steam_appid:Number(game.identity?.steam_appid)||candidates.get(slug)?.steam_appid||null,origin:candidates.get(slug)?.origin||'curated'});

const registry=[];
const queue=[];
for(const candidate of [...candidates.values()].sort((a,b)=>a.slug.localeCompare(b.slug))){
  const curatedRecord=curated.get(candidate.slug)?.game||null;
  const parserOutput=readJSON(`data/parser-output/${candidate.slug}.json`,null);
  const draft=readJSON(`data/drafts/${candidate.slug}.json`,null);
  const game=curatedRecord||draft||parserOutput;
  const steamAppId=Number(game?.identity?.steam_appid||candidate.steam_appid)||null;
  const year=parseYear(game?.release?.date_text||game?.release?.date)||candidate.year||0;
  const gate=computedPageGate(curatedRecord);
  const article=articleState(candidate.slug);
  const pageUpdated=newestTimestamp(curatedRecord?.publication?.updated_at,curatedRecord?.updated_at,curatedRecord?.source?.checked_at,draft?.updated_at,parserOutput?.source?.checked_at);
  const releaseDate=candidate.release_date||curatedRecord?.release?.date||null;
  const untilRelease=releaseDate&&Number.isFinite(Date.parse(releaseDate))?Math.ceil((Date.parse(releaseDate)-Date.now())/86400000):null;
  const pageAge=daysSince(pageUpdated);
  const articleAge=daysSince(article.updated_at);
  let state='discovered';
  if(curatedRecord&&!gate.passed)state='collecting';
  if(gate.passed)state=article.published?'review_published':'published';
  if(!curatedRecord&&(draft||parserOutput))state='collecting';
  const problems=[];
  if(!steamAppId)problems.push('steam_appid_missing');
  problems.push(...gate.missing);
  const priorityBase=(Number.isFinite(untilRelease)&&untilRelease>=-30&&untilRelease<=180?80:0)+(year>=now.getUTCFullYear()-1?40:0)+(candidate.origin.includes('release')?25:0);
  if(!gate.passed){
    queue.push({type:steamAppId?'build_page':'resolve_identity',slug:candidate.slug,title:candidate.title,steam_appid:steamAppId,priority:priorityBase+70,reason:gate.missing.join(', ')||'page not curated'});
  }else if(pageAge===null||pageAge>Number(cadence.published_page||90)){
    queue.push({type:'refresh_page',slug:candidate.slug,title:candidate.title,steam_appid:steamAppId,priority:priorityBase+20,reason:`page age ${pageAge??'unknown'} days`});
  }
  if(gate.passed&&!article.published){
    queue.push({type:'build_review',slug:candidate.slug,title:candidate.title,priority:priorityBase+60,reason:'published page has no Игропоиск review'});
  }else if(article.published&&(articleAge===null||articleAge>Number(cadence.published_review||180))&&(year>=now.getUTCFullYear()-2||Number.isFinite(untilRelease))){
    queue.push({type:'refresh_review',slug:candidate.slug,title:candidate.title,priority:priorityBase+10,reason:`review age ${articleAge??'unknown'} days`});
  }
  registry.push({slug:candidate.slug,title:candidate.title,year,steam_appid:steamAppId,origin:candidate.origin,state,page:{curated:Boolean(curatedRecord),gate_passed:gate.passed,updated_at:pageUpdated,metrics:gate.metrics,missing:gate.missing},review:article,release_date:releaseDate,days_until_release:untilRelease,problems:[...new Set(problems)]});
}
queue.sort((a,b)=>b.priority-a.priority||a.slug.localeCompare(b.slug));
const runnablePages=queue.filter(item=>['build_page','refresh_page'].includes(item.type)&&item.steam_appid).slice(0,Number(limits.pages_per_run||2));
const runnableReviews=queue.filter(item=>['build_review','refresh_review'].includes(item.type)).slice(0,Number(limits.reviews_per_run||1));
const status={schema_version:1,generated_at:nowIso,mode:finalize?'finalize':'plan',summary:{games:registry.length,published_pages:registry.filter(item=>item.page.gate_passed).length,published_reviews:registry.filter(item=>item.review.published).length,collecting:registry.filter(item=>!item.page.gate_passed).length,queued:queue.length,runnable_pages:runnablePages.length,runnable_reviews:runnableReviews.length,blocked_identity:queue.filter(item=>item.type==='resolve_identity').length},next:{pages:runnablePages,reviews:runnableReviews}};
writeJSON('data/content-pipeline/registry.json',{schema_version:1,generated_at:nowIso,items:registry});
writeJSON('data/content-pipeline/queue.json',{schema_version:1,generated_at:nowIso,items:queue});
writeJSON('data/content-pipeline/status.json',status);
writeJSON('data/content-pipeline/execution-plan.json',{schema_version:1,generated_at:nowIso,pages:runnablePages,reviews:runnableReviews});
writeJSON('data/parser-runs/content-pipeline.json',{parser:'content-pipeline',status:'success',checked_at:nowIso,summary:status.summary,output:'data/content-pipeline/status.json'});
console.log(JSON.stringify(status,null,2));
