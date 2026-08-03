(()=>{
'use strict';

const REQUIRED_COUNT=20;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const setState=(target,title,text)=>{target.innerHTML=`<div class="popular-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`};
const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const ensureControls=target=>{
  const heading=target.closest('.section')?.querySelector('.section-head');
  if(!heading)return [];
  let meta=heading.querySelector('.section-head__meta');
  if(!meta){meta=document.createElement('div');meta.className='section-head__meta';heading.appendChild(meta)}
  let controls=meta.querySelector(`[data-controls-for="${target.id}"]`);
  if(!controls){
    controls=document.createElement('div');
    controls.className='rail-controls';
    controls.dataset.controlsFor=target.id;
    controls.innerHTML='<button class="rail-button" type="button" data-direction="prev" aria-label="Прокрутить влево">←</button><button class="rail-button" type="button" data-direction="next" aria-label="Прокрутить вправо">→</button>';
    meta.appendChild(controls);
  }
  return [...controls.querySelectorAll('button')];
};

function makeInfiniteRail(target){
  target._igInfiniteRailCleanup?.();
  if(target.children.length<2)return;

  target.classList.add('infinite-rail');
  target.tabIndex=0;
  target.setAttribute('role','region');
  target.setAttribute('aria-label',`Сейчас популярно, бесконечная горизонтальная лента из ${target.children.length} игр`);

  let itemStep=0,positioned=false,adjusting=false,pointerId=null,dragged=false,startX=0,startScroll=0,measureFrame=0,scrollFrame=0;

  const measure=()=>{
    measureFrame=0;
    const first=target.children[0];
    const next=target.children[1];
    if(!first)return;
    const measured=next?next.offsetLeft-first.offsetLeft:first.getBoundingClientRect().width;
    if(measured>0)itemStep=measured;
    if(itemStep>0&&!positioned){
      const last=target.lastElementChild;
      if(last)target.prepend(last);
      target.scrollLeft=itemStep;
      positioned=true;
    }
  };

  const scheduleMeasure=()=>{
    if(measureFrame)return;
    measureFrame=requestAnimationFrame(measure);
  };

  const normalize=()=>{
    scrollFrame=0;
    if(!positioned||!itemStep||adjusting)return;
    const maxScroll=target.scrollWidth-target.clientWidth;
    if(maxScroll<=itemStep)return;
    if(target.scrollLeft<=itemStep*.35){
      adjusting=true;
      const last=target.lastElementChild;
      if(last){
        target.prepend(last);
        target.scrollLeft+=itemStep;
      }
      adjusting=false;
    }else if(target.scrollLeft>=maxScroll-itemStep*.35){
      adjusting=true;
      const first=target.firstElementChild;
      if(first){
        target.append(first);
        target.scrollLeft-=itemStep;
      }
      adjusting=false;
    }
  };

  const onScroll=()=>{
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(normalize);
  };

  const step=direction=>{
    if(!itemStep)measure();
    if(itemStep>0)target.scrollBy({left:direction*itemStep,behavior:reducedMotion()?'auto':'smooth'});
  };

  const buttons=ensureControls(target);
  const buttonHandlers=buttons.map(button=>{
    const handler=()=>step(button.dataset.direction==='prev'?-1:1);
    button.addEventListener('click',handler);
    return[button,handler];
  });

  const down=event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    pointerId=event.pointerId;
    dragged=false;
    startX=event.clientX;
    startScroll=target.scrollLeft;
    target.setPointerCapture(pointerId);
    target.classList.add('is-dragging');
  };
  const move=event=>{
    if(event.pointerId!==pointerId)return;
    const delta=event.clientX-startX;
    if(Math.abs(delta)>4)dragged=true;
    target.scrollLeft=startScroll-delta;
  };
  const up=event=>{
    if(event.pointerId!==pointerId)return;
    target.releasePointerCapture?.(pointerId);
    pointerId=null;
    target.classList.remove('is-dragging');
  };
  const click=event=>{
    if(!dragged)return;
    event.preventDefault();
    event.stopPropagation();
    dragged=false;
  };
  const key=event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    step(event.key==='ArrowRight'?1:-1);
  };

  target.addEventListener('scroll',onScroll,{passive:true});
  target.addEventListener('pointerdown',down);
  target.addEventListener('pointermove',move);
  target.addEventListener('pointerup',up);
  target.addEventListener('pointercancel',up);
  target.addEventListener('click',click,true);
  target.addEventListener('keydown',key);

  const resizeObserver=new ResizeObserver(scheduleMeasure);
  resizeObserver.observe(target);
  requestAnimationFrame(()=>requestAnimationFrame(measure));

  target._igInfiniteRailCleanup=()=>{
    resizeObserver.disconnect();
    if(measureFrame)cancelAnimationFrame(measureFrame);
    if(scrollFrame)cancelAnimationFrame(scrollFrame);
    buttonHandlers.forEach(([button,handler])=>button.removeEventListener('click',handler));
    target.removeEventListener('scroll',onScroll);
    target.removeEventListener('pointerdown',down);
    target.removeEventListener('pointermove',move);
    target.removeEventListener('pointerup',up);
    target.removeEventListener('pointercancel',up);
    target.removeEventListener('click',click,true);
    target.removeEventListener('keydown',key);
    target.classList.remove('infinite-rail','is-dragging');
    target.removeAttribute('role');
    target.removeAttribute('aria-label');
    target.removeAttribute('tabindex');
    delete target._igInfiniteRailCleanup;
  };
}
window.IgropoiskInfiniteRail=makeInfiniteRail;

const candidateRank=url=>{
  const value=String(url||'').toLowerCase();
  if(value.startsWith('assets/covers/popular/'))return 0;
  if(value.includes('library_600x900_2x'))return 1;
  if(value.includes('library_600x900'))return 2;
  if(value.includes('cover')||value.includes('poster'))return 3;
  if(value.includes('header'))return 4;
  if(value.includes('616x353'))return 5;
  if(value.includes('capsule'))return 6;
  return 7;
};

const coverCandidates=item=>{
  const appid=(item.evidence||[]).find(row=>Number(row.appid))?.appid;
  const steam=appid?[
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
  ]:[];
  return [...new Set([item.image,...(item.image_candidates||[]),...steam].filter(Boolean))].sort((a,b)=>candidateRank(a)-candidateRank(b));
};

const wireCoverFallbacks=target=>{
  target.querySelectorAll('img[data-cover-candidates]').forEach(img=>{
    let candidates=[];
    try{candidates=JSON.parse(img.dataset.coverCandidates||'[]')}catch{}
    let index=0;
    img.addEventListener('error',()=>{
      index+=1;
      if(index<candidates.length)img.src=candidates[index];
    });
  });
};

async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  target._igInfiniteRailCleanup?.();
  setState(target,'Обновляем рейтинг','Загружаем актуальный топ игр.');
  try{
    const stamp=Date.now();
    const [popularResponse,catalogResponse]=await Promise.all([
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'})
    ]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    const ranking=Array.isArray(data.ranking)?data.ranking.slice(0,REQUIRED_COUNT):[];
    if(ranking.length<REQUIRED_COUNT)throw new Error(`Expected ${REQUIRED_COUNT} games, received ${ranking.length}`);

    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    target.innerHTML=ranking.map((item,index)=>{
      const clickable=existing.has(item.slug);
      const candidates=coverCandidates(item);
      const src=candidates[0]||item.image||'';
      const evidence=(item.families||[]).slice(0,3).map(value=>({steam_chart:'Steam',news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch'}[value]||value)).join(' · ');
      const width=Number(item.cover_width)||600;
      const height=Number(item.cover_height)||900;
      const loading=index<6?'eager':'lazy';
      const priority=index<3?'high':'auto';
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div><div class="popular-poster"><img src="${esc(src)}" data-cover-candidates='${esc(JSON.stringify(candidates))}' alt="${esc(item.title)}" loading="${loading}" fetchpriority="${priority}" decoding="async" width="${width}" height="${height}"></div><div class="card-body"><h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');

    wireCoverFallbacks(target);
    makeInfiniteRail(target);

    const heading=target.closest('.section')?.querySelector('.section-head');
    if(heading){let meta=heading.querySelector('.section-head__meta');if(!meta){meta=document.createElement('div');meta.className='section-head__meta';heading.appendChild(meta)}let note=meta.querySelector('.popular-updated');if(!note){note=document.createElement('span');note.className='section-note popular-updated';meta.prepend(note)}note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера'}
  }catch(error){console.warn('Игропоиск: popular feed unavailable',error);setState(target,'Рейтинг временно недоступен','Не удалось загрузить опубликованный топ-20.')}
}

load();
const shellScript=document.createElement('script');shellScript.src='assets/site-shell.js?v=20260803-1';shellScript.defer=true;document.head.appendChild(shellScript);
})();
