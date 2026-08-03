(()=>{
'use strict';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const state=(target,title,text)=>{target.innerHTML=`<div class="popular-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`};

const officialCandidates=item=>{
  const appid=(item.evidence||[]).find(row=>Number(row.appid))?.appid;
  const steam=appid?[
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
  ]:[];
  const supplied=[...(item.image_candidates||[]),item.image].filter(url=>{
    const value=String(url||'').toLowerCase();
    return value.includes('library_600x900')||value.includes('cover')||value.includes('poster');
  });
  return [...new Set([...steam,...supplied].filter(Boolean))];
};

const verifyCover=url=>new Promise(resolve=>{
  const image=new Image();
  const timer=setTimeout(()=>resolve(null),7000);
  image.onload=()=>{
    clearTimeout(timer);
    const width=image.naturalWidth||0;
    const height=image.naturalHeight||0;
    const vertical=height>=width*1.18;
    const usable=width>=300&&height>=450;
    resolve(vertical&&usable?url:null);
  };
  image.onerror=()=>{clearTimeout(timer);resolve(null)};
  image.referrerPolicy='no-referrer';
  image.src=url;
});

const firstVerifiedCover=async item=>{
  for(const url of officialCandidates(item)){
    const valid=await verifyCover(url);
    if(valid)return valid;
  }
  return null;
};

const addControls=target=>{
  const heading=target.closest('.section')?.querySelector('.section-head');
  if(!heading||heading.querySelector('[data-popular-controls]'))return;
  const controls=document.createElement('div');
  controls.className='rail-controls';
  controls.dataset.popularControls='';
  controls.innerHTML='<button class="rail-button" type="button" aria-label="Прокрутить влево">←</button><button class="rail-button" type="button" aria-label="Прокрутить вправо">→</button>';
  const [prev,next]=controls.querySelectorAll('button');
  prev.onclick=()=>target.scrollBy({left:-Math.max(280,target.clientWidth*.75),behavior:'smooth'});
  next.onclick=()=>target.scrollBy({left:Math.max(280,target.clientWidth*.75),behavior:'smooth'});
  heading.appendChild(controls);
};

async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  state(target,'Обновляем рейтинг','Проверяем обложки игр.');
  try{
    const stamp=Date.now();
    const [popularResponse,catalogResponse]=await Promise.all([
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'})
    ]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    const ranked=Array.isArray(data.ranking)?data.ranking.slice(0,30):[];

    const checked=await Promise.all(ranked.map(async item=>({item,cover:await firstVerifiedCover(item)})));
    const visible=checked.filter(row=>row.cover).slice(0,20);
    if(!visible.length){
      state(target,'Рейтинг временно недоступен','Нет игр с подтверждёнными официальными обложками.');
      return;
    }

    target.innerHTML=visible.map(({item,cover},index)=>{
      const clickable=existing.has(item.slug);
      const evidence=(item.families||[]).slice(0,3).map(value=>({steam_chart:'Steam',news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch'}[value]||value)).join(' · ');
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div><div class="popular-poster"><img src="${esc(cover)}" alt="${esc(item.title)}" loading="lazy" decoding="async"></div><div class="card-body"><h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');
    addControls(target);

    const heading=target.closest('.section')?.querySelector('.section-head');
    if(heading&&!heading.querySelector('.popular-updated')){
      const note=document.createElement('span');
      note.className='section-note popular-updated';
      note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера';
      heading.appendChild(note);
    }
  }catch(error){
    console.warn('Игропоиск: popular parser output unavailable',error);
    state(target,'Рейтинг временно недоступен','Не удалось получить свежие данные парсера.');
  }
}

load();
const shellScript=document.createElement('script');
shellScript.src='assets/site-shell.js?v=20260803-1';
shellScript.defer=true;
document.head.appendChild(shellScript);
})();
