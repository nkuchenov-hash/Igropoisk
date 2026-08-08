(()=>{
'use strict';
const labels={trailer:'Трейлеры',gameplay:'Геймплей',review:'Видеообзоры',interview:'Интервью и дневники',other:'Другое видео'};
const order=['trailer','gameplay','review','interview','other'];
const classify=text=>{
  const value=String(text||'').toLowerCase();
  if(/трейлер|trailer|teaser|анонс|launch trailer|cinematic/.test(value))return'trailer';
  if(/обзор|review|verdict|разбор/.test(value))return'review';
  if(/интервью|interview|developer diary|dev diary|behind the scenes|дневник разработ/.test(value))return'interview';
  if(/геймплей|gameplay|walkthrough|демонстрац/.test(value))return'gameplay';
  return'other';
};
const regroup=()=>{
  const group=document.querySelector('#videoGroup');
  const grid=document.querySelector('#mediaVideos');
  if(!group||!grid||grid.dataset.categorized==='1'||!grid.children.length)return false;
  const cards=[...grid.children];
  const buckets=new Map(order.map(key=>[key,[]]));
  cards.forEach(card=>buckets.get(classify(card.querySelector('b')?.textContent||''))?.push(card));
  const fragment=document.createDocumentFragment();
  for(const key of order){
    const items=buckets.get(key)||[];
    if(!items.length)continue;
    const section=document.createElement('section');
    section.className='ig-video-category';
    const head=document.createElement('div');
    head.className='ig-media-group__head ig-video-category__head';
    const h=document.createElement('h3');h.textContent=labels[key];
    const count=document.createElement('span');count.textContent=String(items.length);
    head.append(h,count);
    const inner=document.createElement('div');inner.className='ig-media-grid';
    items.forEach(item=>inner.appendChild(item));
    section.append(head,inner);fragment.appendChild(section);
  }
  grid.replaceChildren(fragment);grid.dataset.categorized='1';
  const mainHead=group.querySelector(':scope > .ig-media-group__head h2');if(mainHead)mainHead.textContent='Видео';
  return true;
};
if(!regroup()){
  const observer=new MutationObserver(()=>{if(regroup())observer.disconnect()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),15000);
}
})();
