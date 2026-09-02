(()=>{
'use strict';
const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
if(!slug)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatScore=source=>{
  const score=Number(source?.score),scale=Number(source?.scale);
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)return `${score}/${scale}`;
  if(source?.grade)return String(source.grade);
  if(Number.isFinite(Number(source?.normalized_10)))return `${Number(source.normalized_10).toFixed(1)}/10`;
  return '';
};
const roleLabel=roles=>{
  const set=new Set(Array.isArray(roles)?roles:[]);
  if(set.has('rating'))return 'Оценка / рецензия';
  if(set.has('media'))return 'Медиа / данные';
  if(set.has('requirements'))return 'Системные требования';
  if(set.has('identity'))return 'Идентичность / факты';
  if(set.has('description')||set.has('dna'))return 'Материал об игре';
  return 'Источник';
};
async function main(){
  let target=null,count=null;
  for(let i=0;i<120;i++){
    target=document.querySelector('#sources');count=document.querySelector('#sourceCount');
    if(target)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!target)return;
  let corpus;
  try{
    const response=await fetch(`../../data/game-sources/${encodeURIComponent(slug)}.json`,{cache:'no-store'});
    if(!response.ok)return;
    corpus=await response.json();
  }catch{return}
  const sources=Array.isArray(corpus?.sources)?corpus.sources.filter(item=>item?.url):[];
  if(!sources.length)return;
  target.innerHTML=sources.map(source=>{
    const score=formatScore(source);
    const meta=[roleLabel(source.roles),source.domain,score].filter(Boolean).join(' · ');
    return `<div class="game-source-corpus__row"><div><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.name||source.domain||'Источник')}</a>${source.title&&source.name?`<small>${esc(source.name)}</small>`:''}</div><span>${esc(meta||'↗')}</span></div>`;
  }).join('');
  if(count)count.textContent=String(sources.length);
  const panel=target.closest('.game-panel');
  const heading=panel?.querySelector('h2');
  if(heading)heading.textContent='Все источники об игре';
  if(panel&&!panel.querySelector('.game-source-corpus__summary')){
    const summary=document.createElement('p');summary.className='ig-muted game-source-corpus__summary';
    summary.textContent=`${sources.length} источников · ${Number(corpus?.counts?.scored||0)} с оценками. Эта база используется страницей, Game DNA, медиа, рейтингом и редакционными материалами.`;
    heading?.after(summary);
  }
}
main().catch(error=>console.warn('Игропоиск: source corpus',error));
})();
