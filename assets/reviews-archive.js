(()=>{
'use strict';
const grid=document.querySelector('#reviewsArchiveGrid');
const count=document.querySelector('#reviewsArchiveCount');
const search=document.querySelector('#reviewsArchiveSearch');
if(!grid||!count||!search)return;

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const CONCURRENCY=10;
let reviews=[];
let query='';

const isPublished=article=>{
  if(String(article?.publication_status||'').toLowerCase()!=='published')return false;
  if(article?.source_gate&&article.source_gate.passed===false)return false;
  return Boolean(article.slug&&article.title&&article.hero);
};

const card=article=>{
  const score=Number(article.score);
  const gameTitle=article.identity?.title||article.game_title||article.game_slug||'Игра';
  return `<a class="ig-card ig-card--interactive reviews-archive__card" href="../article/${encodeURIComponent(article.slug)}/"><div class="ig-card__media reviews-archive__card-media"><img class="ig-card__media--landscape" src="${esc(article.hero)}" alt="${esc(gameTitle)}" loading="lazy" decoding="async">${Number.isFinite(score)?`<span class="ig-rating reviews-archive__score">${score.toFixed(1)}</span>`:''}</div><div class="reviews-archive__body"><div class="ig-muted reviews-archive__meta"><span>${esc(gameTitle)}</span><span>•</span><span>${esc(article.published_at||'')}</span></div><h2 class="ig-game-display">${esc(article.title)}</h2><p class="ig-muted">${esc(article.dek||article.lead||'')}</p><div class="reviews-archive__footer"><span>${esc(article.author||'Редакция Игропоиска')}</span><strong>Читать →</strong></div></div></a>`;
};

function filtered(){
  const needle=query.trim().toLocaleLowerCase('ru');
  if(!needle)return reviews;
  return reviews.filter(article=>[
    article.title,
    article.dek,
    article.identity?.title,
    article.game_title,
    article.game_slug
  ].some(value=>String(value||'').toLocaleLowerCase('ru').includes(needle)));
}

function render(){
  const items=filtered();
  count.innerHTML=`<strong>${items.length}</strong> ${items.length===1?'обзор':'обзоров'}`;
  grid.innerHTML=items.length?items.map(card).join(''):'<div class="ig-empty-state reviews-archive__empty">По этому запросу обзоров нет.</div>';
}

async function fetchArticle(slug){
  try{
    const response=await fetch(`../data/articles/${encodeURIComponent(slug)}.json`,{cache:'no-store'});
    if(!response.ok)return null;
    const article=await response.json();
    return isPublished(article)?article:null;
  }catch{return null}
}

async function load(){
  try{
    const response=await fetch('../data/catalog-visible.json',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const catalog=await response.json();
    const slugs=[...new Set((Array.isArray(catalog)?catalog:[]).map(item=>item?.slug).filter(Boolean))];
    let cursor=0;
    let completed=0;
    const found=[];
    const worker=async()=>{
      while(cursor<slugs.length){
        const index=cursor++;
        const article=await fetchArticle(slugs[index]);
        if(article)found.push(article);
        completed++;
        if(completed%12===0||completed===slugs.length){
          count.textContent=`Проверено ${completed} из ${slugs.length} · найдено ${found.length}`;
        }
      }
    };
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,slugs.length)},worker));
    reviews=found.sort((a,b)=>{
      const bDate=Date.parse(b.updated_at||'')||0;
      const aDate=Date.parse(a.updated_at||'')||0;
      return bDate-aDate||String(a.title).localeCompare(String(b.title),'ru');
    });
    render();
  }catch(error){
    console.warn('Reviews archive:',error);
    count.textContent='';
    grid.innerHTML='<div class="ig-empty-state reviews-archive__empty">Не удалось загрузить каталог обзоров.</div>';
  }
}

search.addEventListener('input',()=>{query=search.value;render()});
load();
})();
