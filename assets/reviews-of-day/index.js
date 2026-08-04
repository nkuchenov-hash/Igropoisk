(()=>{
'use strict';
const main=document.querySelector('#reviewsOfDayMain');
const rail=document.querySelector('#reviewsOfDayRail');
if(!main||!rail)return;

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const parseDate=value=>{
  if(!value)return 0;
  const direct=Date.parse(value);
  if(Number.isFinite(direct))return direct;
  const ru=String(value).match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if(!ru)return 0;
  const months={января:0,февраля:1,марта:2,апреля:3,мая:4,июня:5,июля:6,августа:7,сентября:8,октября:9,ноября:10,декабря:11};
  return Date.UTC(Number(ru[3]),months[ru[2].toLowerCase()]??0,Number(ru[1]));
};
const hash=value=>{
  let state=2166136261;
  for(const char of String(value)){state^=char.charCodeAt(0);state=Math.imul(state,16777619)}
  return ()=>((state=Math.imul(state^state>>>15,2246822519),state^=Math.imul(state^state>>>13,3266489917),(state^state>>>16)>>>0)/4294967296);
};
const weightedPick=(items,random,weight)=>{
  const total=items.reduce((sum,item)=>sum+weight(item),0);
  let cursor=random()*total;
  for(const item of items){cursor-=weight(item);if(cursor<=0)return item}
  return items[items.length-1];
};
const freshnessWeight=(item,rules)=>{
  const currentYear=new Date().getUTCFullYear();
  const gameAge=Math.max(0,currentYear-Number(item.game_release_year||currentYear));
  const gameBoost=Math.max(Number(rules.minimum_weight||1),Number(rules.new_game_weight||3.2)-gameAge*Number(rules.year_decay||.18));
  const articleAgeDays=Math.max(0,(Date.now()-parseDate(item.published_at))/86400000);
  const articleBoost=1+Math.max(0,Number(rules.article_fresh_days||45)-articleAgeDays)/Number(rules.article_fresh_days||45)*Number(rules.article_fresh_bonus||.7);
  return Math.max(.1,gameBoost*articleBoost*Number(item.editorial_weight||1));
};
const mainCard=item=>`<a class="review-day-card" href="article/${encodeURIComponent(item.slug)}/"><div class="review-day-card__copy"><span class="review-day-card__eyebrow">${esc(item.game_title||'Обзор Игропоиска')}</span><h3>${esc(item.title)}</h3><p class="review-day-card__dek">${esc(item.dek||'')}</p><div class="review-day-card__meta"><span class="review-day-card__avatar">ИП</span><span class="review-day-card__meta-text"><b>${esc(item.author||'Редакция Игропоиска')}</b><span>${esc(item.published_at||'')}</span></span></div></div><div class="review-day-card__media"><img src="${esc(item.hero)}" alt="" loading="eager" decoding="async"></div>${Number.isFinite(Number(item.score))?`<span class="review-day-card__score">${Number(item.score).toFixed(1)}</span>`:''}</a>`;
const miniCard=item=>`<a class="review-day-mini" href="article/${encodeURIComponent(item.slug)}/"><img src="${esc(item.hero)}" alt="" loading="lazy" decoding="async"><div><strong>${esc(item.title)}</strong><span>${esc(item.game_title||item.published_at||'Обзор')}</span></div></a>`;
const bindRail=()=>{
  document.querySelectorAll('[data-review-rail]').forEach(button=>{
    button.onclick=()=>rail.scrollBy({left:Number(button.dataset.reviewRail)*Math.max(220,rail.clientWidth*.78),behavior:'smooth'});
  });
  rail.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;event.preventDefault();rail.scrollBy({left:event.deltaY,behavior:'auto'})},{passive:false});
};

Promise.all([
  fetch('data/home-widgets/reviews-of-day.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}),
  fetch('features/reviews-of-day/rules.json',{cache:'no-store'}).then(response=>response.ok?response.json():{})
]).then(([payload,rules])=>{
  const items=(payload.items||[]).filter(item=>item.publication_status==='published'&&item.source_gate_passed!==false&&item.slug&&item.hero);
  if(!items.length)throw new Error('No published reviews');
  const slotHours=Math.max(1,Number(rules.rotation_hours||6));
  const slot=Math.floor(Date.now()/(slotHours*3600000));
  const random=hash(`${rules.seed_namespace||'reviews-of-day'}:${slot}`);
  const featured=weightedPick(items,random,item=>freshnessWeight(item,rules));
  const others=items.filter(item=>item!==featured).sort((left,right)=>freshnessWeight(right,rules)-freshnessWeight(left,rules)||parseDate(right.published_at)-parseDate(left.published_at));
  main.innerHTML=mainCard(featured);
  rail.innerHTML=others.map(miniCard).join('')||`<a class="review-day-mini" href="article/${encodeURIComponent(featured.slug)}/"><img src="${esc(featured.hero)}" alt=""><div><strong>Открыть полный обзор</strong><span>${esc(featured.game_title||'Игропоиск')}</span></div></a>`;
  main.querySelector('img')?.addEventListener('error',event=>event.currentTarget.closest('.review-day-card__media')?.classList.add('is-broken'),{once:true});
  rail.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  bindRail();
}).catch(error=>{
  console.warn('Reviews of day:',error);
  main.innerHTML='<div class="home-widget-loading">Опубликованные обзоры временно недоступны.</div>';
  rail.innerHTML='';
});
})();