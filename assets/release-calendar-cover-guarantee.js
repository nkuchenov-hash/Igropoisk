(()=>{
  'use strict';

  const view=document.querySelector('#releaseView');
  if(!view)return;

  const games=new Map();
  const popularBySlug=new Map();
  const popularByTitle=new Map();
  const catalogBySlug=new Map();
  const catalogByTitle=new Map();
  const steamEnrichment=new Map();
  const coverCacheKey='igroReleaseCoverChoiceV1';
  let ready=false;
  let queued=false;
  let coverChoice={};

  try{coverChoice=JSON.parse(localStorage.getItem(coverCacheKey)||'{}')||{}}catch{coverChoice={}}

  const clean=value=>String(value||'').trim();
  const canonical=value=>clean(value).normalize('NFKD').toLowerCase()
    .replace(/&amp;/g,' and ')
    .replace(/[^a-z0-9а-яё]+/gi,' ')
    .replace(/\s+/g,' ')
    .trim();

  const normalizeAsset=value=>{
    const url=clean(value);
    if(!url)return '';
    if(/^https?:\/\//i.test(url)||url.startsWith('data:')||url.startsWith('blob:'))return url;
    if(url.startsWith('../'))return url;
    if(url.startsWith('/'))return `..${url}`;
    return url.startsWith('assets/')?`../${url}`:url;
  };

  const absolute=value=>{
    try{return new URL(value,document.baseURI).href}catch{return clean(value)}
  };
  const sameUrl=(left,right)=>Boolean(left&&right&&absolute(left)===absolute(right));
  const unique=values=>[...new Set((values||[]).map(normalizeAsset).filter(Boolean))];

  function saveCoverChoice(){
    try{
      const entries=Object.entries(coverChoice).slice(-120);
      coverChoice=Object.fromEntries(entries);
      localStorage.setItem(coverCacheKey,JSON.stringify(coverChoice));
    }catch{}
  }

  function rememberCover(slug,url){
    const value=normalizeAsset(url);
    if(!slug||!value||coverChoice[slug]===value)return;
    delete coverChoice[slug];
    coverChoice[slug]=value;
    saveCoverChoice();
  }

  function forgetCover(slug,url){
    if(!slug||!coverChoice[slug]||!sameUrl(coverChoice[slug],url))return;
    delete coverChoice[slug];
    saveCoverChoice();
  }

  const candidateRank=url=>{
    const value=String(url||'').toLowerCase();
    if(value.startsWith('../assets/covers/popular/')||value.startsWith('../assets/covers/releases/'))return 0;
    if(value.includes('library_600x900_2x'))return 1;
    if(value.includes('library_600x900'))return 2;
    if(value.includes('cover')||value.includes('poster'))return 3;
    if(value.includes('header'))return 4;
    if(value.includes('616x353'))return 5;
    if(value.includes('capsule'))return 6;
    if(value.includes('background')||value.includes('screenshot'))return 7;
    return 8;
  };

  const rankedUnique=values=>unique(values).sort((a,b)=>candidateRank(a)-candidateRank(b));

  function steamCandidates(appid){
    if(!Number(appid))return [];
    const id=Number(appid);
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

  function supplementalCandidates(game){
    const key=canonical(game?.title);
    const popular=popularBySlug.get(game.slug)||popularByTitle.get(key)||{};
    const catalog=catalogBySlug.get(game.slug)||catalogByTitle.get(key)||{};
    return rankedUnique([
      popular.image,
      ...(popular.image_candidates||[]),
      catalog.cover,
      catalog.poster,
      catalog.image,
      catalog.hero,
      catalog.media?.cover,
      catalog.media?.poster,
      catalog.media?.hero
    ]);
  }

  function coverCandidates(game){
    const trusted=unique([
      game?.image?.local_url,
      coverChoice[game?.slug],
      game?.image?.verified?game?.image?.source_url:'',
      ...(game?.image_candidates||[])
    ]);
    const remaining=rankedUnique([
      game?.image?.verified?'':game?.image?.source_url,
      ...supplementalCandidates(game),
      ...(game?._runtime_image_candidates||[]),
      ...steamCandidates(game?.external_ids?.steam)
    ]).filter(url=>!trusted.some(item=>sameUrl(item,url)));
    return [...trusted,...remaining];
  }

  async function enrichFromSteam(game){
    const appid=Number(game?.external_ids?.steam);
    if(!appid)return [];
    if(steamEnrichment.has(appid))return steamEnrichment.get(appid);
    const request=fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`,{cache:'default'})
      .then(response=>response.ok?response.json():null)
      .then(payload=>{
        const data=payload?.[appid]?.data||{};
        const extra=rankedUnique([
          data.capsule_imagev5,
          data.header_image,
          data.background,
          data.background_raw,
          ...(data.screenshots||[]).slice(0,5).flatMap(row=>[row.path_full,row.path_thumbnail])
        ]);
        game._runtime_image_candidates=unique([...(game._runtime_image_candidates||[]),...extra]);
        return extra;
      })
      .catch(()=>[]);
    steamEnrichment.set(appid,request);
    return request;
  }

  const mediaSelector=[
    '.release-calendar-item__media',
    '.release-list-item__media',
    '.release-upcoming-item__media',
    '.release-feed-card__image',
    '.release-detail-cover'
  ].join(',');

  const ownerFor=media=>media?.closest('[data-release]');
  const slugFor=media=>media?.dataset.releaseSlug||ownerFor(media)?.dataset.release||'';

  function ensureImage(media,game){
    let image=media.querySelector('img');
    if(!image){
      image=document.createElement('img');
      image.loading=media.matches('.release-calendar-item__media')?'lazy':'eager';
      image.decoding='async';
      media.appendChild(image);
    }
    image.alt=`Обложка ${game.title}`;
    image.hidden=false;
    return image;
  }

  function markLoaded(image){
    const media=image.closest(mediaSelector);
    if(!media)return;
    const slug=slugFor(media);
    media.classList.remove('is-broken');
    media.dataset.coverReady='true';
    image.hidden=false;
    rememberCover(slug,image.getAttribute('src')||image.currentSrc);
  }

  function setCandidate(image,media,candidates,index){
    if(index<0||index>=candidates.length)return false;
    media.dataset.coverCandidates=JSON.stringify(candidates);
    image.dataset.coverIndex=String(index);
    image.hidden=false;
    if(!sameUrl(image.getAttribute('src'),candidates[index]))image.src=candidates[index];
    return true;
  }

  function applyCandidates(media,game){
    const candidates=coverCandidates(game);
    if(!candidates.length)return;

    const image=ensureImage(media,game);
    const current=image.getAttribute('src')||'';
    const currentIndex=candidates.findIndex(candidate=>sameUrl(candidate,current));

    media.dataset.coverGuaranteeSignature=JSON.stringify(candidates);
    media.dataset.coverCandidates=JSON.stringify(candidates);
    media.dataset.releaseSlug=game.slug;
    media.classList.remove('is-broken');

    if(image.complete&&image.naturalWidth>0){
      image.dataset.coverIndex=String(currentIndex>=0?currentIndex:0);
      markLoaded(image);
      return;
    }

    if(current&&!image.complete){
      image.dataset.coverIndex=String(currentIndex>=0?currentIndex:0);
      image.hidden=false;
      return;
    }

    if(current&&image.complete&&image.naturalWidth===0){
      forgetCover(game.slug,current);
      const next=currentIndex>=0?currentIndex+1:0;
      if(setCandidate(image,media,candidates,next))return;
      void advanceCover(image,media);
      return;
    }

    setCandidate(image,media,candidates,0);
  }

  async function advanceCover(image,media){
    let candidates=[];
    try{candidates=JSON.parse(media.dataset.coverCandidates||'[]')}catch{}

    const slug=slugFor(media);
    const failed=image.getAttribute('src')||'';
    forgetCover(slug,failed);

    const current=Math.max(-1,Number(image.dataset.coverIndex??-1));
    const next=current+1;
    if(setCandidate(image,media,candidates,next))return;

    const game=games.get(slug);
    if(game&&media.dataset.coverEnriched!=='true'){
      media.dataset.coverEnriched='true';
      const extra=await enrichFromSteam(game);
      const extended=unique([...candidates,...extra,...steamCandidates(game?.external_ids?.steam)]);
      const firstNew=extended.findIndex(url=>!candidates.some(existing=>sameUrl(existing,url)));
      if(firstNew>=0){
        media.dataset.coverGuaranteeSignature=JSON.stringify(extended);
        setCandidate(image,media,extended,firstNew);
        return;
      }
    }

    media.classList.add('is-broken');
    media.dataset.coverReady='false';
    image.hidden=true;
  }

  /* Registered before the renderer: the old one-shot handler never gets to hide a recoverable image. */
  window.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=image.closest(mediaSelector);
    if(!media||!ownerFor(media))return;

    event.stopPropagation();
    event.stopImmediatePropagation();
    image.hidden=false;

    if(!ready){
      image.dataset.coverPending='true';
      return;
    }

    if(!media.dataset.coverCandidates){
      const game=games.get(slugFor(media));
      if(game)applyCandidates(media,game);
      return;
    }

    void advanceCover(image,media);
  },true);

  window.addEventListener('load',event=>{
    const image=event.target;
    if(image instanceof HTMLImageElement&&image.closest(mediaSelector))markLoaded(image);
  },true);

  function decorateCard(card,game){
    card.querySelectorAll(mediaSelector).forEach(media=>applyCandidates(media,game));
  }

  function decorate(root=document){
    if(!ready)return;
    root.querySelectorAll?.('[data-release]').forEach(card=>{
      const game=games.get(card.dataset.release);
      if(game)decorateCard(card,game);
    });
  }

  function queueDecorate(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      decorate(document);
    });
  }

  new MutationObserver(queueDecorate).observe(document.body,{childList:true,subtree:true});

  const readJSON=async url=>{
    try{
      const response=await fetch(url,{cache:'default'});
      return response.ok?response.json():null;
    }catch{return null}
  };

  const extrasPromise=Promise.all([
    readJSON('../data/popular/current.json'),
    readJSON('../data/catalog-visible.json')
  ]).then(([popularPayload,catalogPayload])=>{
    (popularPayload?.ranking||[]).forEach(item=>{
      if(item.slug)popularBySlug.set(item.slug,item);
      if(item.title)popularByTitle.set(canonical(item.title),item);
    });
    (Array.isArray(catalogPayload)?catalogPayload:catalogPayload?.games||[]).forEach(item=>{
      if(item.slug)catalogBySlug.set(item.slug,item);
      if(item.title||item.name)catalogByTitle.set(canonical(item.title||item.name),item);
    });
  });

  readJSON('../data/releases/current.json').then(releasePayload=>{
    (releasePayload?.releases||[]).forEach(game=>games.set(game.slug,game));
    ready=true;
    decorate(document);
    return extrasPromise;
  }).then(()=>decorate(document)).catch(error=>console.warn('Release cover guarantee:',error));
})();
