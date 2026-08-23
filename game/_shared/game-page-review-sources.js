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
const reviewName=review=>String(review?.publication||review?.source_name||review?.source||review?.title||review?.configured_source_id||'Источник');
const reviewUrl=review=>String(review?.resolved_url||review?.url||'');
const host=value=>{try{return new URL(value,location.href).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const canonical=value=>{try{const u=new URL(value,location.href);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const uniqueByUrl=list=>{
  const seen=new Set();
  return list.filter(item=>{
    const url=canonical(reviewUrl(item));
    if(!url||seen.has(url))return false;
    seen.add(url);
    return true;
  });
};
const readableReview=review=>{
  const url=reviewUrl(review),h=host(url);
  if(!url)return false;
  if(h==='metacritic.com'||h.endsWith('.metacritic.com')||h==='opencritic.com'||h.endsWith('.opencritic.com'))return false;
  return !['score_index','rating_index','aggregate'].includes(String(review?.source_kind||''));
};

async function fetchJson(url){
  try{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)return null;
    return await response.json();
  }catch{return null}
}

async function fetchReviews(){
  const [main,seeds]=await Promise.all([
    fetchJson(`../../data/reviews/${encodeURIComponent(slug)}.json`),
    fetchJson(`../../data/review-discovery-seeds/${encodeURIComponent(slug)}.json`)
  ]);
  if(!main&&!seeds)return null;
  return {
    main:main||{},
    reviews:uniqueByUrl([...arr(main?.reviews),...arr(seeds?.reviews)]),
    scoreSources:arr(main?.score_sources)
  };
}

function mergeIntoSourcesTab(reviews){
  const list=document.querySelector('#sources');
  if(!list)return;
  const existingUrls=new Set([...list.querySelectorAll('a[href]')].map(a=>canonical(a.href)));
  const fragment=document.createDocumentFragment();
  reviews.forEach(review=>{
    const url=reviewUrl(review);
    if(!url)return;
    const absolute=canonical(url);
    if(existingUrls.has(absolute))return;
    const wrapper=document.createElement('div');
    wrapper.dataset.reviewSource=String(review?.configured_source_id||reviewName(review));
    wrapper.innerHTML=`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(reviewName(review))}</a><span>${esc(scoreText(review))}</span>`;
    fragment.appendChild(wrapper);
    existingUrls.add(absolute);
  });
  list.prepend(fragment);
  const count=document.querySelector('#sourceCount');
  if(count)count.textContent=String(list.querySelectorAll(':scope > div').length);
}

function row(review,{showScore=true}={}){
  const url=reviewUrl(review);
  const title=String(review?.title||`Материал о ${document.body.dataset.title||slug}`);
  const score=showScore?scoreText(review):'';
  return `<a class="quality-review-row" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="quality-review-source">${esc(reviewName(review))}</span><b>${esc(title)}</b>${showScore?`<strong>${esc(score)}</strong>`:''}<span aria-hidden="true">↗</span></a>`;
}

function renderReviewsTab(reviews,scoreSources){
  const tab=document.querySelector('#reviews');
  if(!tab)return;
  tab.querySelector('#externalReviewSourcesPanel')?.remove();

  const readable=uniqueByUrl(reviews.filter(readableReview));
  const scoredBase=[...reviews,...scoreSources].filter(item=>Number.isFinite(Number(item?.score))||String(item?.grade||'').trim());
  const scoreSeen=new Set();
  const scored=scoredBase.filter(item=>{
    const key=`${reviewName(item).toLowerCase()}|${scoreText(item)}`;
    if(scoreSeen.has(key))return false;
    scoreSeen.add(key);
    return true;
  });

  const panel=document.createElement('section');
  panel.id='externalReviewSourcesPanel';
  panel.innerHTML=`
    <div class="section-title"><div><h2>Обзоры других источников</h2><p>${readable.length} читаемых материалов с прямыми ссылками</p></div></div>
    <div class="quality-review-table" id="externalReadableReviews">${readable.map(item=>row(item)).join('')}</div>
    ${scored.length?`<div class="section-title"><div><h2>Оценки критиков</h2><p>${scored.length} опубликованных оценок</p></div></div><div class="quality-review-table" id="externalCriticScores">${scored.map(item=>row(item)).join('')}</div>`:''}
  `;
  tab.appendChild(panel);

  const count=document.querySelector('#externalReviewCount');
  if(count)count.textContent=`${readable.length} обзоров · ${scored.length} оценок`;
}

async function install(){
  const data=await fetchReviews();
  if(!data)return;
  for(let attempt=0;attempt<100;attempt++){
    if(document.querySelector('#reviews')&&document.querySelector('#sources'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!document.querySelector('#reviews'))return;
  mergeIntoSourcesTab(data.reviews);
  renderReviewsTab(data.reviews,data.scoreSources);
}

install();
})();