(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
if(!slug)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const mediaUrl=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||item?.thumbnail||'');
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const unique=list=>[...new Set(list.filter(Boolean))];
const fetchJSON=async url=>{try{const r=await fetch(url,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const waitFor=async selector=>{for(let i=0;i<120;i++){const node=document.querySelector(selector);if(node)return node;await new Promise(r=>setTimeout(r,100))}return null};
const displayTitle=draft=>{const draftTitle=String(draft?.identity?.title||'').trim();const shellTitle=String(document.body.dataset.title||'').trim();const technical=!draftTitle||canonical(draftTitle)===canonical(slug)||/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(draftTitle);return technical?(shellTitle||draftTitle||slug):(draftTitle||shellTitle||slug)};
const scoreText=item=>{
  if(item?.original_score?.display)return item.original_score.display;
  if(item?.grade)return String(item.grade);
  const score=Number(item?.score),scale=Number(item?.scale);
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)return `${score}/${scale}`;
  return '';
};
const forbiddenReview=item=>{
  const value=`${item?.title||''} ${item?.url||''}`.toLowerCase();
  const bad=/(walkthrough|\bguide\b|wiki|\btips?\b|\bbuilds?\b|\bnews\b|preview|interview|how[- ]?to|прохожд|гайд|совет|новост|превью|интервью)/i;
  if(bad.test(value))return true;
  try{const host=new URL(item.url).hostname.replace(/^www\./,'').toLowerCase();return ['store.steampowered.com','steamcommunity.com','metacritic.com','opencritic.com','reddit.com','youtube.com','youtu.be','fandom.com'].some(domain=>host===domain||host.endsWith(`.${domain}`))}catch{return true}
};
function exactTitle(draft){
  const title=displayTitle(draft);
  if(!title)return;
  document.body.dataset.title=title;
  const pageTitle=document.querySelector('#gameTitle');if(pageTitle)pageTitle.textContent=title;
  const crumb=document.querySelector('#crumb');if(crumb)crumb.textContent=title;
  if(document.title&&canonical(document.title).startsWith(canonical(slug)))document.title=`${title} — Игропоиск`;
}
function installHeroArt(draft){
  const hero=document.querySelector('#gameHero'),rail=document.querySelector('#heroMedia');
  if(!hero||!rail)return;
  const screenshots=unique(arr(draft?.media?.screenshots).map(mediaUrl));
  const screenshotKeys=new Set(screenshots.map(url=>url.split(/[?#]/)[0].toLowerCase()));
  const artwork=unique(arr(draft?.media?.artwork).map(mediaUrl));
  const appid=Number(draft?.identity?.steam_appid||0);
  const officialFallback=appid?`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`:'';
  const candidates=unique([...artwork,officialFallback,mediaUrl(draft?.media?.hero),mediaUrl(draft?.media?.cover)]);
  const primaryArt=candidates.find(url=>!screenshotKeys.has(url.split(/[?#]/)[0].toLowerCase()))||candidates[0]||'';
  let preview=hero.querySelector('.game-hero__preview');
  if(!preview){preview=document.createElement('img');preview.className='game-hero__preview';preview.alt='';preview.decoding='async';hero.prepend(preview)}
  if(primaryArt)preview.src=primaryArt;
  const title=displayTitle(draft);
  const items=unique([primaryArt,...screenshots]);
  rail.innerHTML=items.map((url,index)=>`<button class="hero-media__item${index===0?' active':''}" type="button" data-image="${esc(url)}"><img src="${esc(url)}" alt="${esc(index===0?`${title} — официальный арт`:`${title} — скриншот ${index}`)}" loading="${index<2?'eager':'lazy'}"></button>`).join('');
  rail.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    rail.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));
    preview.src=button.dataset.image;
  }));
}
function installFranchise(draft){
  const franchise=draft?.relations?.franchise;
  const games=arr(franchise?.games).filter(game=>game&&canonical(game.title)!==canonical(displayTitle(draft)));
  if(!franchise?.name||!games.length)return;
  const overview=document.querySelector('#overview .lower-grid');if(!overview)return;
  let panel=document.querySelector('#franchisePanel');
  if(!panel){panel=document.createElement('section');panel.id='franchisePanel';panel.className='game-panel franchise-panel';overview.appendChild(panel)}
  panel.innerHTML=`<div class="franchise-panel__head"><div><h2>Игры серии</h2><span>${esc(franchise.name)}</span></div></div><div class="franchise-row">${games.map(game=>`<a class="franchise-game" href="../${encodeURIComponent(game.slug||String(game.title||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'-').replace(/^-|-$/g,''))}/"><b>${esc(game.title)}</b><span>${esc(game.release_year||game.year||'')}</span></a>`).join('')}</div>`;
}
function bindRailControls(row){
  if(!row||row.dataset.qualityRail==='1')return;row.dataset.qualityRail='1';
  const parent=row.parentElement;if(!parent)return;
  const shell=document.createElement('div');shell.className='quality-rail-shell';
  parent.insertBefore(shell,row);shell.appendChild(row);
  const prev=document.createElement('button'),next=document.createElement('button');
  prev.className='quality-rail-arrow prev';next.className='quality-rail-arrow next';prev.type=next.type='button';prev.textContent='‹';next.textContent='›';
  prev.setAttribute('aria-label','Предыдущие похожие игры');next.setAttribute('aria-label','Следующие похожие игры');
  shell.append(prev,next);
  const move=direction=>row.scrollBy({left:direction*Math.max(260,row.clientWidth*.75),behavior:'smooth'});
  prev.onclick=()=>move(-1);next.onclick=()=>move(1);
  let dragging=false,startX=0,startLeft=0;
  row.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;dragging=true;startX=event.clientX;startLeft=row.scrollLeft;row.setPointerCapture?.(event.pointerId);row.classList.add('is-dragging')});
  row.addEventListener('pointermove',event=>{if(dragging)row.scrollLeft=startLeft-(event.clientX-startX)});
  const stop=()=>{dragging=false;row.classList.remove('is-dragging')};row.addEventListener('pointerup',stop);row.addEventListener('pointercancel',stop);
  row.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){row.scrollLeft+=event.deltaY;event.preventDefault()}},{passive:false});
}
async function installSimilarity(){
  const target=document.querySelector('#similarGames');if(!target)return;
  const data=await fetchJSON(`../../data/similarity/${encodeURIComponent(slug)}.json`);
  const items=arr(data?.recommendations);
  if(items.length){
    target.innerHTML=items.map(item=>`<a class="ig-game-card-wide" href="../${encodeURIComponent(item.slug)}/" data-similarity-score="${Number(item.score||0).toFixed(3)}" data-similarity-reasons="${esc(arr(item.reasons).join(' · '))}"><div class="ig-game-card-wide__body"><b>${esc(item.title)}</b><span>${esc(item.year||'')}</span>${arr(item.reasons).length?`<small>${esc(arr(item.reasons).slice(0,2).join(' · '))}</small>`:''}</div></a>`).join('');
  }
  bindRailControls(target);
}
function installReviews(reviewFeed,ratingFeed,draft){
  const grid=document.querySelector('#reviewGrid');if(!grid)return;
  const title=displayTitle(draft);
  const reviews=arr(reviewFeed?.reviews).filter(item=>item?.url&&!forbiddenReview(item)&&scoreText(item));
  const count=document.querySelector('#externalReviewCount');if(count)count.textContent=reviews.length?`${reviews.length} рецензий`:'';
  grid.classList.add('quality-review-table');
  grid.innerHTML=reviews.map(item=>{
    const source=item.publication||item.source||item.domain||'Издание';
    return `<a class="quality-review-row" href="${esc(item.resolved_url||item.url)}" target="_blank" rel="noopener noreferrer"><span class="quality-review-source">${esc(source)}</span><b>${esc(item.title||`Обзор ${title}`)}</b><strong>${esc(scoreText(item))}</strong><span aria-hidden="true">↗</span></a>`;
  }).join('')||'<div class="empty-state">Подтверждённые профессиональные рецензии ещё собираются.</div>';
  const calculated=Number(ratingFeed?.calculation?.score_10);
  const featured=document.querySelector('#featuredReview');
  if(featured){
    const heading=featured.querySelector('h2');if(heading)heading.textContent=`Обзор ${title}`;
    const score=featured.querySelector('.ig-review-feature__score');if(score)score.textContent=Number.isFinite(calculated)?`${calculated.toFixed(1)}/10`:'—';
    const meta=featured.querySelector('.ig-review-feature__meta span');if(meta)meta.textContent=Number.isFinite(calculated)?`Рассчитано по ${ratingFeed?.sources?.length||reviews.length} независимым профессиональным рецензиям`:'Рейтинг рассчитывается после подтверждения источников';
  }
  const ratingCard=document.querySelector('.hero-score-card');
  if(ratingCard&&ratingFeed?.sources?.length){
    let details=ratingCard.querySelector('.rating-method-details');
    if(!details){details=document.createElement('details');details.className='rating-method-details';ratingCard.appendChild(details)}
    details.innerHTML=`<summary>Как рассчитан рейтинг</summary><div>${ratingFeed.sources.map(item=>`<a href="${esc(item.url||'#')}" target="_blank" rel="noopener noreferrer"><span>${esc(item.publication)}</span><b>${esc(item.original_score?.display||scoreText(item))}</b><strong>${Number(item.normalized_10).toFixed(1)}</strong></a>`).join('')}</div>`;
  }
}
function hideTabScrollbar(){const tabs=document.querySelector('.game-tabs');if(tabs)tabs.classList.add('quality-tabs')}
async function main(){
  await waitFor('#gameTitle');
  await new Promise(resolve=>setTimeout(resolve,350));
  const [draft,reviewFeed,ratingFeed]=await Promise.all([
    fetchJSON(`../../data/drafts/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/reviews/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/ratings/${encodeURIComponent(slug)}.json`)
  ]);
  if(!draft)return;
  exactTitle(draft);installHeroArt(draft);installFranchise(draft);hideTabScrollbar();installReviews(reviewFeed,ratingFeed,draft);await installSimilarity();
}
main().catch(error=>console.warn('Игропоиск: game page quality layer',error));
})();
