(()=>{
  'use strict';

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
