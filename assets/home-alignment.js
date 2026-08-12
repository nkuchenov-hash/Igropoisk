(()=>{
'use strict';

const root=document.documentElement;
const home=document.querySelector('#home');
if(!home)return;

const sync=()=>{
  const gutter=parseFloat(getComputedStyle(root).getPropertyValue('--ig-gutter'))||26;
  const safeGutter=Math.max(14,gutter);
  root.style.setProperty('--home-header-left',`${safeGutter}px`);
  root.style.setProperty('--home-header-right',`${safeGutter}px`);
};

let frame=0;
const schedule=()=>{
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(sync);
};

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials=title=>String(title||'И').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const heroRating=[
  {slug:'elden-ring',title:'Elden Ring',score:9.6,appid:1245620},
  {slug:'baldurs-gate-3',title:'Baldur’s Gate 3',score:9.5,appid:1086940},
  {slug:'red-dead-redemption-2',title:'Red Dead Redemption 2',score:9.4,appid:1174180},
  {slug:'the-witcher-3-wild-hunt',title:'The Witcher 3: Wild Hunt',score:9.3,appid:292030}
];

function installHeroRating(){
  const content=document.querySelector('.hero-content');
  if(!content||content.querySelector('[data-home-hero-rating]'))return;
  const panel=document.createElement('aside');
  panel.className='ig-panel home-hero-rating';
  panel.dataset.homeHeroRating='';
  panel.setAttribute('aria-label','Рейтинг Игропоиска');
  panel.innerHTML=`<div class="home-hero-rating__head"><div><span>Рейтинг Игропоиска</span><strong>Лучшие игры редакционного рейтинга</strong></div><a href="top-250/">Топ-250 →</a></div><div class="home-hero-rating__list">${heroRating.map((game,index)=>{
    const candidates=[
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`
    ];
    return `<a class="home-hero-rating__row" href="game/${encodeURIComponent(game.slug)}/"><span class="home-hero-rating__rank">${index+1}</span><span class="home-hero-rating__cover" data-title="${esc(game.title)}"><img src="${esc(candidates[0])}" data-candidates='${esc(JSON.stringify(candidates))}' data-cover-index="0" alt="Обложка ${esc(game.title)}" loading="${index<2?'eager':'lazy'}" decoding="async"></span><span class="home-hero-rating__game"><b>${esc(game.title)}</b><small>Игропоиск</small></span><strong class="home-hero-rating__score">${game.score.toFixed(1)}</strong></a>`;
  }).join('')}</div>`;
  content.appendChild(panel);
  panel.querySelectorAll('img[data-candidates]').forEach(image=>image.addEventListener('error',()=>{
    let candidates=[];
    try{candidates=JSON.parse(image.dataset.candidates||'[]')}catch{}
    const next=Number(image.dataset.coverIndex||0)+1;
    if(next<candidates.length){image.dataset.coverIndex=String(next);image.src=candidates[next];return}
    const holder=image.closest('.home-hero-rating__cover');
    if(holder){holder.textContent=initials(holder.dataset.title);holder.classList.add('is-placeholder')}
  }));
}

function removeLegacyHeadingGlyphs(){
  document.querySelectorAll('.home-showcase-heading__icon').forEach(node=>node.remove());
}

sync();
installHeroRating();
removeLegacyHeadingGlyphs();
window.addEventListener('resize',schedule,{passive:true});
window.addEventListener('load',schedule,{once:true});
document.fonts?.ready?.then(schedule).catch(()=>{});
})();
