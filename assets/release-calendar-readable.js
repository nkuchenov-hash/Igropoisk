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

  function decorateCalendarCard(card,game){
    const content=card.children[1];
    if(!content)return;
    let description=content.querySelector('.release-calendar-item__description');
    if(!description){
      description=document.createElement('p');
      description.className='release-calendar-item__description';
      const platformLine=[...content.children].find(node=>node.tagName==='SPAN');
      content.insertBefore(description,platformLine||null);
    }
    description.textContent=descriptionFor(game);
    card.title=`${game.title}: ${description.textContent}`;
  }

  function decorateFeedCard(card,game){
    const description=card.querySelector('.release-feed-card__body>p');
    if(description)description.textContent=descriptionFor(game);
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
