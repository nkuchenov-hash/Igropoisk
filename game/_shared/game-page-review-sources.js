(()=>{
'use strict';

const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
if(!slug)return;

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
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
    if(existingUrls.has(absolute))return;
    const wrapper=document.createElement('div');
    wrapper.dataset.reviewSource=String(review?.configured_source_id||'');
    wrapper.innerHTML=`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(reviewName(review))}</a><span>${esc(scoreText(review))}</span>`;
    fragment.appendChild(wrapper);
    existingUrls.add(absolute);
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
    if(document.querySelector('#reviews')&&document.querySelector('#sources'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!document.querySelector('#reviews'))return;
  mergeIntoSourcesTab(reviews);
  updateReviewHeading(reviews);
}

install();
})();