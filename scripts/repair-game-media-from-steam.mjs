#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const config=JSON.parse(fs.readFileSync(path.join(root,'config/game-media-steam-overrides.json'),'utf8'));
const requested=new Set(process.argv.slice(2).filter(Boolean));
const targets=Object.entries(config.games||{}).filter(([slug])=>!requested.size||requested.has(slug));
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const targetConfig=raw=>typeof raw==='object'&&raw!==null?raw:{appid:raw};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const nonEmpty=value=>Array.isArray(value)?value.length>0:(value&&typeof value==='object'?Object.keys(value).length>0:String(value??'').trim().length>0);

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
    publication:{status:'published',gate_passed:true,mode:'structured_sources',checked_at:null},
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

for(const [slug,raw] of targets){
  const settings=targetConfig(raw);
  const appid=Number(settings.appid);
  if(!appid)throw new Error(`${slug}: missing Steam appid`);
  const draftPath=path.join(root,'data/drafts',`${slug}.json`);
  const seed=findGameContent(slug);
  let draft=fs.existsSync(draftPath)?readJson(draftPath):seedDraft(slug,appid);
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
  const response=await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=US`,{headers:{'user-agent':'Igropoisk media repair/1.0'}});
  if(!response.ok)throw new Error(`${slug}: Steam HTTP ${response.status}`);
  const payload=await response.json();
  const data=payload?.[String(appid)]?.data;
  if(!data)throw new Error(`${slug}: Steam did not return app details for ${appid}`);
  const expected=canonical(draft.identity?.title||draft.identity?.seed_title||slug);
  const actual=canonical(data.name);
  const accepted=new Set([expected,...(settings.accepted_titles||[]).map(canonical)].filter(Boolean));
  if(actual&&!accepted.has(actual))throw new Error(`${slug}: Steam identity mismatch: ${data.name}`);
  const displayTitle=draft.identity?.title||data.name;
  const screenshots=(data.screenshots||[]).map((item,index)=>({
    url:item.path_full||item.path_thumbnail,
    caption:`${displayTitle} — скриншот ${index+1}`,
    source_url:`https://store.steampowered.com/app/${appid}/`
  })).filter(item=>item.url);
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
  draft.media={
    ...(draft.media||{}),
    cover:poster,
    hero:data.background_raw||data.background||data.header_image||draft.media?.hero||'',
    screenshots:screenshots.slice(0,18),
    artwork:[...new Set([data.background_raw,data.background,data.header_image].filter(Boolean))].map((url,index)=>({url,caption:index===0?'Ключевой арт':'Официальный арт',source_url:`https://store.steampowered.com/app/${appid}/`})),
    videos:(data.movies||[]).slice(0,6).map(movie=>({kind:'video',category:'official',title:movie.name||`${data.name} — видео`,url:movie.webm?.max||movie.mp4?.max||'',thumbnail:movie.thumbnail||'',source_url:`https://store.steampowered.com/app/${appid}/`,provider:'Steam'})).filter(item=>item.url)
  };
  draft.links={...(draft.links||{}),store:`https://store.steampowered.com/app/${appid}/`};
  draft.requirements={...(draft.requirements||{}),platforms:platforms.length?platforms:(draft.requirements?.platforms||[])};
  draft.sources=[...(draft.sources||[]).filter(source=>!String(source?.url||'').includes('bing.com/images/search')&&!String(source?.url||'').includes(`store.steampowered.com/app/${appid}`)), {name:`Steam — ${data.name}`,url:`https://store.steampowered.com/app/${appid}/`,type:'store',checked_at:new Date().toISOString()}];
  draft.publication={...(draft.publication||{}),mode:'structured_sources',checked_at:new Date().toISOString()};
  fs.mkdirSync(path.dirname(draftPath),{recursive:true});
  fs.writeFileSync(draftPath,`${JSON.stringify(draft,null,2)}\n`);
  console.log(`${slug}: ${screenshots.length} verified Steam screenshots; vertical poster ${poster}`);
  await sleep(600);
}
