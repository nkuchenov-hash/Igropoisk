(()=>{
'use strict';

const root=document.documentElement;
const header=document.querySelector('.site-header');
const inner=document.querySelector('.site-header__inner');
const desktopNav=document.querySelector('.site-nav');
const actions=document.querySelector('.site-actions');
if(!header||!inner||!desktopNav||!actions)return;

const safeStorage={
  get(key){try{return window.localStorage.getItem(key)}catch{return null}},
  set(key,value){try{window.localStorage.setItem(key,value)}catch{}}
};

const themeButton=document.querySelector('#theme');
if(themeButton){
  const cleanButton=themeButton.cloneNode(true);
  themeButton.replaceWith(cleanButton);
  const preferred=safeStorage.get('igroTheme');
  const initial=preferred==='light'||preferred==='dark'
    ?preferred
    :(window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark');
  const applyTheme=theme=>{
    root.dataset.theme=theme;
    cleanButton.textContent=theme==='light'?'☾':'☀';
    cleanButton.setAttribute('aria-label',theme==='light'?'Включить тёмную тему':'Включить светлую тему');
    cleanButton.setAttribute('aria-pressed',String(theme==='light'));
  };
  applyTheme(initial);
  cleanButton.addEventListener('click',()=>{
    const next=root.dataset.theme==='light'?'dark':'light';
    applyTheme(next);
    safeStorage.set('igroTheme',next);
  });
}

const menuButton=document.createElement('button');
menuButton.className='ig-button icon-button mobile-menu-toggle';
menuButton.type='button';
menuButton.setAttribute('aria-label','Открыть меню');
menuButton.setAttribute('aria-expanded','false');
menuButton.setAttribute('aria-controls','mobileMenu');
menuButton.innerHTML='<span></span><span></span><span></span>';
inner.insertBefore(menuButton,actions);

const mobileMenu=document.createElement('div');
mobileMenu.className='mobile-menu';
mobileMenu.id='mobileMenu';
mobileMenu.hidden=true;
mobileMenu.innerHTML=`<nav aria-label="Мобильная навигация">${desktopNav.innerHTML}</nav>`;
header.appendChild(mobileMenu);

const setOpen=open=>{
  mobileMenu.hidden=!open;
  menuButton.classList.toggle('open',open);
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
  document.body.classList.toggle('mobile-menu-open',open);
};

menuButton.addEventListener('click',()=>setOpen(mobileMenu.hidden));
mobileMenu.addEventListener('click',event=>{
  const button=event.target.closest('[data-page]');
  if(!button)return;
  const page=button.dataset.page;
  const original=desktopNav.querySelector(`[data-page="${CSS.escape(page)}"]`);
  original?.click();
  setOpen(false);
});

document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false)});
window.addEventListener('resize',()=>{if(window.innerWidth>760)setOpen(false)},{passive:true});

const syncActive=()=>{
  const active=desktopNav.querySelector('[data-page].active')?.dataset.page;
  mobileMenu.querySelectorAll('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===active));
};
desktopNav.addEventListener('click',()=>queueMicrotask(syncActive));
syncActive();

const style=document.createElement('style');
style.textContent=`
.mobile-menu-toggle{display:none;margin-left:auto;position:relative;gap:4px;align-content:center}
.mobile-menu-toggle span{display:block;width:18px;height:2px;background:currentColor;border-radius:2px;transition:transform 160ms ease,opacity 160ms ease}
.mobile-menu-toggle.open span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.mobile-menu-toggle.open span:nth-child(2){opacity:0}
.mobile-menu-toggle.open span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.mobile-menu{position:absolute;left:0;right:0;top:100%;border-bottom:1px solid var(--ig-line);background:var(--ig-header);backdrop-filter:blur(18px);box-shadow:var(--ig-shadow)}
.mobile-menu nav{display:grid;padding:10px var(--ig-gutter) 16px}
.mobile-menu button{position:relative;width:100%;border:0;border-bottom:1px solid var(--ig-line);background:transparent;color:var(--ig-text);padding:15px 2px;text-align:left;font-weight:700}
.mobile-menu button:last-child{border-bottom:0}
.mobile-menu button.active{color:var(--ig-rating)}
@media(max-width:760px){
  .site-header__inner{gap:10px}
  .mobile-menu-toggle{display:grid}
  .site-actions{margin-left:0}
  .site-logo{font-size:21px}
  body.mobile-menu-open{overflow:hidden}
}
`;
document.head.appendChild(style);

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const contentChunks=['2002-2015','2016-2017','2018-2019','2020','2021-2022','2023-2025'];
let canonicalCatalogPromise=null;

async function loadCanonicalCatalog(){
  if(canonicalCatalogPromise)return canonicalCatalogPromise;
  canonicalCatalogPromise=(async()=>{
    const stamp=Date.now();
    const [catalogResponse,popularResponse,...contentResponses]=await Promise.all([
      fetch(`data/catalog-visible.json?v=${stamp}`,{cache:'no-store'}),
      fetch(`data/popular/current.json?v=${stamp}`,{cache:'no-store'}).catch(()=>null),
      ...contentChunks.map(chunk=>fetch(`data/game-content/${chunk}.json?v=${stamp}`,{cache:'no-store'}).catch(()=>null))
    ]);
    if(!catalogResponse.ok)throw new Error(`Catalog HTTP ${catalogResponse.status}`);
    const catalog=await catalogResponse.json();
    const details=new Map();
    for(const response of contentResponses){
      if(!response?.ok)continue;
      const payload=await response.json();
      for(const [slug,game] of Object.entries(payload.games||{}))details.set(slug,game);
    }
    const popular=popularResponse?.ok?await popularResponse.json():{ranking:[]};
    const popularity=new Map();
    (popular.ranking||[]).forEach((item,index)=>{
      if(item.game_id)popularity.set(item.game_id,Math.max(1,1000-index));
      if(item.canonical_slug||item.slug)popularity.set(item.canonical_slug||item.slug,Math.max(1,1000-index));
    });
    return (catalog||[]).filter(item=>item?.game_id&&item?.slug).map(item=>{
      const detail=details.get(item.slug)||{};
      const appid=Number(detail.identity?.steam_appid)||null;
      const cover=detail.media?.cover||(appid?`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`:'');
      const rating=Number(detail.ratings?.igropoisk)||0;
      return {
        ...item,
        title:item.title||detail.identity?.title||item.slug,
        year:Number(item.year)||Number(String(detail.release?.date||detail.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0])||0,
        genres:detail.classification?.genres||[],
        platforms:detail.classification?.platforms||detail.requirements?.platforms||[],
        studio:detail.companies?.developers?.[0]||'',
        rating,
        popularity:popularity.get(item.game_id)||popularity.get(item.slug)||0,
        cover,
        description:detail.editorial?.short_description||detail.editorial?.integrated_description||''
      };
    });
  })();
  return canonicalCatalogPromise;
}

const gameRoute=slug=>`game/${encodeURIComponent(slug)}/`;
async function canonicalGameFromElement(element){
  const catalog=await loadCanonicalCatalog();
  const gameId=element?.dataset?.gameId||'';
  const slug=element?.dataset?.game||'';
  return catalog.find(item=>(gameId&&item.game_id===gameId)||(slug&&item.slug===slug))||null;
}

document.addEventListener('click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const target=event.target.closest?.('[data-game-id],[data-game]');
  if(!target)return;
  const game=await canonicalGameFromElement(target).catch(()=>null);
  if(!game)return;
  event.preventDefault();
  window.location.href=gameRoute(game.slug);
});

document.addEventListener('keydown',async event=>{
  if(event.key!=='Enter'&&event.key!==' ')return;
  const target=event.target.closest?.('[data-game-id],[data-game]');
  if(!target)return;
  const game=await canonicalGameFromElement(target).catch(()=>null);
  if(!game)return;
  event.preventDefault();
  window.location.href=gameRoute(game.slug);
});

async function installCanonicalSearch(){
  const results=document.querySelector('#results');
  const query=document.querySelector('#query');
  const sort=document.querySelector('#sort');
  const yearFrom=document.querySelector('#yearFrom');
  const yearTo=document.querySelector('#yearTo');
  const ratingFrom=document.querySelector('#ratingFrom');
  const ratingTo=document.querySelector('#ratingTo');
  const count=document.querySelector('#count');
  if(!results||!query||!sort||!yearFrom||!yearTo||!ratingFrom||!ratingTo||!count)return;

  let games;
  try{games=await loadCanonicalCatalog()}catch(error){console.warn('Игропоиск: canonical catalog unavailable',error);return}
  const all=selector=>[...document.querySelectorAll(selector)];
  const setRanges=()=>{
    if(+yearFrom.value>+yearTo.value){if(document.activeElement===yearFrom)yearTo.value=yearFrom.value;else yearFrom.value=yearTo.value}
    if(+ratingFrom.value>+ratingTo.value){if(document.activeElement===ratingFrom)ratingTo.value=ratingFrom.value;else ratingFrom.value=ratingTo.value}
    const yf=document.querySelector('#yearFromLabel'),yt=document.querySelector('#yearToLabel'),rf=document.querySelector('#ratingFromLabel'),rt=document.querySelector('#ratingToLabel');
    if(yf)yf.textContent=yearFrom.value;if(yt)yt.textContent=yearTo.value;if(rf)rf.textContent=(+ratingFrom.value).toFixed(1);if(rt)rt.textContent=(+ratingTo.value).toFixed(1);
  };
  const render=()=>{
    setRanges();
    const q=query.value.trim().toLowerCase();
    const selectedPlatforms=all('.f-platform:checked').map(input=>input.value);
    const selectedGenres=all('.f-genre:checked').map(input=>input.value);
    let list=games.filter(game=>{
      const haystack=`${game.title} ${game.studio} ${(game.genres||[]).join(' ')}`.toLowerCase();
      if(q&&!haystack.includes(q))return false;
      if(selectedPlatforms.length&&!selectedPlatforms.some(value=>(game.platforms||[]).includes(value)))return false;
      if(selectedGenres.length&&!selectedGenres.some(value=>(game.genres||[]).includes(value)))return false;
      if(game.year<+yearFrom.value||game.year>+yearTo.value)return false;
      if(game.rating<+ratingFrom.value||game.rating>+ratingTo.value)return false;
      return true;
    });
    list.sort((a,b)=>sort.value==='rating'?b.rating-a.rating:sort.value==='year'?b.year-a.year:sort.value==='title'?a.title.localeCompare(b.title,'ru'):b.popularity-a.popularity||b.rating-a.rating||a.title.localeCompare(b.title,'ru'));
    count.textContent=`Найдено игр: ${list.length}`;
    results.innerHTML=list.map(game=>`<article class="result" data-game-id="${esc(game.game_id)}" data-game="${esc(game.slug)}" tabindex="0" role="link"><img src="${esc(game.cover)}" alt="${esc(game.title)}" loading="lazy"><div class="result-copy"><h3>${esc(game.title)}</h3><div class="result-meta"><span class="pill">${esc(game.year||'—')}</span>${(game.genres||[]).slice(0,2).map(genre=>`<span class="pill">${esc(genre)}</span>`).join('')}${game.rating?`<span class="score">${game.rating.toFixed(1)}</span>`:''}</div>${game.description?`<p>${esc(game.description)}</p>`:''}</div></article>`).join('');
  };

  query.oninput=render;
  sort.onchange=render;
  for(const input of [yearFrom,yearTo,ratingFrom,ratingTo])input.oninput=render;
  for(const input of all('.f-platform,.f-genre'))input.onchange=render;
  const reset=document.querySelector('#resetFilters');
  if(reset)reset.onclick=()=>{
    query.value='';
    all('.f-platform,.f-genre').forEach(input=>{input.checked=false});
    yearFrom.value=yearFrom.min;yearTo.value=yearTo.max;ratingFrom.value=ratingFrom.min;ratingTo.value=ratingTo.max;sort.value='popularity';
    render();
  };
  render();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installCanonicalSearch,{once:true});
else installCanonicalSearch();
})();