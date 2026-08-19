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
let carouselBusy=false;

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

function renderMain(){
  const item=items[activeIndex];
  if(!item)return;
  main.innerHTML=mainCard(item);
  main.querySelector('img')?.addEventListener('error',event=>event.currentTarget.closest('.review-day-card__media')?.classList.add('is-broken'),{once:true});
}

function syncActiveMinis(){
  rail.querySelectorAll('[data-review-index]').forEach(button=>{
    const active=Number(button.dataset.reviewIndex)===activeIndex;
    button.classList.toggle('is-active',active);
    if(active)button.setAttribute('aria-current','true');
    else button.removeAttribute('aria-current');
  });
}

function selectReview(index,{restart=true}={}){
  if(!items.length)return;
  activeIndex=((Number(index)||0)%items.length+items.length)%items.length;
  renderMain();
  syncActiveMinis();
  if(restart)restartTimer();
}

function bindMiniCards(){
  rail.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  rail.querySelectorAll('[data-review-index]').forEach(button=>button.addEventListener('click',()=>{
    selectReview(Number(button.dataset.reviewIndex)||0);
  }));
}

function renderRail(){
  rail.innerHTML=items.map(miniCard).join('');
  rail.scrollTo({left:0,behavior:'auto'});
  bindMiniCards();
}

function restartTimer(){
  if(timer)clearInterval(timer);
  if(items.length<2||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  timer=setInterval(()=>selectReview(activeIndex+1,{restart:false}),AUTO_ROTATE_MS);
}

const railStep=()=>{
  const cards=[...rail.querySelectorAll('[data-review-index]')];
  if(cards.length<2)return 0;
  const offsetStep=cards[1].offsetLeft-cards[0].offsetLeft;
  if(offsetStep>0)return offsetStep;
  const gap=parseFloat(getComputedStyle(rail).columnGap||getComputedStyle(rail).gap||'0')||0;
  return cards[0].getBoundingClientRect().width+gap;
};

const waitForRailSettle=callback=>{
  let done=false;
  let fallback=null;
  const finish=()=>{
    if(done)return;
    done=true;
    if(fallback)clearTimeout(fallback);
    rail.removeEventListener('scrollend',finish);
    callback();
  };
  rail.addEventListener('scrollend',finish,{once:true});
  fallback=setTimeout(finish,460);
};

const rotateNext=()=>{
  if(carouselBusy)return;
  const first=rail.firstElementChild;
  const step=railStep();
  if(!first||step<=0)return;
  carouselBusy=true;
  rail.scrollTo({left:step,behavior:'smooth'});
  waitForRailSettle(()=>{
    rail.append(first);
    rail.scrollTo({left:0,behavior:'auto'});
    carouselBusy=false;
  });
};

const rotatePrevious=()=>{
  if(carouselBusy)return;
  const last=rail.lastElementChild;
  if(!last)return;
  carouselBusy=true;
  rail.prepend(last);
  const step=railStep();
  if(step<=0){carouselBusy=false;return}
  rail.scrollTo({left:step,behavior:'auto'});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    rail.scrollTo({left:0,behavior:'smooth'});
    waitForRailSettle(()=>{carouselBusy=false});
  }));
};

const railButtons=[...document.querySelectorAll('[data-review-rail]')];
railButtons.forEach(button=>{
  button.classList.add('ig-icon-button');
  button.disabled=false;
  button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    const direction=Number(button.dataset.reviewRail)||1;
    if(direction>0)rotateNext();
    else rotatePrevious();
  });
});

fetch('data/home-widgets/reviews-of-day.json',{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
  .then(payload=>{
    items=(payload.items||[]).filter(item=>item.publication_status==='published'&&item.source_gate_passed===true&&item.slug&&item.hero);
    if(!items.length)throw new Error('No tool-validated published reviews');
    activeIndex=0;
    renderMain();
    renderRail();
    restartTimer();
  })
  .catch(error=>{
    console.warn('Reviews of day:',error);
    main.innerHTML='<div class="ig-empty-state home-widget-loading">Проверенные обзоры временно недоступны.</div>';
    rail.innerHTML='';
  });
})();
