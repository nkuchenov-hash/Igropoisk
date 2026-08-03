(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function load(){
  const target=document.querySelector('#popular');
  if(!target)return;
  try{
    const [popularResponse,catalogResponse]=await Promise.all([fetch('data/popular/current.json',{cache:'no-store'}),fetch('data/catalog-visible.json',{cache:'no-store'})]);
    if(!popularResponse.ok)throw new Error(`Popularity HTTP ${popularResponse.status}`);
    const data=await popularResponse.json();
    if(!Array.isArray(data.ranking)||!data.ranking.length)return;
    const catalog=catalogResponse.ok?await catalogResponse.json():[];
    const existing=new Set((catalog||[]).map(item=>item.slug));
    target.innerHTML=data.ranking.slice(0,14).map((item,index)=>{
      const clickable=existing.has(item.slug);
      const media=item.image?`<img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">`:`<div class="popular-placeholder">${esc(String(item.title||'?').slice(0,2).toUpperCase())}</div>`;
      const evidence=(item.families||[]).slice(0,3).map(value=>({news:'СМИ',reddit:'Reddit',youtube:'YouTube',twitch:'Twitch',steam:'Steam',attention:'интерес'}[value]||value)).join(' · ');
      return `<article class="card game-card popular-card"${clickable?` data-game="${esc(item.slug)}"`:''} aria-label="${esc(item.title)}"><div class="popular-rank">${index+1}</div>${media}<div class="card-body"><h3>${esc(item.title)}</h3><div class="popular-meta"><span>Индекс ${esc(item.score)}</span><small>${esc(evidence)}</small></div>${clickable?'':'<span class="popular-pending">Страница готовится</span>'}</div></article>`;
    }).join('');
    const heading=document.querySelector('#popular')?.closest('.section')?.querySelector('.section-head');
    if(heading&&!heading.querySelector('.popular-updated')){const note=document.createElement('span');note.className='section-note popular-updated';note.textContent=data.generated_at?`Обновлено ${new Date(data.generated_at).toLocaleString('ru-RU')}`:'По данным парсера';heading.appendChild(note)}
  }catch(error){console.warn('Игропоиск: popular parser output unavailable',error)}
}
load();
})();
