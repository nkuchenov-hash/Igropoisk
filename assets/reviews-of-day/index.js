(()=>{
'use strict';
const main=document.querySelector('#reviewsOfDayMain');
const rail=document.querySelector('#reviewsOfDayRail');
if(!main||!rail)return;

const AUTO_ROTATE_MS=30000;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let items=[];
let activeIndex=0;
let timer=null;

const mainCard=item=>`<a class="review-day-card" href="article/${encodeURIComponent(item.slug)}/"><div class="review-day-card__copy"><span class="review-day-card__eyebrow">${esc(item.game_title||'Обзор Игропоиска')}</span><h3>${esc(item.title)}</h3><p class="review-day-card__dek">${esc(item.dek||'')}</p><div class="review-day-card__meta"><span>${esc(item.author||'Редакция Игропоиска')}</span><span>${esc(item.published_at||'')}</span></div></div><div class="review-day-card__media"><img src="${esc(item.hero||'')}" alt="${esc(item.game_title||item.title)}" loading="eager" decoding="async"></div>${Number.isFinite(Number(item.score))?`<span class="review-day-card__score">${Number(item.score).toFixed(1)}</span>`:''}</a>`;
const miniCard=(item,index)=>`<button class="review-day-mini${index===activeIndex?' is-active':''}" type="button" data-review-index="${index}" aria-label="Показать обзор ${esc(item.game_title||item.title)}"><img src="${esc(item.hero||'')}" alt="" loading="lazy" decoding="async"><span>${esc(item.game_title||item.title)}</span></button>`;

function render(){
  const item=items[activeIndex];
  if(!item)return;
  main.innerHTML=mainCard(item);
  rail.innerHTML=items.map(miniCard).join('');
  main.querySelector('img')?.addEventListener('error',event=>event.currentTarget.closest('.review-day-card__media')?.classList.add('is-broken'),{once:true});
  rail.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  rail.querySelectorAll('[data-review-index]').forEach(button=>button.addEventListener('click',()=>{
    activeIndex=Number(button.dataset.reviewIndex)||0;
    render();
    restartTimer();
  }));
  rail.querySelector('.is-active')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
}

function restartTimer(){
  if(timer)clearInterval(timer);
  if(items.length<2||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  timer=setInterval(()=>{activeIndex=(activeIndex+1)%items.length;render()},AUTO_ROTATE_MS);
}

document.querySelectorAll('[data-review-rail]').forEach(button=>{
  button.addEventListener('click',()=>rail.scrollBy({left:Number(button.dataset.reviewRail)*Math.max(260,rail.clientWidth*.75),behavior:'smooth'}));
});

fetch('data/home-widgets/reviews-of-day.json',{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
  .then(payload=>{
    items=(payload.items||[]).filter(item=>item.publication_status==='published'&&item.source_gate_passed===true&&item.slug&&item.hero);
    if(!items.length)throw new Error('No tool-validated published reviews');
    activeIndex=0;
    render();
    restartTimer();
  })
  .catch(error=>{
    console.warn('Reviews of day:',error);
    main.innerHTML='<div class="home-widget-loading">Проверенные обзоры временно недоступны.</div>';
    rail.innerHTML='';
  });
})();
