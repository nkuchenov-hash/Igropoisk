(()=>{
  'use strict';

  const NEWS_QUERY_KEYS=['page','game','type','story','view'];
  const NON_NEWS_PAGES=new Set(['home','what-to-play','search']);
  const SEARCH_YEAR_MIN=1947;

  function explicitPageFromHash(){
    const page=decodeURIComponent(window.location.hash.replace(/^#/,''));
    return NON_NEWS_PAGES.has(page)||page==='news'?page:'';
  }

  function clearNewsRouteState(page){
    if(!NON_NEWS_PAGES.has(page))return;
    const url=new URL(window.location.href);
    const hasNewsState=url.searchParams.get('page')==='news'
      ||url.searchParams.has('game')
      ||url.searchParams.has('type')
      ||url.searchParams.has('story')
      ||url.searchParams.has('view');
    if(!hasNewsState)return;
    NEWS_QUERY_KEYS.forEach(key=>url.searchParams.delete(key));
    url.hash=page==='home'?'':encodeURIComponent(page);
    window.history.replaceState(window.history.state,'',url);
  }

  function cleanExplicitNonNewsRoute(){
    const page=explicitPageFromHash();
    if(page&&page!=='news')clearNewsRouteState(page);
  }

  // News filters are query parameters, while the main SPA section is a hash.
  // Once the user leaves News, the news-only query state must not survive and
  // reopen News on the next reload.
  cleanExplicitNonNewsRoute();
  document.addEventListener('click',event=>{
    const pageButton=event.target.closest?.('[data-page]');
    const page=pageButton?.dataset?.page||'';
    if(!NON_NEWS_PAGES.has(page))return;
    queueMicrotask(()=>clearNewsRouteState(page));
  });
  window.addEventListener('hashchange',cleanExplicitNonNewsRoute);
  window.addEventListener('popstate',cleanExplicitNonNewsRoute);

  // The enhanced search uses a native <datalist>, which browsers render as a
  // large white dropdown. Search-page.js builds the field synchronously before
  // this file runs, so one direct detach is enough; no broad DOM observer needed.
  function disableGameSearchDropdown(){
    document.querySelector('#search #query')?.removeAttribute('list');
  }

  function clampYear(value,max){
    const year=Number(value);
    if(!Number.isFinite(year))return SEARCH_YEAR_MIN;
    return Math.min(max,Math.max(SEARCH_YEAR_MIN,Math.round(year)));
  }

  function syncHistoricalYearControls(){
    const from=document.querySelector('#search #yearFrom');
    const to=document.querySelector('#search #yearTo');
    if(!from||!to)return;

    const previousMin=Number(from.min)||SEARCH_YEAR_MIN;
    const currentFrom=Number(from.value)||previousMin;
    const wasAtPreviousFloor=currentFrom<=previousMin;
    const maxYear=Math.max(Number(from.max)||0,Number(to.max)||0,new Date().getFullYear());

    if(from.min!==String(SEARCH_YEAR_MIN))from.min=String(SEARCH_YEAR_MIN);
    if(to.min!==String(SEARCH_YEAR_MIN))to.min=String(SEARCH_YEAR_MIN);
    if(wasAtPreviousFloor&&previousMin>SEARCH_YEAR_MIN)from.value=String(SEARCH_YEAR_MIN);
    if(Number(from.value)<SEARCH_YEAR_MIN)from.value=String(SEARCH_YEAR_MIN);
    if(Number(to.value)<SEARCH_YEAR_MIN)to.value=String(SEARCH_YEAR_MIN);

    const section=from.closest('.filter-section');
    if(!section)return;

    let exact=section.querySelector('.year-range-inputs');
    if(!exact){
      exact=document.createElement('div');
      exact.className='range-inputs year-range-inputs';
      exact.innerHTML='<label>от <input class="ig-input ig-input--number" id="yearFromNumber" type="number" step="1" inputmode="numeric" aria-label="Точный год от"></label><label>до <input class="ig-input ig-input--number" id="yearToNumber" type="number" step="1" inputmode="numeric" aria-label="Точный год до"></label>';
      section.querySelector('.range-values')?.before(exact);
    }

    const fromNumber=section.querySelector('#yearFromNumber');
    const toNumber=section.querySelector('#yearToNumber');
    if(!fromNumber||!toNumber)return;
    [fromNumber,toNumber].forEach(input=>{input.min=String(SEARCH_YEAR_MIN);input.max=String(maxYear)});

    const syncNumbers=()=>{
      fromNumber.value=String(clampYear(from.value,maxYear));
      toNumber.value=String(clampYear(to.value,maxYear));
      const fromLabel=section.querySelector('#yearFromLabel');
      const toLabel=section.querySelector('#yearToLabel');
      if(fromLabel)fromLabel.textContent=fromNumber.value;
      if(toLabel)toLabel.textContent=toNumber.value;
    };

    const applyExact=(numberInput,rangeInput)=>{
      const value=clampYear(numberInput.value,maxYear);
      numberInput.value=String(value);
      rangeInput.value=String(value);
      rangeInput.dispatchEvent(new Event('input',{bubbles:true}));
    };

    if(!exact.dataset.bound){
      exact.dataset.bound='true';
      fromNumber.addEventListener('input',()=>{if(/^\d{4}$/.test(fromNumber.value))applyExact(fromNumber,from)});
      toNumber.addEventListener('input',()=>{if(/^\d{4}$/.test(toNumber.value))applyExact(toNumber,to)});
      fromNumber.addEventListener('change',()=>applyExact(fromNumber,from));
      toNumber.addEventListener('change',()=>applyExact(toNumber,to));
      from.addEventListener('input',syncNumbers);
      to.addEventListener('input',syncNumbers);
      document.querySelector('#search #resetFilters')?.addEventListener('click',()=>queueMicrotask(()=>{syncHistoricalYearControls();syncNumbers()}));
    }
    syncNumbers();
  }

  function bindHistoricalYearGuard(){
    syncHistoricalYearControls();
    const from=document.querySelector('#search #yearFrom');
    const to=document.querySelector('#search #yearTo');
    if(!from||!to)return;

    // Catalog loading can replace min/max after initial render. Observe only
    // those two range attributes. The callback never watches its own text/DOM
    // updates, so it cannot create the CPU loop caused by the previous broad observer.
    const observer=new MutationObserver(()=>syncHistoricalYearControls());
    observer.observe(from,{attributes:true,attributeFilter:['min','max']});
    observer.observe(to,{attributes:true,attributeFilter:['min','max']});
  }

  const arx = {
    slug:'arx-fatalis',
    title:'Arx Fatalis',
    year:2002,
    genres:['RPG','Immersive sim','Фэнтези'],
    studio:'Arkane Studios',
    rating:7.6,
    cover:'https://cdn.cloudflare.steamstatic.com/steam/apps/1700/library_600x900.jpg',
    desc:'Мрачная подземная RPG от Arkane с рисуемой мышью магией, свободным исследованием и системным взаимодействием с миром.'
  };

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function renderArxIfNeeded(){
    const query=document.querySelector('#query');
    const results=document.querySelector('#results');
    const count=document.querySelector('#count');
    if(!query||!results||!count)return;
    const value=query.value.trim().toLowerCase();
    if(!value||!['arx','arx fatalis','fatalis'].some(token=>token.includes(value)||value.includes(token)))return;
    const platformFilters=[...document.querySelectorAll('.f-platform:checked')].map(input=>input.value);
    const genreFilters=[...document.querySelectorAll('.f-genre:checked')].map(input=>input.value);
    const yearFrom=Number(document.querySelector('#yearFrom')?.value||0);
    const yearTo=Number(document.querySelector('#yearTo')?.value||9999);
    const ratingFrom=Number(document.querySelector('#ratingFrom')?.value||0);
    const ratingTo=Number(document.querySelector('#ratingTo')?.value||10);
    const platformMatch=!platformFilters.length||platformFilters.includes('PC');
    const genreMatch=!genreFilters.length||genreFilters.some(genre=>arx.genres.includes(genre));
    const visible=platformMatch&&genreMatch&&arx.year>=Math.min(yearFrom,yearTo)&&arx.year<=Math.max(yearFrom,yearTo)&&arx.rating>=Math.min(ratingFrom,ratingTo)&&arx.rating<=Math.max(ratingFrom,ratingTo);
    if(!visible)return;
    count.textContent='Найдено игр: 1';
    results.innerHTML=`<article class="result" data-game="${arx.slug}"><div class="result-media"><img src="${arx.cover}" alt="${esc(arx.title)}" loading="eager"></div><div><h3>${esc(arx.title)}</h3><div class="result-meta"><span class="ig-pill">${arx.year}</span><span class="ig-pill">RPG</span><span class="ig-pill">Immersive sim</span></div><p>${esc(arx.desc)}</p><small class="ig-muted">${esc(arx.studio)}</small></div><div class="metric"><small>Игропоиск</small><div class="bigscore">${arx.rating.toFixed(1)}</div></div></article>`;
  }

  function bind(){
    disableGameSearchDropdown();
    bindHistoricalYearGuard();
    const query=document.querySelector('#query');
    if(!query)return;
    ['input','change'].forEach(type=>document.addEventListener(type,event=>{
      if(event.target.matches('#query,#sort,#yearFrom,#yearTo,#ratingFrom,#ratingTo,.f-platform,.f-genre'))queueMicrotask(renderArxIfNeeded);
    }));
    setTimeout(renderArxIfNeeded,300);
    setTimeout(renderArxIfNeeded,1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
