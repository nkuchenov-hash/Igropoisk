(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const setState=(target,title,text)=>{target.innerHTML=`<div class="popular-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`};
const gta6={slug:'grand-theft-auto-vi',title:'Grand Theft Auto VI',year:2026,image:'https://www.igrandtheftauto.com/content/images/grand-theft-auto-vi-official-cover-art-hi-res.jpg',score:96,confidence:.92,families:['community','news'],in_catalog:false,trend_label:'Главный мировой тренд'};
const posterFor=item=>{
  if(item.slug==='grand-theft-auto-vi')return gta6.image;
  const appid=(item.evidence||[]).find(row=>Number(row.appid))?.appid;
  if(appid)return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
  return item.image||'';
};
async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
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
      setState(target,'Рейтинг временно недоступен','Парсер отработал, но пока не набрал достаточно независимых сигналов для публикации.');
      return;
    }
    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    const ranking=[gta6,...data.ranking.filter(item=>item.slug!=='grand-theft-auto-vi')].slice(0,14);
    target.innerHTML=ranking.map((item,index)=>{
      const clickable=existing.has(item.slug);
      const image=posterFor(item);
      const media=image?`<div class="popular-poster"><img src="${esc(image)}" alt="${esc(item.title)}" loading="lazy" decoding="async"></div>`:`<div class="popular-placeholder">${esc(String(item.title||'?').slice(0,2).toUpperCase())}</div>`;
      const evidence=(item.families||[]).slice(0,3).map(value=>({community:'обсуждаемость',steam_chart:'Steam',news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch',steam:'Steam',attention:'интерес'}[value]||value)).join(' · ');
      const label=item.trend_label?`<span class="popular-trend-label">${esc(item.trend_label)}</span>`:'';
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div>${media}<div class="card-body">${label}<h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');
    const heading=document.querySelector('#popular')?.closest('.section')?.querySelector('.section-head');
    if(heading&&!heading.querySelector('.popular-updated')){const note=document.createElement('span');note.className='section-note popular-updated';note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера';heading.appendChild(note)}
  }catch(error){
    console.warn('Игропоиск: popular parser output unavailable',error);
    setState(target,'Рейтинг временно недоступен','Не удалось получить свежие данные парсера.');
  }
}
load();
})();
