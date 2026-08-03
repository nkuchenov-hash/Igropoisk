(()=>{
'use strict';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const setState=(target,title,text)=>{target.innerHTML=`<div class="popular-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`};

window.IgropoiskInfiniteRail=window.IgropoiskInfiniteRail||function makeInfiniteRail(target){
  if(!target)return;
  target._igInfiniteRailCleanup?.();
  const source=[...target.children];
  if(source.length<2)return;

  const count=source.length;
  const fragment=document.createDocumentFragment();
  for(let set=0;set<3;set+=1){
    source.forEach(node=>{
      const clone=node.cloneNode(true);
      clone.dataset.railSet=String(set);
      if(set!==1){
        clone.setAttribute('aria-hidden','true');
        clone.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(item=>item.setAttribute('tabindex','-1'));
      }
      fragment.appendChild(clone);
    });
  }
  target.replaceChildren(fragment);
  target.classList.add('infinite-rail');
  target.tabIndex=0;
  target.setAttribute('role','region');
  target.setAttribute('aria-label',target.id==='homeNews'?'Последние новости, горизонтальная лента':'Сейчас популярно, горизонтальная лента');

  let segmentWidth=0;
  let positioned=false;
  let recentering=false;
  let dragged=false;
  let pointerId=null;
  let startX=0;
  let startScroll=0;

  const measure=()=>{
    const first=target.children[0];
    const middle=target.children[count];
    if(!first||!middle)return;
    const nextWidth=middle.offsetLeft-first.offsetLeft;
    if(nextWidth<=0)return;
    const oldWidth=segmentWidth;
    segmentWidth=nextWidth;
    if(!positioned){
      target.scrollLeft=segmentWidth;
      positioned=true;
    }else if(oldWidth>0){
      const relative=(target.scrollLeft-oldWidth)/oldWidth;
      target.scrollLeft=segmentWidth+(relative*segmentWidth);
    }
  };

  const recenter=()=>{
    if(!positioned||!segmentWidth||recentering)return;
    const left=target.scrollLeft;
    if(left<segmentWidth*.45){
      recentering=true;
      target.scrollLeft=left+segmentWidth;
      recentering=false;
    }else if(left>segmentWidth*1.55){
      recentering=true;
      target.scrollLeft=left-segmentWidth;
      recentering=false;
    }
  };

  const onPointerDown=event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    pointerId=event.pointerId;
    dragged=false;
    startX=event.clientX;
    startScroll=target.scrollLeft;
    target.setPointerCapture(pointerId);
    target.classList.add('is-dragging');
  };
  const onPointerMove=event=>{
    if(pointerId!==event.pointerId)return;
    const delta=event.clientX-startX;
    if(Math.abs(delta)>4)dragged=true;
    target.scrollLeft=startScroll-delta;
  };
  const stopDrag=event=>{
    if(pointerId!==event.pointerId)return;
    target.releasePointerCapture?.(pointerId);
    pointerId=null;
    target.classList.remove('is-dragging');
  };
  const suppressDraggedClick=event=>{
    if(!dragged)return;
    event.preventDefault();
    event.stopPropagation();
    dragged=false;
  };
  const onKeyDown=event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    const direction=event.key==='ArrowRight'?1:-1;
    target.scrollBy({left:direction*Math.max(target.clientWidth*.72,260),behavior:'smooth'});
  };

  target.addEventListener('scroll',recenter,{passive:true});
  target.addEventListener('pointerdown',onPointerDown);
  target.addEventListener('pointermove',onPointerMove);
  target.addEventListener('pointerup',stopDrag);
  target.addEventListener('pointercancel',stopDrag);
  target.addEventListener('click',suppressDraggedClick,true);
  target.addEventListener('keydown',onKeyDown);

  const resizeObserver=new ResizeObserver(()=>requestAnimationFrame(measure));
  resizeObserver.observe(target);
  requestAnimationFrame(()=>requestAnimationFrame(measure));

  target._igInfiniteRailCleanup=()=>{
    resizeObserver.disconnect();
    target.removeEventListener('scroll',recenter);
    target.removeEventListener('pointerdown',onPointerDown);
    target.removeEventListener('pointermove',onPointerMove);
    target.removeEventListener('pointerup',stopDrag);
    target.removeEventListener('pointercancel',stopDrag);
    target.removeEventListener('click',suppressDraggedClick,true);
    target.removeEventListener('keydown',onKeyDown);
    target.classList.remove('infinite-rail','is-dragging');
    target.removeAttribute('role');
    target.removeAttribute('aria-label');
    target.removeAttribute('tabindex');
    delete target._igInfiniteRailCleanup;
  };
};

const qualityRank=url=>{
  const value=String(url||'').toLowerCase();
  if(value.includes('library_600x900_2x'))return 0;
  if(value.includes('library_600x900'))return 1;
  if(value.includes('cover')||value.includes('poster'))return 2;
  if(value.includes('capsule_imagev5'))return 3;
  if(value.includes('header'))return 5;
  if(value.includes('616x353'))return 6;
  if(value.includes('231x87')||value.includes('184x69'))return 9;
  return 4;
};
const candidatesFor=item=>{
  const appid=(item.evidence||[]).find(row=>Number(row.appid))?.appid;
  const steam=appid?[
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
  ]:[];
  return [...new Set([...(item.image_candidates||[]),item.image,...steam].filter(Boolean))]
    .sort((a,b)=>qualityRank(a)-qualityRank(b));
};
const wireImageFallbacks=target=>{
  target.querySelectorAll('img[data-cover-candidates]').forEach(img=>{
    let candidates=[];
    try{candidates=JSON.parse(img.dataset.coverCandidates||'[]')}catch{}
    let index=Math.max(0,candidates.indexOf(img.getAttribute('src')));
    img.addEventListener('error',()=>{
      index+=1;
      if(index<candidates.length){img.src=candidates[index];return}
      const placeholder=document.createElement('div');
      placeholder.className='popular-placeholder';
      placeholder.textContent=(img.alt||'?').slice(0,2).toUpperCase();
      img.closest('.popular-poster')?.replaceWith(placeholder);
    });
  });
};
async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  target._igInfiniteRailCleanup?.();
  setState(target,'Обновляем рейтинг','Получаем свежие данные из источников.');
  try{
    const stamp=Date.now();
    const [popularResponse,catalogResponse]=await Promise.all([
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'})
    ]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    if(!Array.isArray(data.ranking)||!data.ranking.length){
      setState(target,'Рейтинг временно недоступен','Парсер пока не набрал достаточно данных.');
      return;
    }
    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    target.innerHTML=data.ranking.slice(0,20).map((item,index)=>{
      const clickable=existing.has(item.slug);
      const candidates=candidatesFor(item);
      const media=candidates.length
        ?`<div class="popular-poster"><img src="${esc(candidates[0])}" data-cover-candidates='${esc(JSON.stringify(candidates))}' alt="${esc(item.title)}" loading="lazy" decoding="async"></div>`
        :`<div class="popular-placeholder">${esc(String(item.title||'?').slice(0,2).toUpperCase())}</div>`;
      const evidence=(item.families||[]).slice(0,3).map(value=>({steam_chart:'Steam',news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch',steam:'Steam',attention:'интерес'}[value]||value)).join(' · ');
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div>${media}<div class="card-body"><h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');
    window.IgropoiskInfiniteRail(target);
    wireImageFallbacks(target);
    const heading=target.closest('.section')?.querySelector('.section-head');
    if(heading&&!heading.querySelector('.popular-updated')){const note=document.createElement('span');note.className='section-note popular-updated';note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера';heading.appendChild(note)}
  }catch(error){
    console.warn('Игропоиск: popular parser output unavailable',error);
    setState(target,'Рейтинг временно недоступен','Не удалось получить свежие данные парсера.');
  }
}
load();

const shellScript=document.createElement('script');
shellScript.src=`assets/site-shell.js?v=20260803-1`;
shellScript.defer=true;
document.head.appendChild(shellScript);
})();
