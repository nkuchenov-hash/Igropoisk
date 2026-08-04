(()=>{
  'use strict';

  const nativeFetch=window.fetch.bind(window);
  const RELEASE_DATA='../data/releases/current.json';
  const POPULAR_DATA='../data/popular/current.json';
  const CHANGES_DATA='../data/releases/changes.json';
  const CACHE_KEY='igroReleaseCoverResolvedV3';
  const BUILD='20260804-4';
  const mediaSelector=[
    '.release-calendar-item__media',
    '.release-list-item__media',
    '.release-upcoming-item__media',
    '.release-feed-card__image',
    '.release-detail-cover'
  ].join(',');

  const games=new Map();
  const candidatesBySlug=new Map();
  let remembered={};
  try{remembered=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{remembered={}}

  const clean=value=>String(value||'').trim();
  const canonical=value=>clean(value).normalize('NFKD').toLowerCase()
    .replace(/&amp;/g,' and ')
    .replace(/[^a-z0-9а-яё]+/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
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

  function saveRemembered(){
    try{
      remembered=Object.fromEntries(Object.entries(remembered).slice(-160));
      localStorage.setItem(CACHE_KEY,JSON.stringify(remembered));
    }catch{}
  }
  function remember(slug,url){
    const normalized=normalize(url);
    if(!slug||!normalized||same(remembered[slug],normalized))return;
    delete remembered[slug];
    remembered[slug]=normalized;
    saveRemembered();
  }
  function forget(slug,url){
    if(!slug||!remembered[slug]||!same(remembered[slug],url))return;
    delete remembered[slug];
    saveRemembered();
  }

  function steamFallbacks(appid){
    const id=Number(appid);
    if(!id)return [];
    return [
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
      `https://shared.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/capsule_467x181.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_467x181.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${id}/capsule_231x87.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_231x87.jpg`
    ];
  }

  function rankedPopularCandidates(item){
    if(!item)return [];
    const values=unique([item.image,...(item.image_candidates||[]),item.cover_source]);
    return values.sort((left,right)=>{
      const rank=url=>{
        const value=String(url||'').toLowerCase();
        if(value.startsWith('../assets/covers/popular/'))return 0;
        if(value.includes('/store_item_assets/')&&/\/[a-f0-9]{24,}\//i.test(value))return 1;
        if(value.includes('library_600x900'))return 2;
        if(value.includes('header'))return 3;
        if(value.includes('capsule'))return 4;
        return 5;
      };
      return rank(left)-rank(right);
    });
  }

  function resolveReleasePayload(releasePayload,popularPayload){
    const popularBySlug=new Map();
    const popularByTitle=new Map();
    for(const item of popularPayload?.ranking||[]){
      if(item.slug)popularBySlug.set(item.slug,item);
      if(item.title)popularByTitle.set(canonical(item.title),item);
    }

    for(const game of releasePayload?.releases||[]){
      const popular=popularBySlug.get(game.slug)||popularByTitle.get(canonical(game.title));
      const popularCandidates=rankedPopularCandidates(popular);
      const candidates=unique([
        remembered[game.slug],
        ...popularCandidates,
        game.image?.local_url,
        ...steamFallbacks(game.external_ids?.steam),
        ...(game.image_candidates||[]),
        game.image?.source_url
      ]);

      if(candidates.length){
        candidatesBySlug.set(game.slug,candidates);
        game._cover_candidates=candidates;
        game.image=game.image||{};
        game.image.local_url=null;
        game.image.source_url=candidates[0];
        game.image.status='runtime_resolved';
      }
      games.set(game.slug,game);
    }
    return releasePayload;
  }

  function preload(url){
    return new Promise(resolve=>{
      if(!url){resolve(false);return}
      const image=new Image();
      let finished=false;
      const done=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)};
      const timer=setTimeout(()=>done(false),2200);
      image.onload=()=>done(image.naturalWidth>0);
      image.onerror=()=>done(false);
      image.decoding='async';
      image.src=url;
    });
  }

  async function primeCriticalCovers(payload){
    const rows=payload?.releases||[];
    const today=new Date();
    const dayStart=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
    const critical=rows.filter(game=>{
      const event=(game.events||[])[0]||{};
      const value=event.date||event.date_start;
      return value&&Date.parse(`${value}T00:00:00Z`)>=dayStart;
    }).slice(0,8);

    await Promise.race([
      Promise.allSettled(critical.map(async game=>{
        const candidates=candidatesBySlug.get(game.slug)||[];
        for(let index=0;index<Math.min(candidates.length,5);index++){
          if(await preload(candidates[index])){
            const winner=candidates[index];
            remember(game.slug,winner);
            const reordered=unique([winner,...candidates]);
            candidatesBySlug.set(game.slug,reordered);
            game._cover_candidates=reordered;
            game.image.source_url=winner;
            return;
          }
        }
      })),
      new Promise(resolve=>setTimeout(resolve,2600))
    ]);
  }

  const payloadPromise=Promise.all([
    nativeFetch(RELEASE_DATA,{cache:'force-cache'}).then(response=>{
      if(!response.ok)throw new Error(`Release data HTTP ${response.status}`);
      return response.json();
    }),
    nativeFetch(POPULAR_DATA,{cache:'force-cache'}).then(response=>response.ok?response.json():null).catch(()=>null)
  ]).then(async ([releasePayload,popularPayload])=>{
    const resolved=resolveReleasePayload(releasePayload,popularPayload);
    await primeCriticalCovers(resolved);
    return resolved;
  });

  window.fetch=(input,init={})=>{
    const url=typeof input==='string'?input:input?.url||'';
    const absoluteUrl=absolute(url);
    if(absoluteUrl===absolute(RELEASE_DATA)){
      return payloadPromise.then(payload=>new Response(JSON.stringify(payload),{
        status:200,
        headers:{'Content-Type':'application/json; charset=utf-8','X-Igro-Release-Build':BUILD}
      })).catch(()=>nativeFetch(input,{...init,cache:'default'}));
    }
    if(absoluteUrl===absolute(CHANGES_DATA))return nativeFetch(input,{...init,cache:'default'});
    return nativeFetch(input,init);
  };

  function mediaFor(image){return image?.closest(mediaSelector)}
  function slugFor(media){
    return media?.closest('[data-release]')?.dataset.release||
      media?.closest('#releaseModalContent')?.querySelector('[data-modal-bookmark]')?.dataset.modalBookmark||
      '';
  }
  function setCandidate(image,slug,candidates,index){
    if(index<0||index>=candidates.length)return false;
    image.dataset.coverIndex=String(index);
    image.hidden=false;
    image.loading='eager';
    image.decoding='async';
    const media=mediaFor(image);
    media?.classList.remove('is-broken');
    if(!same(image.getAttribute('src'),candidates[index]))image.src=candidates[index];
    return true;
  }

  window.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=mediaFor(image);
    const slug=slugFor(media);
    if(!media||!slug)return;

    event.stopPropagation();
    event.stopImmediatePropagation();
    const candidates=candidatesBySlug.get(slug)||games.get(slug)?._cover_candidates||[];
    const failed=image.getAttribute('src')||'';
    forget(slug,failed);
    let current=candidates.findIndex(candidate=>same(candidate,failed));
    if(current<0)current=Number(image.dataset.coverIndex??-1);
    if(!setCandidate(image,slug,candidates,current+1)){
      image.hidden=false;
      media.classList.add('is-broken');
    }
  },true);

  window.addEventListener('load',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=mediaFor(image);
    const slug=slugFor(media);
    if(!media||!slug)return;
    image.hidden=false;
    media.classList.remove('is-broken');
    remember(slug,image.getAttribute('src')||image.currentSrc);
  },true);

  function patchImages(root=document){
    root.querySelectorAll?.(`${mediaSelector} img`).forEach(image=>{
      const media=mediaFor(image);
      const slug=slugFor(media);
      if(!slug)return;
      const candidates=candidatesBySlug.get(slug)||[];
      image.loading='eager';
      image.decoding='async';
      image.hidden=false;
      if(!candidates.length)return;
      const current=image.getAttribute('src')||'';
      const preferred=remembered[slug]||candidates[0];
      image.dataset.coverIndex=String(Math.max(0,candidates.findIndex(candidate=>same(candidate,current))));
      if(preferred&&!same(current,preferred))image.src=preferred;
      if(image.complete&&image.naturalWidth===0){
        const index=candidates.findIndex(candidate=>same(candidate,image.getAttribute('src')));
        setCandidate(image,slug,candidates,index+1);
      }
    });
  }

  let queued=false;
  new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;patchImages(document)});
  }).observe(document.body,{childList:true,subtree:true});

  window.__IGRO_RELEASE_COVER_BUILD=BUILD;
})();
