(()=>{
'use strict';

const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
if(!slug)return;

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const scoreText=review=>{
  const score=Number(review?.score),scale=Number(review?.scale);
  if(!Number.isFinite(score))return 'Без оценки';
  if(Number.isFinite(scale)&&scale>0)return `${score}/${scale}`;
  return String(score);
};
const reviewName=review=>String(review?.publication||review?.source_name||review?.title||review?.configured_source_id||'Источник');
const reviewUrl=review=>String(review?.resolved_url||review?.url||'');
const uniqueByUrl=list=>{
  const seen=new Set();
  return list.filter(item=>{
    const url=reviewUrl(item);
    const key=`${String(item?.configured_source_id||reviewName(item)).toLowerCase()}|${url}`;
    if(!url||seen.has(key))return false;
    seen.add(key);
    return true;
  });
};

async function fetchReviews(){
  try{
    const response=await fetch(`../../data/reviews/${encodeURIComponent(slug)}.json`,{cache:'no-store'});
    if(!response.ok)return null;
    return await response.json();
  }catch(error){
    console.warn('Игропоиск: review sources unavailable',error);
    return null;
  }
}

function row(review){
  const url=reviewUrl(review);
  const name=reviewName(review);
  const score=scoreText(review);
  const direct=review?.score_evidence?.direct_publisher===true;
  const historical=review?.score_evidence?.historical===true;
  const note=direct?'прямая рецензия':historical?'историческая оценка через индекс':'рецензия';
  return `<div class="review-source-row" data-review-source="${esc(review?.configured_source_id||'')}"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(name)}</b><span>${esc(review?.title||'')}</span></a><span><strong>${esc(score)}</strong><small>${esc(note)}</small></span></div>`;
}

function installOverviewBlock(reviews,data){
  const overview=document.querySelector('#overview');
  if(!overview||overview.querySelector('[data-review-source-summary]'))return;
  const scored=reviews.filter(item=>Number.isFinite(Number(item?.score))).length;
  const gate=data?.publication_gate||{};
  const section=document.createElement('section');
  section.className='game-panel';
  section.dataset.reviewSourceSummary='true';
  section.innerHTML=`<div class="reviews-heading"><h2>Обзоры и оценки источников</h2><span class="ig-muted">${reviews.length} обзоров · ${scored} с оценкой</span></div><div class="source-list" data-review-source-list>${reviews.map(row).join('')}</div>${gate.checked_registered_sources?`<p class="ig-muted">Проверено изданий в базе: ${esc(gate.checked_registered_sources)}. Принято источников: ${esc(gate.accepted??reviews.length)}.</p>`:''}`;
  const grid=overview.querySelector('.overview-grid');
  if(grid)overview.insertBefore(section,grid);
  else overview.prepend(section);
}

function mergeIntoSourcesTab(reviews){
  const list=document.querySelector('#sources');
  if(!list)return;
  const existingUrls=new Set([...list.querySelectorAll('a[href]')].map(a=>a.href));
  const fragment=document.createDocumentFragment();
  reviews.forEach(review=>{
    const url=reviewUrl(review);
    if(!url)return;
    let absolute=url;
    try{absolute=new URL(url,location.href).href}catch{}
    const key=`${absolute}|${review?.configured_source_id||reviewName(review)}`;
    if(existingUrls.has(key))return;
    const wrapper=document.createElement('div');
    wrapper.dataset.reviewSource=String(review?.configured_source_id||'');
    wrapper.innerHTML=`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(reviewName(review))}</a><span>${esc(scoreText(review))}</span>`;
    fragment.appendChild(wrapper);
    existingUrls.add(key);
  });
  list.prepend(fragment);
  const count=document.querySelector('#sourceCount');
  if(count)count.textContent=String(list.querySelectorAll(':scope > div').length);
}

function updateReviewHeading(reviews){
  const count=document.querySelector('#externalReviewCount');
  if(count){
    const scored=reviews.filter(item=>Number.isFinite(Number(item?.score))).length;
    count.textContent=`${reviews.length} источников · ${scored} с оценкой`;
  }
}

async function install(){
  const data=await fetchReviews();
  const reviews=uniqueByUrl(arr(data?.reviews));
  if(!reviews.length)return;
  for(let attempt=0;attempt<80;attempt++){
    if(document.querySelector('#overview')&&document.querySelector('#sources'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!document.querySelector('#overview'))return;
  installOverviewBlock(reviews,data);
  mergeIntoSourcesTab(reviews);
  updateReviewHeading(reviews);
}

install();
})();