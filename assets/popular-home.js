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
  const originals=[...target.children];
  if(originals.length!==REQUIRED_COUNT)return;
  const count=originals.length;
  const fragment=document.createDocumentFragment();
  for(let set=0;set<3;set+=1){
    originals.forEach(node=>{
      const clone=node.cloneNode(true);
      clone.dataset.railSet=String(set);
      if(set!==1){clone.setAttribute('aria-hidden','true');clone.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(el=>el.setAttribute('tabindex','-1'))}
      fragment.appendChild(clone);
    });
  }
  target.replaceChildren(fragment);
  target.classList.add('infinite-rail');
  target.tabIndex=0;
  target.setAttribute('role','region');
  target.setAttribute('aria-label','Сейчас популярно, бесконечная горизонтальная лента из 20 игр');

  let segmentWidth=0,itemStep=0,positioned=false,recentering=false,pointerId=null,dragged=false,startX=0,startScroll=0;
  const measure=()=>{
    const first=target.children[0],middle=target.children[count],next=target.children[count+1];
    if(!first||!middle)return;
    segmentWidth=middle.offsetLeft-first.offsetLeft;
    itemStep=next?next.offsetLeft-middle.offsetLeft:middle.getBoundingClientRect().width;
    if(segmentWidth>0&&!positioned){target.scrollLeft=segmentWidth;positioned=true}
  };
  const recenter=()=>{
    if(!positioned||!segmentWidth||recentering)return;
    const left=target.scrollLeft;
    if(left<segmentWidth*.5){recentering=true;target.scrollLeft=left+segmentWidth;recentering=false}
    else if(left>segmentWidth*1.5){recentering=true;target.scrollLeft=left-segmentWidth;recentering=false}
  };
  const step=direction=>{if(!itemStep)measure();if(itemStep>0)target.scrollBy({left:direction*itemStep,behavior:reducedMotion()?'auto':'smooth'})};
  const buttons=ensureControls(target);
  const buttonHandlers=buttons.map(button=>{const handler=()=>step(button.dataset.direction==='prev'?-1:1);button.addEventListener('click',handler);return[button,handler]});
  const down=event=>{if(event.pointerType!=='mouse'||event.button!==0)return;pointerId=event.pointerId;dragged=false;startX=event.clientX;startScroll=target.scrollLeft;target.setPointerCapture(pointerId);target.classList.add('is-dragging')};
  const move=event=>{if(event.pointerId!==pointerId)return;const delta=event.clientX-startX;if(Math.abs(delta)>4)dragged=true;target.scrollLeft=startScroll-delta};
  const up=event=>{if(event.pointerId!==pointerId)return;target.releasePointerCapture?.(pointerId);pointerId=null;target.classList.remove('is-dragging')};
  const click=event=>{if(!dragged)return;event.preventDefault();event.stopPropagation();dragged=false};
  const key=event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();step(event.key==='ArrowRight'?1:-1)};
  target.addEventListener('scroll',recenter,{passive:true});target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);target.addEventListener('click',click,true);target.addEventListener('keydown',key);
  const resizeObserver=new ResizeObserver(()=>requestAnimationFrame(measure));resizeObserver.observe(target);requestAnimationFrame(()=>requestAnimationFrame(measure));
  target._igInfiniteRailCleanup=()=>{resizeObserver.disconnect();buttonHandlers.forEach(([button,handler])=>button.removeEventListener('click',handler));target.removeEventListener('scroll',recenter);target.removeEventListener('pointerdown',down);target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);target.removeEventListener('click',click,true);target.removeEventListener('keydown',key);delete target._igInfiniteRailCleanup};
}
window.IgropoiskInfiniteRail=makeInfiniteRail;

async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  target._igInfiniteRailCleanup?.();
  setState(target,'Обновляем рейтинг','Загружаем полный набор из 20 игр.');
  try{
    const stamp=Date.now();
    const [popularResponse,catalogResponse]=await Promise.all([
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'})
    ]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    const ranking=Array.isArray(data.ranking)?data.ranking:[];
    const policy=data.cover_policy||{};
    const complete=ranking.length===REQUIRED_COUNT&&policy.required_count===REQUIRED_COUNT&&policy.verified_count===REQUIRED_COUNT&&policy.placeholders_allowed===false&&ranking.every(item=>item.cover_verified===true&&typeof item.image==='string'&&item.image.startsWith('assets/covers/popular/'));
    if(!complete)throw new Error('Incomplete popular package');

    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    target.innerHTML=ranking.map((item,index)=>{
      const clickable=existing.has(item.slug);
      const evidence=(item.families||[]).slice(0,3).map(value=>({steam_chart:'Steam',news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch'}[value]||value)).join(' · ');
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div><div class="popular-poster"><img src="${esc(item.image)}?v=${stamp}" alt="${esc(item.title)}" decoding="async"></div><div class="card-body"><h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');
    makeInfiniteRail(target);

    const heading=target.closest('.section')?.querySelector('.section-head');
    if(heading){let meta=heading.querySelector('.section-head__meta');if(!meta){meta=document.createElement('div');meta.className='section-head__meta';heading.appendChild(meta)}let note=meta.querySelector('.popular-updated');if(!note){note=document.createElement('span');note.className='section-note popular-updated';meta.prepend(note)}note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера'}
  }catch(error){console.warn('Игропоиск: rejected incomplete popular feed',error);setState(target,'Рейтинг обновляется','Публикация появится только после проверки 20 игр и 20 обложек.')}
}

load();
const shellScript=document.createElement('script');shellScript.src='assets/site-shell.js?v=20260803-1';shellScript.defer=true;document.head.appendChild(shellScript);
})();
