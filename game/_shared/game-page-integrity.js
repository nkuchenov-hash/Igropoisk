(()=>{
'use strict';
const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
if(!slug)return;
window.__IG_GAME_PAGE_INTEGRITY__={loaded:true,dataReady:false,applied:false,draft:false,editorial:false};
const arr=v=>Array.isArray(v)?v:[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fetchJSON=async u=>{try{const r=await fetch(u,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const canon=u=>{try{const x=new URL(String(u||''),location.href);x.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])x.searchParams.delete(k);return `${x.origin}${x.pathname.replace(/\/$/,'')}${x.search}`}catch{return String(u||'').trim()}};
const mediaUrl=x=>typeof x==='string'?x:String(x?.url||x?.src||'');
const forbiddenMedia=u=>/storepagebackground\//i.test(String(u||''));

function applyPresentation(draft,editorial){
  const title=document.querySelector('#gameTitle');
  if(!title)return;
  const short=String(editorial?.short_description||draft?.editorial?.short_description||'').trim();
  const long=String(editorial?.integrated_description||draft?.editorial?.integrated_description||'').trim();
  const genres=arr(editorial?.genres).length?arr(editorial.genres):arr(draft?.classification?.genres);
  const developer=String(editorial?.developer||draft?.companies?.developers?.[0]||'').trim();
  const year=String(editorial?.release_year||draft?.release?.date||draft?.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||String(draft?.release?.date_text||'').trim();
  const meta=document.querySelector('#gameMeta');
  if(meta)meta.textContent=[year,...genres,developer].filter(Boolean).join(' · ');
  let pitch=document.querySelector('.hero-pitch');
  if(short){
    if(!pitch){
      pitch=document.createElement('p');
      pitch.className='hero-pitch';
      title.closest('.hero-copy')?.insertBefore(pitch,title.nextSibling);
    }
    pitch.textContent=short;
  }
  if(long){
    const description=document.querySelector('#description');
    if(description)description.textContent=long;
  }
  const tags=document.querySelector('#genreTags');
  if(tags&&genres.length)tags.innerHTML=genres.map(x=>`<span class="game-chip">${esc(x)}</span>`).join('');
  const note=document.querySelector('#editorialNote');
  if(note){note.textContent='';note.hidden=true}
  const hero=document.querySelector('#gameHero');
  if(hero&&forbiddenMedia(getComputedStyle(hero).backgroundImage))hero.classList.add('ig-game-hero-sanitized');
  document.querySelectorAll('img').forEach(img=>{if(forbiddenMedia(img.currentSrc||img.src))img.closest('article,figure,button,.media-card,.ig-media-card')?.remove()});
}

function renderReviewSummaryCard(draft,ratings,editorial){
  const reviewsMain=document.querySelector('#reviews .reviews-main');
  const heading=document.querySelector('#reviews .reviews-heading');
  if(!reviewsMain||!heading)return;
  const legacy=document.querySelector('#featuredReview');
  if(legacy){legacy.hidden=true;legacy.setAttribute('aria-hidden','true')}
  const reviewReady=draft?.publication?.review_ready===true;
  let card=document.querySelector('#reviewSummaryCard');
  if(!reviewReady){card?.remove();return}
  if(!card){
    card=document.createElement('article');
    card.id='reviewSummaryCard';
    card.className='ig-card game-panel review-summary-card';
    reviewsMain.insertBefore(card,heading);
  }
  const title=document.querySelector('#gameTitle')?.textContent?.trim()||draft?.identity?.title||'Игра';
  const description=String(editorial?.integrated_description||document.querySelector('#description')?.textContent?.trim()||draft?.editorial?.integrated_description||draft?.editorial?.short_description||'').trim();
  const shots=arr(draft?.media?.screenshots).map(mediaUrl).filter(Boolean).filter(u=>!forbiddenMedia(u));
  const image=shots[0]||(!forbiddenMedia(draft?.media?.cover)?String(draft?.media?.cover||''):'');
  const rating=Number(ratings?.calculation?.score_10);
  const ratingText=Number.isFinite(rating)?rating.toFixed(1).replace(/\.0$/,''):'—';
  card.hidden=false;
  card.innerHTML=`<div class="ig-card__media review-summary-card__media">${image?`<img src="${esc(image)}" alt="${esc(title)}" loading="lazy">`:`<div class="media-placeholder">${esc(title.slice(0,2).toUpperCase())}</div>`}</div><div class="ig-card__body review-summary-card__body"><small>ОБЗОР ИГРОПОИСКА</small><h2>Обзор ${esc(title)}</h2><p>${esc(description)}</p><div class="ig-card__meta review-summary-card__meta"><strong>${esc(ratingText)}${ratingText==='—'?'':'/10'}</strong></div></div>`;
}

function fixOfficialLinks(draft){
  const box=document.querySelector('#officialLinks');
  if(!box)return;
  const official=String(draft?.links?.official||'').trim();
  const store=String(draft?.links?.store||'').trim();
  const links=[];
  if(official&&/^https?:\/\//i.test(official))links.push(['Официальный сайт',official]);
  if(store&&/^https?:\/\//i.test(store)&&canon(store)!==canon(official))links.push(['Страница магазина',store]);
  box.innerHTML=links.length?links.map(([n,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span>${esc(n)}</span><b>Открыть ↗</b></a>`).join(''):'<div class="ig-empty-state ig-muted">Подтверждённая официальная ссылка не найдена.</div>';
}

function hideOwnGuidePresentation(){
  const featured=document.querySelector('#featuredGuide');
  if(featured){featured.hidden=true;featured.setAttribute('aria-hidden','true')}
  const quick=document.querySelector('#guideQuickLinks')?.closest('section');
  if(quick){quick.hidden=true;quick.setAttribute('aria-hidden','true')}
  const updated=document.querySelector('#guideUpdated')?.closest('section');
  if(updated){updated.hidden=true;updated.setAttribute('aria-hidden','true')}
  document.querySelector('#guides .guides-layout')?.classList.add('ig-guides-external-only');
}

let ratingControlsRemovalScheduled=false;
function scheduleDisabledRatingControlsRemoval(){
  if(ratingControlsRemovalScheduled)return;
  ratingControlsRemovalScheduled=true;
  let attempts=0,hydratedAt=0;
  const timer=setInterval(()=>{
    attempts++;
    const dialog=document.querySelector('#ratingDialog');
    if(!dialog){clearInterval(timer);return}
    const hydrated=document.querySelectorAll('#ratingScale button').length===10&&Boolean(document.querySelector('#ratingDialogTitle')?.textContent?.trim());
    if(hydrated&&!hydratedAt){hydratedAt=Date.now();return}
    if(!hydrated&&attempts<160)return;
    if(hydrated&&Date.now()-hydratedAt<1200&&attempts<160)return;
    clearInterval(timer);
    for(const selector of ['#rateGame','#rateInline','#ratingDialog'])document.querySelector(selector)?.remove();
  },50);
}

function renderFranchise(franchise){
  const games=arr(franchise?.games).filter(game=>game?.title&&game?.slug);
  if(!franchise?.name||!games.length)return;
  if(franchise?.status&&franchise.status!=='green')return;
  const overview=document.querySelector('#overview .lower-grid');
  if(!overview)return;
  let panel=document.querySelector('#franchisePanel');
  if(!panel){panel=document.createElement('section');panel.id='franchisePanel';panel.className='ig-panel game-panel franchise-panel';overview.appendChild(panel)}
  const card=game=>{const body=`<b>${esc(game.title)}</b><span>${esc(game.release_year||game.year||'')}</span>`;return game.page_available===true?`<a class="ig-card franchise-game" href="../${encodeURIComponent(game.slug)}/">${body}</a>`:`<div class="ig-card franchise-game franchise-game--unavailable" aria-disabled="true">${body}</div>`};
  panel.innerHTML=`<div class="ig-toolbar franchise-panel__head"><div><h2>Игры серии</h2><span>${esc(franchise.name)}</span></div></div><div class="franchise-row">${games.map(card).join('')}</div>`;
}

async function main(){
  const[draft,ratings,editorial,franchise]=await Promise.all([
    fetchJSON(`../../data/drafts/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/ratings/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/page-editorial/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/franchises/${encodeURIComponent(slug)}.json`)
  ]);
  Object.assign(window.__IG_GAME_PAGE_INTEGRITY__,{dataReady:true,draft:Boolean(draft),editorial:Boolean(editorial)});
  const apply=()=>{
    applyPresentation(draft,editorial);
    renderReviewSummaryCard(draft,ratings,editorial);
    fixOfficialLinks(draft);
    hideOwnGuidePresentation();
    scheduleDisabledRatingControlsRemoval();
    renderFranchise(franchise);
    window.__IG_GAME_PAGE_INTEGRITY__.applied=true;
    window.__IG_GAME_PAGE_INTEGRITY__.appliedAt=Date.now();
  };
  apply();
  setTimeout(apply,400);
  setTimeout(apply,1200);
  setTimeout(apply,2500);
  setTimeout(apply,5000);
}

main().catch(e=>{window.__IG_GAME_PAGE_INTEGRITY__.error=String(e?.message||e);console.warn('Игропоиск: page integrity',e)});
})();
