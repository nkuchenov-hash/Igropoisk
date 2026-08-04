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
  let ready=false;
  let queued=false;

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

  const unique=values=>[...new Set((values||[]).map(normalizeAsset).filter(Boolean))];

  /* Same image quality order as «Сейчас популярно», without moving an unverified URL ahead of a verified release source. */
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
      game?.image?.verified?game?.image?.source_url:'',
      ...(game?.image_candidates||[])
    ]);
    const remaining=rankedUnique([
      game?.image?.verified?'':game?.image?.source_url,
      ...supplementalCandidates(game),
      ...(game?._runtime_image_candidates||[]),
      ...steamCandidates(game?.external_ids?.steam)
    ]).filter(url=>!trusted.includes(url));
    return [...trusted,...remaining];
  }

  async function enrichFromSteam(game){
    const appid=Number(game?.external_ids?.steam);
    if(!appid)return [];
    if(steamEnrichment.has(appid))return steamEnrichment.get(appid);
    const request=fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`,{cache:'no-store'})
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

  function ensureImage(media,game){
    let image=media.querySelector('img');
    if(!image){
      image=document.createElement('img');
      media.appendChild(image);
    }
    image.loading='eager';
    image.decoding='async';
    image.fetchPriority='high';
    image.referrerPolicy='no-referrer';
    image.alt=`Обложка ${game.title}`;
    image.hidden=false;
    return image;
  }

  function applyCandidates(media,game,{force=false}={}){
    const candidates=coverCandidates(game);
    if(!candidates.length)return;
    const signature=JSON.stringify(candidates);
    const image=ensureImage(media,game);
    if(!force&&media.dataset.coverGuaranteeSignature===signature&&image.getAttribute('src'))return;
    media.dataset.coverGuaranteeSignature=signature;
    media.dataset.coverCandidates=signature;
    media.dataset.releaseSlug=game.slug;
    media.dataset.coverEnriched='false';
    media.classList.remove('is-broken');
    image.dataset.coverIndex='0';
    image.hidden=false;
    if(image.getAttribute('src')!==candidates[0])image.src=candidates[0];
  }

  function markLoaded(image){
    const media=image.closest(mediaSelector);
    if(!media)return;
    media.classList.remove('is-broken');
    media.dataset.coverReady='true';
    image.hidden=false;
  }

  async function advanceCover(image,media){
    let candidates=[];
    try{candidates=JSON.parse(media.dataset.coverCandidates||'[]')}catch{}
    const current=Math.max(0,Number(image.dataset.coverIndex||0));
    const next=current+1;
    if(next<candidates.length){
      image.dataset.coverIndex=String(next);
      image.hidden=false;
      image.src=candidates[next];
      return;
    }

    const game=games.get(media.dataset.releaseSlug);
    if(game&&media.dataset.coverEnriched!=='true'){
      media.dataset.coverEnriched='true';
      const extra=await enrichFromSteam(game);
      const extended=unique([...candidates,...extra,...steamCandidates(game?.external_ids?.steam)]);
      const firstNew=extended.findIndex(url=>!candidates.includes(url));
      if(firstNew>=0){
        media.dataset.coverCandidates=JSON.stringify(extended);
        media.dataset.coverGuaranteeSignature=JSON.stringify(extended);
        image.dataset.coverIndex=String(firstNew);
        image.hidden=false;
        image.src=extended[firstNew];
        return;
      }
    }

    media.classList.add('is-broken');
    media.dataset.coverReady='false';
    image.hidden=true;
  }

  /* Capture before the old one-shot image handler so a failed first URL cannot permanently hide the image. */
  window.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=image.closest(mediaSelector);
    if(!media||!media.dataset.coverCandidates)return;
    event.stopPropagation();
    event.stopImmediatePropagation();
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

  const observer=new MutationObserver(queueDecorate);
  observer.observe(document.body,{childList:true,subtree:true});

  const readJSON=async url=>{
    try{
      const response=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});
      return response.ok?response.json():null;
    }catch{return null}
  };

  Promise.all([
    readJSON('../data/releases/current.json'),
    readJSON('../data/popular/current.json'),
    readJSON('../data/catalog-visible.json')
  ]).then(([releasePayload,popularPayload,catalogPayload])=>{
    (releasePayload?.releases||[]).forEach(game=>games.set(game.slug,game));
    (popularPayload?.ranking||[]).forEach(item=>{
      if(item.slug)popularBySlug.set(item.slug,item);
      if(item.title)popularByTitle.set(canonical(item.title),item);
    });
    (Array.isArray(catalogPayload)?catalogPayload:catalogPayload?.games||[]).forEach(item=>{
      if(item.slug)catalogBySlug.set(item.slug,item);
      if(item.title||item.name)catalogByTitle.set(canonical(item.title||item.name),item);
    });
    ready=true;
    decorate(document);
  }).catch(error=>console.warn('Release cover guarantee:',error));
})();
