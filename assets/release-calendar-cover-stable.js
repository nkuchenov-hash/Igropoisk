(()=>{
  'use strict';

  const CACHE_KEY='igroReleaseCoverChoiceV2';
  const mediaSelector=[
    '.release-calendar-item__media',
    '.release-list-item__media',
    '.release-upcoming-item__media',
    '.release-feed-card__image',
    '.release-detail-cover'
  ].join(',');
  const games=new Map();
  const steamDetails=new Map();
  let choices={};
  let ready=false;
  let queued=false;

  try{choices=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{choices={}}

  const clean=value=>String(value||'').trim();
  const normalize=value=>{
    const url=clean(value);
    if(!url)return '';
    if(/^https?:\/\//i.test(url)||url.startsWith('data:')||url.startsWith('blob:'))return url;
    if(url.startsWith('../'))return url;
    if(url.startsWith('/'))return `..${url}`;
    return url.startsWith('assets/')?`../${url}`:url;
  };
  const absolute=value=>{
    try{return new URL(value,document.baseURI).href}catch{return normalize(value)}
  };
  const same=(left,right)=>Boolean(left&&right&&absolute(left)===absolute(right));
  const unique=values=>{
    const result=[];
    for(const value of values||[]){
      const normalized=normalize(value);
      if(normalized&&!result.some(item=>same(item,normalized)))result.push(normalized);
    }
    return result;
  };

  function saveChoices(){
    try{
      choices=Object.fromEntries(Object.entries(choices).slice(-160));
      localStorage.setItem(CACHE_KEY,JSON.stringify(choices));
    }catch{}
  }

  function remember(slug,url){
    const normalized=normalize(url);
    if(!slug||!normalized||same(choices[slug],normalized))return;
    delete choices[slug];
    choices[slug]=normalized;
    saveChoices();
  }

  function forget(slug,url){
    if(!slug||!choices[slug]||!same(choices[slug],url))return;
    delete choices[slug];
    saveChoices();
  }

  function steamCandidates(appid){
    const id=Number(appid);
    if(!id)return [];
    return [
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://shared.akamai.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_467x181.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_231x87.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_sm_120.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`
    ];
  }

  function candidatesFor(game){
    return unique([
      choices[game.slug],
      game.image?.local_url,
      game.image?.source_url,
      ...(game.image_candidates||[]),
      ...steamCandidates(game.external_ids?.steam),
      ...(game._stableExtraCovers||[])
    ]);
  }

  function mediaFor(image){return image?.closest(mediaSelector)}
  function ownerFor(media){return media?.closest('[data-release]')}
  function slugFor(media){
    return media?.dataset.stableSlug||
      ownerFor(media)?.dataset.release||
      media?.dataset.coverRelease||
      media?.closest('#releaseModalContent')?.querySelector('[data-modal-bookmark]')?.dataset.modalBookmark||
      '';
  }

  function readCandidates(image){
    try{return JSON.parse(decodeURIComponent(image.dataset.stableCandidates||''))||[]}catch{return []}
  }

  function storeCandidates(image,candidates){
    image.dataset.stableCandidates=encodeURIComponent(JSON.stringify(candidates));
  }

  function setSource(image,candidates,index){
    if(index<0||index>=candidates.length)return false;
    storeCandidates(image,candidates);
    image.dataset.stableIndex=String(index);
    image.hidden=false;
    const media=mediaFor(image);
    media?.classList.remove('is-broken');
    if(!same(image.getAttribute('src'),candidates[index]))image.src=candidates[index];
    return true;
  }

  function prepareImage(image,media,game){
    const slug=game.slug;
    const candidates=candidatesFor(game);
    if(!candidates.length)return;

    media.dataset.stableSlug=slug;
    image.loading='eager';
    image.decoding='async';
    image.alt=image.alt||`Обложка ${game.title}`;
    image.hidden=false;
    media.classList.remove('is-broken');
    storeCandidates(image,candidates);

    const current=image.getAttribute('src')||'';
    const preferred=candidates[0];
    const currentIndex=candidates.findIndex(candidate=>same(candidate,current));

    /* The remembered successful URL must be the very first request after a reload. */
    if(choices[slug]&&!same(current,preferred)){
      setSource(image,candidates,0);
      return;
    }

    if(!current){
      setSource(image,candidates,0);
      return;
    }

    image.dataset.stableIndex=String(currentIndex>=0?currentIndex:0);
    if(image.complete){
      if(image.naturalWidth>0)remember(slug,current);
      else queueMicrotask(()=>void advance(image));
    }
  }

  async function extraSteamCandidates(game){
    const appid=Number(game?.external_ids?.steam);
    if(!appid)return [];
    if(steamDetails.has(appid))return steamDetails.get(appid);
    const request=fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`,{cache:'force-cache'})
      .then(response=>response.ok?response.json():null)
      .then(payload=>{
        const data=payload?.[appid]?.data||{};
        return unique([
          data.capsule_imagev5,
          data.header_image,
          data.background,
          data.background_raw,
          ...(data.screenshots||[]).slice(0,5).flatMap(row=>[row.path_full,row.path_thumbnail])
        ]);
      })
      .catch(()=>[]);
    steamDetails.set(appid,request);
    return request;
  }

  async function advance(image){
    if(image.dataset.stableAdvancing==='true')return;
    const media=mediaFor(image);
    if(!media)return;
    const slug=slugFor(media);
    const game=games.get(slug);
    if(!game){image.dataset.stablePending='true';return}

    image.dataset.stableAdvancing='true';
    image.hidden=false;
    media.classList.remove('is-broken');

    try{
      let candidates=readCandidates(image);
      if(!candidates.length)candidates=candidatesFor(game);
      const failed=image.getAttribute('src')||'';
      forget(slug,failed);
      let current=candidates.findIndex(candidate=>same(candidate,failed));
      if(current<0)current=Number(image.dataset.stableIndex??-1);
      if(setSource(image,candidates,current+1))return;

      const extra=await extraSteamCandidates(game);
      game._stableExtraCovers=unique([...(game._stableExtraCovers||[]),...extra]);
      const extended=candidatesFor(game);
      const next=extended.findIndex(candidate=>!candidates.some(old=>same(old,candidate)));
      if(next>=0&&setSource(image,extended,next))return;

      image.hidden=false;
      media.classList.add('is-broken');
    }finally{
      image.dataset.stableAdvancing='false';
    }
  }

  function patchMedia(media){
    const slug=slugFor(media);
    if(!slug)return;
    let image=media.querySelector('img');

    /* Apply a remembered source synchronously, before waiting for JSON. */
    if(image&&choices[slug]&&!same(image.getAttribute('src'),choices[slug])){
      image.loading='eager';
      image.hidden=false;
      media.classList.remove('is-broken');
      image.src=choices[slug];
    }

    if(!ready)return;
    const game=games.get(slug);
    if(!game)return;
    if(!image){
      image=document.createElement('img');
      media.appendChild(image);
    }
    prepareImage(image,media,game);
  }

  function patch(root=document){
    if(root instanceof Element&&root.matches(mediaSelector))patchMedia(root);
    root.querySelectorAll?.(mediaSelector).forEach(patchMedia);
  }

  function queuePatch(){
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      patch(document);
    });
  }

  window.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=mediaFor(image);
    if(!media||!slugFor(media))return;
    event.stopPropagation();
    event.stopImmediatePropagation();
    image.hidden=false;
    media.classList.remove('is-broken');
    void advance(image);
  },true);

  window.addEventListener('load',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=mediaFor(image);
    if(!media)return;
    image.hidden=false;
    media.classList.remove('is-broken');
    remember(slugFor(media),image.getAttribute('src')||image.currentSrc);
  },true);

  new MutationObserver(queuePatch).observe(document.body,{childList:true,subtree:true});
  patch(document);

  fetch('../data/releases/current.json',{cache:'force-cache'})
    .then(response=>{
      if(!response.ok)throw new Error(`Release covers HTTP ${response.status}`);
      return response.json();
    })
    .then(payload=>{
      (payload.releases||[]).forEach(game=>games.set(game.slug,game));
      ready=true;
      patch(document);
      document.querySelectorAll('img[data-stable-pending="true"]').forEach(image=>{
        delete image.dataset.stablePending;
        void advance(image);
      });
    })
    .catch(error=>console.warn('Release cover stability:',error));
})();
