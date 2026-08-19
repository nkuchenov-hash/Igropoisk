(()=>{
'use strict';

if(window.IgropoiskSearchCoverGuard)return;
window.IgropoiskSearchCoverGuard=true;

const MIN_RATIO=.48;
const MAX_RATIO=.86;
const MIN_WIDTH=240;
const MIN_HEIGHT=340;
const CACHE_KEY='igroSearchCoverChoiceV2';
const stateByHost=new WeakMap();
const metadata={bySlug:new Map(),byTitle:new Map(),popularCovers:{}};
let metadataReady=false;
let coverChoice={};

try{coverChoice=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{coverChoice={}}

const clean=value=>String(value??'').trim();
const canonical=value=>clean(value).normalize('NFKD').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const envelope=value=>value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'value')?value.value:value;
const urlOf=value=>typeof value==='string'?value:value&&typeof value==='object'?(value.url||value.cover_url||value.src||value.image||''):'';
const absolute=value=>{try{return new URL(value,document.baseURI).href}catch{return clean(value)}};
const sameUrl=(a,b)=>Boolean(a&&b&&absolute(a)===absolute(b));
const unique=values=>[...new Map((values||[]).map(urlOf).map(clean).filter(Boolean).map(value=>[absolute(value),value])).values()];
const steamAppId=value=>Number(clean(value).match(/(?:\/steam\/apps\/|\/apps\/)(\d+)\//i)?.[1]||0);
const portraitSemantic=value=>/(?:library[_-]?600x900|cover|poster|box.?art|portrait)/i.test(clean(value))&&!/(?:header|hero|background|screenshot|capsule[_-]?(?:616|467|231|184|120))/i.test(clean(value));

function saveChoice(key,url){
  if(!key||!url)return;
  coverChoice[key]=url;
  try{
    const entries=Object.entries(coverChoice).slice(-500);
    coverChoice=Object.fromEntries(entries);
    localStorage.setItem(CACHE_KEY,JSON.stringify(coverChoice));
  }catch{}
}

function readJSON(path){
  return fetch(`${path}${path.includes('?')?'&':'?'}coverResolver=2`,{cache:'default'}).then(response=>response.ok?response.json():null).catch(()=>null);
}

function mergeMeta(slug,title,patch={}){
  const safeSlug=clean(slug);
  const safeTitle=clean(title);
  const titleKey=canonical(safeTitle);
  const previous=(safeSlug&&metadata.bySlug.get(safeSlug))||(titleKey&&metadata.byTitle.get(titleKey))||{};
  const next={...previous,...patch};
  next.slug=safeSlug||previous.slug||'';
  next.title=safeTitle||previous.title||'';
  next.appid=Number(patch.appid||previous.appid||0);
  next.candidates=unique([...(previous.candidates||[]),...(patch.candidates||[])]);
  if(next.slug)metadata.bySlug.set(next.slug,next);
  if(next.title)metadata.byTitle.set(canonical(next.title),next);
  return next;
}

function registryPosterCandidates(entity){
  const list=Array.isArray(entity?.media)?entity.media:[];
  return list.filter(item=>portraitSemantic(`${item?.kind||''} ${urlOf(item)}`)).map(urlOf).filter(Boolean);
}

const metadataPromise=Promise.all([
  readJSON('data/catalog-visible.json'),
  readJSON('data/popular/covers.json'),
  readJSON('data/popular/current.json'),
  readJSON('data/game-registry/registry.transition.json')
]).then(([catalogPayload,coversPayload,popularPayload,registryPayload])=>{
  metadata.popularCovers=coversPayload&&typeof coversPayload==='object'?coversPayload:{};

  const catalog=Array.isArray(catalogPayload)?catalogPayload:(catalogPayload?.games||[]);
  catalog.forEach(item=>mergeMeta(item?.slug,item?.title||item?.name,{
    appid:Number(item?.steam_appid||item?.appid||item?.external_ids?.steam||0),
    candidates:[item?.cover,item?.poster,item?.image,item?.media?.cover,item?.media?.poster].filter(Boolean)
  }));

  (popularPayload?.ranking||[]).forEach(item=>{
    const evidenceAppid=(item?.evidence||[]).find(row=>Number(row?.appid))?.appid;
    mergeMeta(item?.slug,item?.title,{
      appid:Number(evidenceAppid||item?.appid||item?.steam_appid||0),
      candidates:[item?.image,...(item?.image_candidates||[])].filter(Boolean)
    });
  });

  Object.values(registryPayload?.games||{}).forEach(entity=>{
    const slug=clean(envelope(entity?.identity?.slug));
    const title=clean(envelope(entity?.identity?.canonicalTitle));
    const appid=Number(entity?.externalIds?.steamAppId||0);
    mergeMeta(slug,title,{appid,candidates:registryPosterCandidates(entity)});
  });

  for(const [slug,record] of Object.entries(metadata.popularCovers)){
    const current=metadata.bySlug.get(slug)||{};
    mergeMeta(slug,current.title||slug,{
      appid:Number(record?.appid||current.appid||0),
      candidates:[record?.local,record?.source].filter(Boolean)
    });
  }

  metadataReady=true;
}).catch(()=>{metadataReady=true});

function steamPosterCandidates(appid){
  const id=Number(appid||0);
  if(!id)return[];
  return [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`
  ];
}

function hostIdentity(host){
  const card=host.closest('.search-result-card');
  const title=clean(card?.querySelector('.result-title-line h3, h3')?.textContent);
  const explicitSlug=clean(card?.dataset?.game||host.dataset.gameSlug);
  const currentImage=host.querySelector('img');
  const current=clean(currentImage?.currentSrc||currentImage?.src);
  const byTitle=metadata.byTitle.get(canonical(title))||{};
  const bySlug=metadata.bySlug.get(explicitSlug)||{};
  const merged={...byTitle,...bySlug};
  const slug=explicitSlug||merged.slug||'';
  const appid=Number(steamAppId(current)||merged.appid||0);
  return{slug,title:title||merged.title||slug,appid,meta:merged,current};
}

function remembered(identity){
  return coverChoice[identity.slug]||coverChoice[canonical(identity.title)]||'';
}

function localCandidates(identity){
  const slug=identity.slug;
  if(!slug)return[];
  const verified=metadata.popularCovers?.[slug]?.local||'';
  return [
    verified,
    `assets/covers/popular/${slug}.jpg`,
    `assets/covers/popular/${slug}.webp`,
    `assets/covers/popular/${slug}.png`,
    `assets/covers/releases/${slug}.jpg`,
    `assets/covers/releases/${slug}.webp`,
    `assets/covers/releases/${slug}.png`
  ];
}

function staticCandidates(identity){
  const semanticMeta=(identity.meta?.candidates||[]).filter(url=>portraitSemantic(url));
  const current=identity.current;
  return unique([
    remembered(identity),
    ...localCandidates(identity),
    ...steamPosterCandidates(identity.appid),
    ...semanticMeta,
    portraitSemantic(current)?current:''
  ]);
}

function validPortrait(image){
  if(!image?.naturalWidth||!image?.naturalHeight)return false;
  const ratio=image.naturalWidth/image.naturalHeight;
  return ratio>=MIN_RATIO&&ratio<=MAX_RATIO&&image.naturalWidth>=MIN_WIDTH&&image.naturalHeight>=MIN_HEIGHT;
}

function ensureImage(host,identity){
  let image=host.querySelector('img');
  if(image)return image;
  image=document.createElement('img');
  image.alt=identity.title?`Обложка ${identity.title}`:'Обложка игры';
  image.loading='eager';
  image.decoding='async';
  image.dataset.fallback=clean(host.querySelector('.result-placeholder')?.textContent)||'ИП';
  host.replaceChildren(image);
  return image;
}

function setCandidate(host,state,index){
  if(index<0||index>=state.candidates.length)return false;
  const image=ensureImage(host,state.identity);
  state.index=index;
  state.waiting=true;
  image.hidden=false;
  const next=state.candidates[index];
  if(!sameUrl(image.getAttribute('src'),next))image.src=next;
  else if(image.complete)queueMicrotask(()=>onImageSettled(image));
  return true;
}

async function steamIdByTitle(title){
  if(!title)return 0;
  try{
    const url=`https://store.steampowered.com/search/results/?query&term=${encodeURIComponent(title)}&start=0&count=20&dynamic_data=&force_infinite=1&cc=us&l=english&json=1`;
    const response=await fetch(url,{cache:'default'});
    if(!response.ok)return 0;
    const payload=await response.json();
    const rows=(payload?.results_html||'').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi)||[];
    const expected=canonical(title);
    for(const row of rows){
      const found=canonical((row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1]||'').replace(/<[^>]+>/g,' '));
      const appid=Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1]||'').split(',')[0]);
      if(appid&&found===expected)return appid;
    }
  }catch{}
  return 0;
}

async function wikipediaCandidates(title){
  if(!title)return[];
  const urls=[];
  try{
    const query=`intitle:"${title}" video game`;
    const endpoint=`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8&prop=pageimages|extracts&exintro=1&explaintext=1&piprop=original|thumbnail&pithumbsize=1600&format=json&origin=*`;
    const response=await fetch(endpoint,{cache:'default'});
    if(response.ok){
      const payload=await response.json();
      const expected=canonical(title);
      for(const page of Object.values(payload?.query?.pages||{})){
        const pageTitle=canonical(clean(page?.title).replace(/\s*\([^)]*\)\s*$/,''));
        const extract=clean(page?.extract);
        if(pageTitle!==expected||!/video game|game developed|game published|computer game/i.test(extract))continue;
        if(page?.original?.source)urls.push(page.original.source);
        if(page?.thumbnail?.source)urls.push(page.thumbnail.source);
      }
    }
  }catch{}
  return unique(urls);
}

async function extendCandidates(host,state){
  if(state.extending)return state.extending;
  state.extending=(async()=>{
    if(!state.identity.appid&&!state.triedSteamLookup){
      state.triedSteamLookup=true;
      const appid=await steamIdByTitle(state.identity.title);
      if(appid){
        state.identity.appid=appid;
        state.candidates=unique([...state.candidates,...steamPosterCandidates(appid)]);
        return true;
      }
    }
    if(!state.triedWikipedia){
      state.triedWikipedia=true;
      const extra=await wikipediaCandidates(state.identity.title);
      if(extra.length){
        state.candidates=unique([...state.candidates,...extra]);
        return true;
      }
    }
    return false;
  })().finally(()=>{state.extending=null});
  return state.extending;
}

function hardFallback(host,state){
  const image=host.querySelector('img');
  if(image)image.remove();
  let fallback=host.querySelector('.result-placeholder');
  if(!fallback){
    fallback=document.createElement('div');
    fallback.className='result-placeholder';
    fallback.textContent=state?.fallback||'ИП';
    host.appendChild(fallback);
  }
  host.dataset.coverResolution='unresolved';
}

async function advance(host,state){
  if(!host?.isConnected)return;
  const next=state.index+1;
  if(setCandidate(host,state,next))return;
  const before=state.candidates.length;
  const extended=await extendCandidates(host,state);
  if(extended&&state.candidates.length>before&&setCandidate(host,state,before))return;
  hardFallback(host,state);
}

function onImageSettled(image){
  const host=image?.closest('#search .result-media');
  if(!host)return;
  const state=stateByHost.get(host);
  if(!state)return;
  if(image.naturalWidth&&validPortrait(image)){
    state.waiting=false;
    host.dataset.coverResolution='ready';
    const selected=state.candidates[state.index]||image.currentSrc||image.src;
    const key=state.identity.slug||canonical(state.identity.title);
    saveChoice(key,selected);
    return;
  }
  if(image.complete)void advance(host,state);
}

async function resolveHost(host){
  if(!(host instanceof Element)||!host.matches('#search .result-media')||stateByHost.has(host))return;
  await metadataPromise;
  if(!host.isConnected)return;
  const identity=hostIdentity(host);
  const currentImage=host.querySelector('img');
  const fallback=clean(currentImage?.dataset?.fallback||host.querySelector('.result-placeholder')?.textContent)||'ИП';
  const state={identity,candidates:staticCandidates(identity),index:-1,waiting:false,fallback,triedSteamLookup:false,triedWikipedia:false,extending:null};
  stateByHost.set(host,state);
  if(!state.candidates.length){
    const extended=await extendCandidates(host,state);
    if(!extended||!state.candidates.length){hardFallback(host,state);return}
  }
  setCandidate(host,state,0);
}

/* Capture before search-page's own error handler so a recoverable cover is never replaced by a placeholder. */
window.addEventListener('error',event=>{
  const image=event.target;
  if(!(image instanceof HTMLImageElement))return;
  const host=image.closest('#search .result-media');
  if(!host)return;
  event.stopPropagation();
  event.stopImmediatePropagation();
  const state=stateByHost.get(host);
  if(state)void advance(host,state);else void resolveHost(host);
},true);

window.addEventListener('load',event=>{
  const image=event.target;
  if(image instanceof HTMLImageElement&&image.closest('#search .result-media'))onImageSettled(image);
},true);

function scan(root=document){
  if(root instanceof Element&&root.matches('#search .result-media'))void resolveHost(root);
  root.querySelectorAll?.('#search .result-media').forEach(host=>void resolveHost(host));
}

new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
  if(node.nodeType===1)scan(node);
}))).observe(document.documentElement,{childList:true,subtree:true});

metadataPromise.finally(()=>scan(document));
scan(document);
})();
