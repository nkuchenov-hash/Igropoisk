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

const scoreMarkup=item=>{
  const score=Number(item.score);
  return Number.isFinite(score)?`<span class="ig-rating review-day-card__score"><strong>${score.toFixed(1)}</strong><small>Оценка Игропоиска</small></span>`:'';
};

const mainCard=item=>{
  const gameTitle=item.game_title||item.title||'Обзор Игропоиска';
  const author=item.author||'Редакция Игропоиска';
  const summary=item.dek||item.title||'';
  return `<a class="ig-card ig-card--interactive review-day-card" href="article/${encodeURIComponent(item.slug)}/" aria-label="Читать обзор ${esc(gameTitle)}"><div class="ig-card__media review-day-card__media"><img src="${esc(item.hero||'')}" alt="${esc(gameTitle)}" loading="eager" decoding="async"></div><span class="review-day-card__veil" aria-hidden="true"></span><div class="ig-card__body review-day-card__copy"><span class="review-day-card__eyebrow">Обзор дня</span><h3 class="ig-card__title">${esc(gameTitle)}</h3><p class="ig-card__summary review-day-card__dek">${esc(summary)}</p><span class="review-day-card__footer">${scoreMarkup(item)}<span class="review-day-card__author"><span class="review-day-card__avatar" aria-hidden="true">ИП</span><span class="review-day-card__author-copy"><strong>${esc(author)}</strong><span>${esc(item.published_at||'')}</span></span></span></span><span class="review-day-card__cta">Читать обзор <span aria-hidden="true">→</span></span></div></a>`;
};

const miniCard=(item,index)=>{
  const gameTitle=item.game_title||item.title||'Обзор';
  const score=Number(item.score);
  return `<button class="ig-button review-day-mini${index===activeIndex?' is-active':''}" type="button" data-review-index="${index}" aria-label="Показать обзор ${esc(gameTitle)}"${index===activeIndex?' aria-current="true"':''}><img src="${esc(item.hero||'')}" alt="" loading="lazy" decoding="async"><span class="review-day-mini__copy"><span class="review-day-mini__title">${esc(gameTitle)}</span></span>${Number.isFinite(score)?`<span class="review-day-mini__score">${score.toFixed(1)}</span>`:''}</button>`;
};

function revealActiveMini(){
  const active=rail.querySelector('.is-active');
  if(!active)return;
  const left=active.offsetLeft;
  const right=left+active.offsetWidth;
  if(left<rail.scrollLeft)rail.scrollTo({left,behavior:'smooth'});
  else if(right>rail.scrollLeft+rail.clientWidth)rail.scrollTo({left:right-rail.clientWidth,behavior:'smooth'});
}

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
  requestAnimationFrame(revealActiveMini);
}

function restartTimer(){
  if(timer)clearInterval(timer);
  if(items.length<2||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  timer=setInterval(()=>{activeIndex=(activeIndex+1)%items.length;render()},AUTO_ROTATE_MS);
}

const railButtons=[...document.querySelectorAll('[data-review-rail]')];
railButtons.forEach(button=>{
  button.classList.add('ig-icon-button');
  button.addEventListener('click',()=>{
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    const next=Math.max(0,Math.min(max,rail.scrollLeft+Number(button.dataset.reviewRail)*Math.max(260,rail.clientWidth*.75)));
    rail.scrollTo({left:next,behavior:'smooth'});
  });
});
const updateButtons=()=>{
  const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
  railButtons.forEach(button=>button.disabled=button.dataset.reviewRail==='-1'?rail.scrollLeft<=2:rail.scrollLeft>=max-2);
};
rail.addEventListener('scroll',updateButtons,{passive:true});
window.addEventListener('resize',updateButtons,{passive:true});

fetch('data/home-widgets/reviews-of-day.json',{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
  .then(payload=>{
    items=(payload.items||[]).filter(item=>item.publication_status==='published'&&item.source_gate_passed===true&&item.slug&&item.hero);
    if(!items.length)throw new Error('No tool-validated published reviews');
    activeIndex=0;
    render();
    restartTimer();
    requestAnimationFrame(updateButtons);
  })
  .catch(error=>{
    console.warn('Reviews of day:',error);
    main.innerHTML='<div class="ig-empty-state home-widget-loading">Проверенные обзоры временно недоступны.</div>';
    rail.innerHTML='';
  });
})();
