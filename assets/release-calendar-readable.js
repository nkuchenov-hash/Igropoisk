(()=>{
  'use strict';

  const view=document.querySelector('#releaseView');
  if(!view)return;

  const games=new Map();
  let ready=false;
  let queued=false;

  const clean=value=>String(value||'')
    .replace(/<[^>]*>/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/\s+/g,' ')
    .trim();

  function primaryEvent(game){
    return (game?.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
  }

  function descriptionFor(game){
    const supplied=clean(game?.short_description||game?.description||game?.editorial?.short_description);
    if(supplied)return supplied;
    const genres=(game?.genres||[]).filter(Boolean).slice(0,2).join(' / ');
    const developer=clean(game?.developer);
    const platforms=(primaryEvent(game).platforms||[]).filter(Boolean).slice(0,3).join(', ');
    const parts=[];
    parts.push(genres||'Новая игра');
    if(developer)parts.push(`от ${developer}`);
    if(platforms)parts.push(`для ${platforms}`);
    return `${parts.join(' ')}.`;
  }

  function normalizeLocalCover(value){
    const url=clean(value);
    if(!url)return '';
    return url.startsWith('assets/')?`../${url}`:url;
  }

  function coverCandidates(game){
    const steam=game?.external_ids?.steam;
    return [...new Set([
      normalizeLocalCover(game?.image?.local_url),
      clean(game?.image?.source_url),
      steam?`https://cdn.cloudflare.steamstatic.com/steam/apps/${steam}/library_600x900.jpg`:'',
      steam?`https://cdn.akamai.steamstatic.com/steam/apps/${steam}/library_600x900.jpg`:'',
      steam?`https://cdn.cloudflare.steamstatic.com/steam/apps/${steam}/header.jpg`:'',
      steam?`https://cdn.cloudflare.steamstatic.com/steam/apps/${steam}/capsule_616x353.jpg`:''
    ].filter(Boolean))];
  }

  function requiredCover(game){
    const candidates=coverCandidates(game);
    return candidates[0]||'';
  }

  function attachRequiredCover(media,game){
    if(!media)return;
    const candidates=coverCandidates(game);
    media.dataset.coverCandidates=JSON.stringify(candidates);
    media.classList.remove('is-broken');
    let image=media.querySelector('img');
    if(!image){
      image=document.createElement('img');
      image.loading='lazy';
      image.decoding='async';
      media.appendChild(image);
    }
    image.hidden=false;
    image.alt=`Обложка ${game.title}`;
    image.dataset.coverIndex='0';
    if(!image.getAttribute('src')&&candidates[0])image.src=candidates[0];
  }

  document.addEventListener('error',event=>{
    const image=event.target;
    if(!(image instanceof HTMLImageElement))return;
    const media=image.closest('.release-calendar-item__media');
    if(!media)return;
    event.stopImmediatePropagation();
    const candidates=JSON.parse(media.dataset.coverCandidates||'[]');
    const current=Math.max(0,Number(image.dataset.coverIndex||0));
    const next=current+1;
    if(next<candidates.length){
      image.dataset.coverIndex=String(next);
      image.hidden=false;
      image.src=candidates[next];
      return;
    }
    image.hidden=false;
    media.classList.add('is-broken');
  },true);

  function decorateCalendarCard(card,game){
    const media=card.querySelector('.release-calendar-item__media');
    attachRequiredCover(media,game);
    const content=card.children[1];
    if(!content)return;
    let description=content.querySelector('.release-calendar-item__description');
    if(!description){
      description=document.createElement('p');
      description.className='release-calendar-item__description';
      const platformLine=[...content.children].find(node=>node.tagName==='SPAN');
      content.insertBefore(description,platformLine||null);
    }
    const text=descriptionFor(game);
    if(description.textContent!==text)description.textContent=text;
    const title=`${game.title}: ${text}`;
    if(card.title!==title)card.title=title;
    if(!requiredCover(game))card.dataset.coverMissing='true';
    else delete card.dataset.coverMissing;
  }

  function decorateFeedCard(card,game){
    const description=card.querySelector('.release-feed-card__body>p');
    if(!description)return;
    const text=descriptionFor(game);
    if(description.textContent!==text)description.textContent=text;
  }

  function decorate(root=document){
    if(!ready)return;
    root.querySelectorAll?.('.release-calendar-item[data-release]').forEach(card=>{
      const game=games.get(card.dataset.release);
      if(game)decorateCalendarCard(card,game);
    });
    root.querySelectorAll?.('.release-feed-card[data-release]').forEach(card=>{
      const game=games.get(card.dataset.release);
      if(game)decorateFeedCard(card,game);
    });
  }

  function queueDecorate(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      decorate(view);
    });
  }

  new MutationObserver(queueDecorate).observe(view,{childList:true,subtree:true});

  fetch('../data/releases/current.json',{cache:'no-store'})
    .then(response=>{
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(payload=>{
      (payload.releases||[]).forEach(game=>games.set(game.slug,game));
      ready=true;
      decorate(view);
    })
    .catch(error=>console.warn('Release descriptions:',error));
})();
