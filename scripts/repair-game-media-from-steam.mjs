#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const config=JSON.parse(fs.readFileSync(path.join(root,'config/game-media-steam-overrides.json'),'utf8'));
const requested=new Set(process.argv.slice(2).filter(Boolean));
const targets=Object.entries(config.games||{}).filter(([slug])=>!requested.size||requested.has(slug));
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const readOptional=(relative,fallback=null)=>{try{return readJson(path.join(root,relative))}catch{return fallback}};
const writeJson=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const targetConfig=raw=>typeof raw==='object'&&raw!==null?raw:{appid:raw};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const nonEmpty=value=>Array.isArray(value)?value.length>0:(value&&typeof value==='object'?Object.keys(value).length>0:String(value??'').trim().length>0);
const isPublished=draft=>draft?.publication?.status==='published'&&draft?.publication?.public_ready===true;

function findGameContent(slug){
  const dir=path.join(root,'data/game-content');
  if(!fs.existsSync(dir))return null;
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort()){
    const payload=readJson(path.join(dir,file));
    if(payload?.games?.[slug])return clone(payload.games[slug]);
  }
  return null;
}

function mergeMissing(target={},seed={}){
  const out={...clone(seed),...clone(target)};
  for(const key of new Set([...Object.keys(seed||{}),...Object.keys(target||{})])){
    const current=target?.[key];
    const fallback=seed?.[key];
    if(current&&typeof current==='object'&&!Array.isArray(current)&&fallback&&typeof fallback==='object'&&!Array.isArray(fallback)) out[key]=mergeMissing(current,fallback);
    else if(!nonEmpty(current)&&nonEmpty(fallback)) out[key]=clone(fallback);
  }
  return out;
}

function seedDraft(slug,appid){
  const seed=findGameContent(slug);
  if(!seed)throw new Error(`Missing draft and game-content seed for ${slug}`);
  return {
    schema_version:3,
    publication:{status:'needs_revision',public_ready:false,gate_passed:false,mode:'structured_sources',checked_at:null},
    game_id:seed.game_id||null,
    identity:{...(seed.identity||{}),slug,steam_appid:appid},
    release:seed.release||{},
    companies:seed.companies||{},
    classification:seed.classification||{},
    editorial:seed.editorial||{},
    ratings:seed.ratings||{},
    media:seed.media||{},
    requirements:seed.requirements||{},
    links:seed.links||{},
    sources:[]
  };
}

function queuePublishedRevision(slug,draft,appid){
  const now=new Date().toISOString();
  const plan=readOptional('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});
  plan.pages=Array.isArray(plan.pages)?plan.pages:[];
  plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
  const item={type:'build_page',game_id:String(draft.game_id||''),slug,title:String(draft.identity?.title||slug),steam_appid:appid,priority:6500,reason:'verified_steam_media_revision'};
  const index=plan.pages.findIndex(entry=>entry.slug===slug);
  if(index>=0)plan.pages[index]={...plan.pages[index],...item,priority:Math.max(Number(plan.pages[index]?.priority||0),item.priority)};
  else plan.pages.push(item);
  plan.updated_at=now;
  writeJson('data/content-pipeline/execution-plan.json',plan);
  writeJson(`data/parser-runs/steam-media-repair-${slug}.json`,{parser:'steam-media-repair',status:'needs_revision',game_slug:slug,game_id:draft.game_id||null,checked_at:now,steam_appid:appid,published_package_preserved:true,public_ready:true,action:'queued_new_page_revision',publication_owner:'scripts/finalize-game-page-publication.mjs'});
  console.log(JSON.stringify({slug,status:'needs_revision',published_package_preserved:true,queued_new_page_revision:true},null,2));
}

for(const [slug,raw] of targets){
  const settings=targetConfig(raw);
  const appid=Number(settings.appid);
  if(!appid)throw new Error(`${slug}: missing Steam appid`);
  const draftPath=path.join(root,'data/drafts',`${slug}.json`);
  const existingDraft=fs.existsSync(draftPath)?readJson(draftPath):null;
  if(isPublished(existingDraft)){
    queuePublishedRevision(slug,existingDraft,appid);
    continue;
  }
  const seed=findGameContent(slug);
  let draft=existingDraft||seedDraft(slug,appid);
  if(seed){
    draft=mergeMissing(draft,{
      game_id:seed.game_id||null,
      identity:seed.identity||{},
      release:seed.release||{},
      companies:seed.companies||{},
      classification:seed.classification||{},
      editorial:seed.editorial||{},
      ratings:seed.ratings||{},
      requirements:seed.requirements||{},
      links:seed.links||{}
    });
  }
  const response=await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=US`,{headers:{'user-agent':'Igropoisk media repair/1.1'}});
  if(!response.ok)throw new Error(`${slug}: Steam HTTP ${response.status}`);
  const payload=await response.json();
  const data=payload?.[String(appid)]?.data;
  if(!data)throw new Error(`${slug}: Steam did not return app details for ${appid}`);
  const expected=canonical(draft.identity?.title||draft.identity?.seed_title||slug);
  const actual=canonical(data.name);
  const accepted=new Set([expected,...(settings.accepted_titles||[]).map(canonical)].filter(Boolean));
  if(actual&&!accepted.has(actual))throw new Error(`${slug}: Steam identity mismatch: ${data.name}`);
  const displayTitle=draft.identity?.title||data.name;
  const screenshots=(data.screenshots||[]).map((item,index)=>({url:item.path_full||item.path_thumbnail,caption:`${displayTitle} — скриншот ${index+1}`,source_url:`https://store.steampowered.com/app/${appid}/`})).filter(item=>item.url);
  if(screenshots.length<6)throw new Error(`${slug}: Steam returned only ${screenshots.length} screenshots`);
  const developers=Array.isArray(data.developers)?data.developers:[];
  const publishers=Array.isArray(data.publishers)?data.publishers:[];
  const platforms=Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([name])=>name==='windows'?'Windows':name==='mac'?'macOS':name==='linux'?'Linux':name);
  const poster=`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
  draft.identity={...(draft.identity||{}),slug,steam_appid:appid};
  if(!draft.identity.title)draft.identity.title=data.name;
  draft.release={...(draft.release||{}),date_text:data.release_date?.date||draft.release?.date_text||'',status:data.release_date?.coming_soon?'upcoming':draft.release?.status||'released'};
  draft.companies={developers:developers.length?developers:(draft.companies?.developers||[]),publishers:publishers.length?publishers:(draft.companies?.publishers||[])};
  draft.classification={...(draft.classification||{}),genres:(data.genres||[]).map(item=>item.description).filter(Boolean),platforms:platforms.length?platforms:(draft.classification?.platforms||[])};
  draft.media={...(draft.media||{}),cover:poster,hero:data.background_raw||data.background||data.header_image||draft.media?.hero||'',screenshots:screenshots.slice(0,18),artwork:[...new Set([data.background_raw,data.background,data.header_image].filter(Boolean))].map((url,index)=>({url,caption:index===0?'Ключевой арт':'Официальный арт',source_url:`https://store.steampowered.com/app/${appid}/`})),videos:(data.movies||[]).slice(0,6).map(movie=>({kind:'video',category:'official',title:movie.name||`${data.name} — видео`,url:movie.webm?.max||movie.mp4?.max||'',thumbnail:movie.thumbnail||'',source_url:`https://store.steampowered.com/app/${appid}/`,provider:'Steam'})).filter(item=>item.url)};
  draft.links={...(draft.links||{}),store:`https://store.steampowered.com/app/${appid}/`};
  draft.requirements={...(draft.requirements||{}),platforms:platforms.length?platforms:(draft.requirements?.platforms||[])};
  draft.sources=[...(draft.sources||[]).filter(source=>!String(source?.url||'').includes('bing.com/images/search')&&!String(source?.url||'').includes(`store.steampowered.com/app/${appid}`)),{name:`Steam — ${data.name}`,url:`https://store.steampowered.com/app/${appid}/`,type:'store',checked_at:new Date().toISOString()}];
  draft.publication={status:'needs_revision',public_ready:false,gate_passed:false,mode:'structured_sources',checked_at:new Date().toISOString()};
  fs.mkdirSync(path.dirname(draftPath),{recursive:true});
  fs.writeFileSync(draftPath,`${JSON.stringify(draft,null,2)}\n`);
  writeJson(`data/parser-runs/steam-media-repair-${slug}.json`,{parser:'steam-media-repair',status:'needs_revision',game_slug:slug,game_id:draft.game_id||null,checked_at:draft.publication.checked_at,steam_appid:appid,published_package_preserved:false,public_ready:false,action:'repaired_revision_draft',publication_owner:'scripts/finalize-game-page-publication.mjs'});
  console.log(`${slug}: ${screenshots.length} verified Steam screenshots prepared in needs_revision draft; vertical poster ${poster}`);
  await sleep(600);
}
