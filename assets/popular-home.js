(()=>{
'use strict';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const setState=(target,title,text)=>{target.innerHTML=`<div class="popular-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`};
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const MAXIMUM_COUNT=20;

function ensureControls(target){
  const heading=target.closest('.section')?.querySelector('.section-head');
  if(!heading)return [];
  let meta=heading.querySelector('.section-head__meta');
  if(!meta){meta=document.createElement('div');meta.className='section-head__meta';heading.appendChild(meta)}
  let controls=meta.querySelector(`[data-controls-for="${target.id}"]`);
  if(!controls){
    controls=document.createElement('div');
    controls.className='rail-controls';
    controls.dataset.controlsFor=target.id;
    controls.innerHTML='<button class="ig-icon-button rail-button" type="button" data-direction="prev" aria-label="Прокрутить влево">←</button><button class="ig-icon-button rail-button" type="button" data-direction="next" aria-label="Прокрутить вправо">→</button>';
    meta.appendChild(controls);
  }
  return [...controls.querySelectorAll('button')];
}

function attachStableRail(target){
  target._igStableRailCleanup?.();
  target.classList.add('stable-rail');
  target.tabIndex=0;
  target.setAttribute('role','region');
  target.setAttribute('aria-label',`Сейчас популярно: ${target.children.length} игр`);
  const buttons=ensureControls(target);
  const maxScroll=()=>Math.max(0,target.scrollWidth-target.clientWidth);
  const itemStep=()=>{
    const first=target.querySelector('.popular-card');
    if(!first)return Math.max(280,target.clientWidth*.75);
    const style=getComputedStyle(target);
    return first.getBoundingClientRect().width+(parseFloat(style.columnGap||style.gap)||16);
  };
  const updateControls=()=>{
    const max=maxScroll();
    const prev=buttons.find(button=>button.dataset.direction==='prev');
    const next=buttons.find(button=>button.dataset.direction==='next');
    if(prev)prev.disabled=target.scrollLeft<=2;
    if(next)next.disabled=target.scrollLeft>=max-2;
  };
  const scroll=direction=>{
    const next=Math.max(0,Math.min(maxScroll(),target.scrollLeft+direction*itemStep()));
    target.scrollTo({left:next,behavior:reducedMotion()?'auto':'smooth'});
  };
  const handlers=buttons.map(button=>{
    const handler=()=>{if(!button.disabled)scroll(button.dataset.direction==='prev'?-1:1)};
    button.addEventListener('click',handler);
    return[button,handler];
  });
  const key=event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    scroll(event.key==='ArrowRight'?1:-1);
  };
  target.addEventListener('keydown',key);
  target.addEventListener('scroll',updateControls,{passive:true});
  window.addEventListener('resize',updateControls,{passive:true});
  requestAnimationFrame(updateControls);
  target._igStableRailCleanup=()=>{
    handlers.forEach(([button,handler])=>button.removeEventListener('click',handler));
    target.removeEventListener('keydown',key);
    target.removeEventListener('scroll',updateControls);
    window.removeEventListener('resize',updateControls);
    target.classList.remove('stable-rail');
    target.removeAttribute('tabindex');
    target.removeAttribute('role');
    target.removeAttribute('aria-label');
    delete target._igStableRailCleanup;
  };
}
window.IgropoiskInfiniteRail=attachStableRail;

const candidateRank=url=>{
  const value=String(url||'').toLowerCase();
  if(value.startsWith('assets/covers/popular/'))return 0;
  if(value.includes('library_600x900_2x'))return 1;
  if(value.includes('library_600x900'))return 2;
  if(value.includes('cover')||value.includes('poster'))return 3;
  if(value.includes('header'))return 4;
  return 5;
};

const coverCandidates=item=>{
  const appid=item.identity?.steam_appid||item.steam_appid||item.appid||(item.evidence||[]).find(row=>Number(row.appid))?.appid;
  const steam=appid?[
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
  ]:[];
  return [...new Set([item.image,...(item.image_candidates||[]),...steam].filter(Boolean))].sort((a,b)=>candidateRank(a)-candidateRank(b));
};

function initials(title){
  const parts=String(title||'?').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0,2).map(part=>part[0]).join('')||'?').toUpperCase();
}

function wireCoverFallbacks(target){
  target.querySelectorAll('img[data-cover-candidates]').forEach(img=>{
    let candidates=[];
    try{candidates=JSON.parse(img.dataset.coverCandidates||'[]')}catch{}
    let index=0;
    img.addEventListener('error',()=>{
      index+=1;
      if(index<candidates.length){img.src=candidates[index];return}
      const placeholder=document.createElement('div');
      placeholder.className='popular-placeholder';
      placeholder.setAttribute('role','img');
      placeholder.setAttribute('aria-label',img.alt||'Обложка временно недоступна');
      placeholder.textContent=initials(img.alt);
      img.replaceWith(placeholder);
    });
  });
}

async function hydrateMissingCovers(target,ranking){
  const rows=[...target.querySelectorAll('[data-cover-missing]')];
  await Promise.all(rows.map(async node=>{
    const item=ranking[Number(node.dataset.coverMissing)];
    if(!item)return;
    try{
      const [draftResponse,mediaResponse]=await Promise.all([
        fetch(`data/drafts/${encodeURIComponent(item.slug)}.json`,{cache:'no-store'}),
        fetch(`data/article-media/${encodeURIComponent(item.slug)}.json`,{cache:'no-store'})
      ]);
      const draft=draftResponse.ok?await draftResponse.json():null;
      const media=mediaResponse.ok?await mediaResponse.json():null;
      const candidate=draft?.media?.cover||media?.cover?.url||media?.hero?.url||draft?.media?.hero||'';
      if(!candidate)return;
      const img=document.createElement('img');
      img.src=candidate;img.alt=item.title;img.loading='lazy';img.decoding='async';img.width=600;img.height=900;
      img.addEventListener('error',()=>{}, {once:true});
      node.replaceWith(img);
    }catch{}
  }));
}

function updateFreshness(target,generatedAt){
  const heading=target.closest('.section')?.querySelector('.section-head');
  if(!heading)return;
  let meta=heading.querySelector('.section-head__meta');
  if(!meta){meta=document.createElement('div');meta.className='section-head__meta';heading.appendChild(meta)}
  let note=meta.querySelector('.popular-updated');
  if(!note){note=document.createElement('span');note.className='section-note popular-updated';meta.prepend(note)}
  const timestamp=Date.parse(generatedAt||'');
  if(!Number.isFinite(timestamp)){note.textContent='Данные рейтинга';return}
  const ageHours=(Date.now()-timestamp)/3_600_000;
  if(ageHours>36){note.textContent='Обновляем рейтинг';note.dataset.stale='true'}
  else{note.textContent=`Обновлено ${new Date(timestamp).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;delete note.dataset.stale}
}

async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  target._igStableRailCleanup?.();
  setState(target,'Обновляем рейтинг','Загружаем актуальный топ игр.');
  try{
    const stamp=Date.now();
    const [popularResponse,catalogResponse]=await Promise.all([
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'})
    ]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    const ranking=Array.isArray(data.ranking)?data.ranking.slice(0,MAXIMUM_COUNT):[];
    if(!ranking.length)throw new Error('Popularity ranking is empty');
    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));

    target.innerHTML=ranking.map((item,index)=>{
      const clickable=existing.has(item.slug);
      const candidates=coverCandidates(item);
      const src=candidates[0]||'';
      const poster=src
        ? `<img src="${esc(src)}" data-cover-candidates='${esc(JSON.stringify(candidates))}' alt="${esc(item.title)}" loading="${index<6?'eager':'lazy'}" fetchpriority="${index<3?'high':'auto'}" decoding="async" width="600" height="900">`
        : `<div class="popular-placeholder" data-cover-missing="${index}" role="img" aria-label="Ищем обложку">${esc(initials(item.title))}</div>`;
      return `<article class="ig-card ig-card--interactive popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div><div class="ig-card__media popular-poster">${poster}</div><div class="ig-card__body card-body"><h3 class="ig-card__title">${esc(item.title)}</h3><div class="ig-card__meta popular-meta"><span>Индекс ${esc(Number(item.score||0).toFixed(1))}</span></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');

    wireCoverFallbacks(target);
    await hydrateMissingCovers(target,ranking);
    attachStableRail(target);
    updateFreshness(target,data.generated_at);
  }catch(error){
    console.warn('Игропоиск: popular feed unavailable',error);
    setState(target,'Рейтинг временно недоступен','Не удалось загрузить опубликованный рейтинг.');
  }
}

load();
})();
