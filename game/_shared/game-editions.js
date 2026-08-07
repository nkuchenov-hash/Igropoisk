(()=>{
'use strict';

const slug=document.body?.dataset?.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function articleMarkup(article){
  const title=article?.title||'Материал об издании';
  const source=article?.source_name||'Игропоиск';
  if(!article?.url)return `<div><small>${esc(source)}</small><b>${esc(title)}</b></div>`;
  return `<a href="${esc(article.url)}"><small>${esc(source)}</small><b>${esc(title)}</b><span>Открыть материал →</span></a>`;
}

function variantMarkup(item,isModern){
  const articles=Array.isArray(item.articles)?item.articles:[];
  const articleClass=isModern?'ig-card ig-external-review':'ig-card material';
  const articlesMarkup=articles.length
    ? `<div class="${isModern?'ig-external-review-grid':'materials'}">${articles.map(article=>`<article class="${articleClass}">${articleMarkup(article)}</article>`).join('')}</div>`
    : '<div class="ig-empty-state">Отдельных материалов об этом издании пока нет.</div>';
  return `<article class="${isModern?'ig-panel game-panel':'ig-panel panel'}" data-variant-id="${esc(item.variant_id)}"><small>${esc(item.kind_label||item.kind||'Edition / DLC')}</small><h2>${esc(item.title||item.slug)}</h2>${item.release?`<p>${esc(item.release)}</p>`:''}${item.description?`<p>${esc(item.description)}</p>`:''}${articlesMarkup}</article>`;
}

function seriesMemberMarkup(item,isModern){
  const href=`../${encodeURIComponent(item.slug)}/`;
  const meta=[item.year,item.kind==='remake'?'ремейк':null].filter(Boolean).join(' · ');
  if(!isModern){
    return `<a class="ig-card ig-card--interactive material" href="${href}"${item.current?' aria-current="page"':''}><small>${esc(meta)}</small><h3>${esc(item.title)}</h3></a>`;
  }
  const media=item.image?`<div class="ig-card__media ig-game-card-wide__media"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>`:'';
  return `<a class="ig-card ig-card--interactive ig-game-card-wide" href="${href}"${item.current?' aria-current="page"':''}>${media}<div class="ig-card__body ig-game-card-wide__body"><b class="ig-card__title">${esc(item.title)}</b><span class="ig-card__meta">${esc(meta)}</span></div></a>`;
}

function installSeries(sectionData,isModern){
  const series=sectionData?.series;
  const members=Array.isArray(series?.members)?series.members:[];
  if(!series||members.length<2||document.querySelector('[data-game-series]'))return;
  const overview=document.querySelector('#overview');
  if(!overview)return;
  const block=document.createElement(isModern?'section':'article');
  block.dataset.gameSeries=series.series_id||series.title;
  block.className=isModern?'ig-panel game-panel similar-panel':'ig-panel panel';
  block.innerHTML=`<h2>Серия ${esc(series.title)}</h2><div class="${isModern?'similar-row':'materials'}">${members.map(item=>seriesMemberMarkup(item,isModern)).join('')}</div>`;
  const target=isModern?(overview.querySelector('.lower-grid')||overview):(overview.querySelector('.grid')||overview);
  target.appendChild(block);
}

function activateEditions(button,section,isModern){
  const tabButtons=[...document.querySelectorAll('[data-tab]')];
  tabButtons.forEach(item=>item.classList.toggle('active',item===button));
  const selector=isModern?'.game-tab':'.tab';
  document.querySelectorAll(selector).forEach(item=>item.classList.toggle('active',item===section));
  if(location.hash!=='#editions')history.replaceState(null,'','#editions');
}

function installEditions(sectionData,nav,isModern){
  const variants=Array.isArray(sectionData?.variants)?sectionData.variants:[];
  if(!variants.length||nav.querySelector('[data-tab="editions"]'))return;

  const button=document.createElement('button');
  button.type='button';
  button.className='ig-button';
  button.dataset.tab='editions';
  button.textContent='Издания и DLC';
  const sourcesButton=nav.querySelector('[data-tab="sourcesTab"]');
  if(sourcesButton)nav.insertBefore(button,sourcesButton);else nav.appendChild(button);

  const section=document.createElement('section');
  section.id='editions';
  section.className=isModern?'game-tab':'tab';
  section.innerHTML=`<div class="${isModern?'reviews-main':''}"><div class="reviews-heading"><h2>Издания и DLC</h2><span class="ig-muted">${variants.length}</span></div><div>${variants.map(item=>variantMarkup(item,isModern)).join('')}</div></div>`;
  const main=nav.parentElement;
  const sourcesSection=main?.querySelector('#sourcesTab');
  if(sourcesSection)main.insertBefore(section,sourcesSection);else main?.appendChild(section);

  button.addEventListener('click',()=>activateEditions(button,section,isModern));
  if(location.hash==='#editions')activateEditions(button,section,isModern);
}

async function install(sectionData){
  let nav=null;
  for(let attempt=0;attempt<80&&!nav;attempt+=1){
    nav=document.querySelector('.game-tabs,.tabs');
    if(!nav)await sleep(50);
  }
  if(!nav)return;
  const isModern=nav.classList.contains('game-tabs');
  installSeries(sectionData,isModern);
  installEditions(sectionData,nav,isModern);
}

async function run(){
  const data=await fetchJSON('../../data/game-registry/page-sections.json');
  if(!data)return;
  const redirect=data.redirects?.[slug];
  if(redirect?.target_slug&&redirect.target_slug!==slug){
    const target=new URL(`../${encodeURIComponent(redirect.target_slug)}/#${redirect.target_hash||'editions'}`,location.href);
    location.replace(target.href);
    return;
  }
  await install(data.games?.[slug]);
}

run();
})();
