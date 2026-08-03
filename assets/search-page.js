(()=>{
'use strict';

window.IgropoiskEnhancedSearch=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const formatNumber=value=>new Intl.NumberFormat('ru-RU',{notation:value>=100000?'compact':'standard',maximumFractionDigits:1}).format(value);

const featured=[
  {slug:'elden-ring',title:'Elden Ring',year:2022,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'FromSoftware',rating:9.6,userRating:9.4,votes:112000,pop:9691,desc:'Большое фэнтезийное приключение в открытом мире.',appid:1245620,editorChoice:true},
  {slug:'baldurs-gate-3',title:'Baldur’s Gate 3',year:2023,genres:['RPG','Стратегия'],platforms:['PC','PlayStation','Xbox'],studio:'Larian Studios',rating:9.5,userRating:9.2,votes:98000,pop:9230,desc:'Ролевая игра с глубокой реактивностью мира и тактическими боями.',appid:1086940},
  {slug:'red-dead-redemption-2',title:'Red Dead Redemption 2',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Rockstar Games',rating:9.4,userRating:9.1,votes:75000,pop:8810,desc:'История о закате эпохи Дикого Запада в огромном живом мире.',appid:1174180},
  {slug:'the-witcher-3-wild-hunt',title:'The Witcher 3: Wild Hunt',year:2015,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:9.3,userRating:9.0,votes:211000,pop:8500,desc:'Большое приключение Геральта с сильными героями и сложными решениями.',appid:292030},
  {slug:'cyberpunk-2077',title:'Cyberpunk 2077',year:2020,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:8.8,userRating:8.3,votes:166000,pop:7900,desc:'Футуристическая ролевая игра о наёмнике Ви и Найт-Сити.',appid:1091500},
  {slug:'god-of-war',title:'God of War',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation'],studio:'Santa Monica Studio',rating:9.2,userRating:9.1,votes:84000,pop:7600,desc:'Камерное путешествие Кратоса и Атрея по миру северных мифов.',appid:1593500},
  {slug:'hades',title:'Hades',year:2020,genres:['Экшен','RPG'],platforms:['PC','PlayStation','Xbox'],studio:'Supergiant Games',rating:9.2,userRating:9.0,votes:67000,pop:7100,desc:'Динамичный рогалик, где каждая смерть продолжает историю.',appid:1145360},
  {slug:'forza-horizon-5',title:'Forza Horizon 5',year:2021,genres:['Гонки'],platforms:['PC','Xbox'],studio:'Playground Games',rating:8.8,userRating:8.5,votes:51000,pop:6400,desc:'Автомобильный фестиваль в открытом мире Мексики.',appid:1551360},
  {slug:'helldivers-2',title:'Helldivers 2',year:2024,genres:['Шутер','Экшен'],platforms:['PC','PlayStation'],studio:'Arrowhead Game Studios',rating:8.7,userRating:8.4,votes:47000,pop:6200,desc:'Кооперативный шутер о хаотичных операциях Супер-Земли.',appid:553850},
  {slug:'hogwarts-legacy',title:'Hogwarts Legacy',year:2023,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Avalanche Software',rating:8.4,userRating:8.1,votes:93000,pop:5900,desc:'Приключение в открытом мире школы чародейства и волшебства.',appid:990080}
].map(game=>({...game,cover:`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`}));
const featuredBySlug=new Map(featured.map(game=>[game.slug,game]));

let catalog=[...featured];
let selectedGenres=new Set(['RPG','Экшен']);
let resultView='list';

const markup=`
<div class="ig-container search-shell">
  <div class="search-layout search-layout--enhanced">
    <aside class="filters search-filters" id="filters" aria-label="Фильтры каталога">
      <button class="search-reset" id="resetFilters" type="button"><span aria-hidden="true">↶</span> Сбросить фильтры</button>
      <section class="filter-section"><h3>Платформа</h3>
        <label class="filter-option"><span><input class="f-platform" type="checkbox" value="PC" checked><b class="platform-mark">PC</b> PC</span><em data-platform-count="PC">0</em></label>
        <label class="filter-option"><span><input class="f-platform" type="checkbox" value="PlayStation"><b class="platform-mark">PS</b> PlayStation</span><em data-platform-count="PlayStation">0</em></label>
        <label class="filter-option"><span><input class="f-platform" type="checkbox" value="Xbox"><b class="platform-mark">XB</b> Xbox</span><em data-platform-count="Xbox">0</em></label>
        <label class="filter-option"><span><input class="f-platform" type="checkbox" value="Nintendo Switch"><b class="platform-mark">NS</b> Nintendo Switch</span><em data-platform-count="Nintendo Switch">0</em></label>
      </section>
      <section class="filter-section"><h3>Жанр</h3><select class="filter-select" id="genreSelect" aria-label="Добавить жанр"><option value="">Выбрать жанры</option><option>RPG</option><option>Экшен</option><option>Стратегия</option><option>Приключения</option><option>Шутер</option><option>Хоррор</option><option>Гонки</option></select><div class="selected-genres" id="selectedGenres"></div></section>
      <section class="filter-section range-block"><h3>Год выхода</h3><div class="range-values"><span id="yearFromLabel">2000</span><b id="yearToLabel">2026</b></div><div class="dual-range"><input id="yearFrom" type="range" min="2000" max="2026" value="2000"><input id="yearTo" type="range" min="2000" max="2026" value="2026"></div></section>
      <section class="filter-section range-block"><h3>Рейтинг Игропоиска</h3><div class="range-inputs"><label>от <input id="ratingFromNumber" type="number" min="0" max="10" step=".1" value="0"></label><label>до <input id="ratingToNumber" type="number" min="0" max="10" step=".1" value="10"></label></div><div class="range-values"><span id="ratingFromLabel">0.0</span><b id="ratingToLabel">10.0</b></div><div class="dual-range"><input id="ratingFrom" type="range" min="0" max="10" step=".1" value="0"><input id="ratingTo" type="range" min="0" max="10" step=".1" value="10"></div></section>
      <section class="filter-section range-block"><h3>Оценка пользователей</h3><div class="range-inputs"><label>от <input id="userRatingFromNumber" type="number" min="0" max="10" step=".1" value="0"></label><label>до <input id="userRatingToNumber" type="number" min="0" max="10" step=".1" value="10"></label></div><div class="range-values"><span id="userRatingFromLabel">0.0</span><b id="userRatingToLabel">10.0</b></div><div class="dual-range"><input id="userRatingFrom" type="range" min="0" max="10" step=".1" value="0"><input id="userRatingTo" type="range" min="0" max="10" step=".1" value="10"></div></section>
      <button class="search-apply" id="applyFilters" type="button">Показать <span id="applyCount">0</span> игр</button>
    </aside>
    <section class="search-main">
      <header class="search-title-row"><div><h1>Поиск игр</h1><p class="results-count" id="count">Найдено игр: 0</p></div><button class="ig-button filter-toggle" id="filterToggle" type="button">Фильтры</button></header>
      <label class="search-query"><input id="query" type="search" placeholder="Название игры, жанр или студия"><span aria-hidden="true">⌕</span></label>
      <div class="search-toolbar"><div class="quick-filters" aria-label="Быстрые фильтры">
        <select id="quickPlatform" aria-label="Платформа"><option value="">Платформа</option><option>PC</option><option>PlayStation</option><option>Xbox</option><option>Nintendo Switch</option></select>
        <select id="quickGenre" aria-label="Жанр"><option value="">Жанр</option><option>RPG</option><option>Экшен</option><option>Стратегия</option><option>Приключения</option><option>Шутер</option><option>Хоррор</option><option>Гонки</option></select>
        <select id="quickYear" aria-label="Год выхода"><option value="">Год выхода</option><option value="2024">2024+</option><option value="2020">2020+</option><option value="2015">2015+</option></select>
        <select id="quickRating" aria-label="Оценка"><option value="">Оценка</option><option value="9">9.0+</option><option value="8">8.0+</option><option value="7">7.0+</option></select>
        <select id="quickPrice" aria-label="Цена" title="Фильтр заработает после добавления цен в каталог"><option value="">Цена</option><option disabled>Нужны данные каталога</option></select>
        <select id="quickLanguage" aria-label="Язык" title="Фильтр заработает после добавления языков в каталог"><option value="">Язык</option><option disabled>Нужны данные каталога</option></select>
      </div><div class="search-view-tools"><select id="sort" aria-label="Сортировка"><option value="popularity">Сортировка: По популярности</option><option value="rating">По рейтингу редакции</option><option value="users">По оценке игроков</option><option value="year">По году</option><option value="title">По названию</option></select><div class="view-switch" aria-label="Вид результатов"><button type="button" data-view="grid" aria-label="Плитка">▦</button><button class="active" type="button" data-view="list" aria-label="Список">☷</button></div></div></div>
      <div class="search-results" id="results" data-view="list"></div>
    </section>
    <aside class="search-right-rail" aria-label="Подсказки поиска">
      <section class="search-side-card search-tip-card"><h3>Как искать точнее</h3><p>Используйте фильтры слева, чтобы уточнить результаты по платформе, жанру, году выхода и рейтингу.</p><div class="search-tip-mark" aria-hidden="true">⌁</div></section>
      <section class="search-side-card"><h3>Подбор без фильтров</h3><p>Не знаете, во что поиграть? Помощник задаст несколько вопросов и подберёт игры по вашим предпочтениям.</p><button class="search-side-action" type="button" data-page="what-to-play">Подобрать игру</button></section>
      <section class="search-side-card search-factors"><h3>Учитываем</h3><ul><li><span>☆</span> рейтинг редакции</li><li><span>♧</span> оценки игроков</li><li><span>↗</span> популярность</li><li><span>◷</span> свежесть обзоров</li></ul></section>
    </aside>
  </div>
</div>`;

const searchPage=document.querySelector('#search');
if(!searchPage)return;
searchPage.innerHTML=markup;

function initials(title){return title.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()}
function platformCode(platform){return({PC:'PC',PlayStation:'PS',Xbox:'XB','Nintendo Switch':'NS'}[platform]||platform.slice(0,2).toUpperCase())}
function visibleScore(value){return Number.isFinite(Number(value))&&Number(value)>0?Number(value).toFixed(1):'—'}
function getRange(fromSelector,toSelector){let from=Number($(fromSelector).value),to=Number($(toSelector).value);if(from>to)[from,to]=[to,from];return[from,to]}
function syncRangePair(rangeFrom,rangeTo,numberFrom,numberTo,labelFrom,labelTo){const[from,to]=getRange(rangeFrom,rangeTo);$(rangeFrom).value=from;$(rangeTo).value=to;if(numberFrom)$(numberFrom).value=from;if(numberTo)$(numberTo).value=to;$(labelFrom).textContent=Number(from).toFixed(rangeFrom.includes('year')?0:1);$(labelTo).textContent=Number(to).toFixed(rangeTo.includes('year')?0:1)}
function renderGenreChips(){const target=$('#selectedGenres');target.innerHTML=[...selectedGenres].map(genre=>`<button type="button" data-remove-genre="${escapeHtml(genre)}">${escapeHtml(genre)} <span>×</span></button>`).join('')+'<button class="genre-add" type="button" data-open-genre aria-label="Добавить жанр">+</button>'}
function updateCounts(){['PC','PlayStation','Xbox','Nintendo Switch'].forEach(platform=>{const count=catalog.filter(game=>(game.platforms||[]).includes(platform)).length;const node=$(`[data-platform-count="${platform}"]`);if(node)node.textContent=count})}

function filteredCatalog(){
  const query=$('#query').value.trim().toLowerCase();
  const platforms=$$('.f-platform:checked').map(input=>input.value);
  const[yearFrom,yearTo]=getRange('#yearFrom','#yearTo');
  const[ratingFrom,ratingTo]=getRange('#ratingFrom','#ratingTo');
  const[userFrom,userTo]=getRange('#userRatingFrom','#userRatingTo');
  const quickPlatform=$('#quickPlatform').value,quickGenre=$('#quickGenre').value,quickYear=Number($('#quickYear').value||0),quickRating=Number($('#quickRating').value||0);
  const filtered=catalog.filter(game=>{
    const gamePlatforms=game.platforms||[],gameGenres=game.genres||[],rating=Number(game.rating||0),userRating=Number(game.userRating||0),haystack=[game.title,game.studio||'',...gameGenres].join(' ').toLowerCase();
    const platformMatch=!platforms.length||!gamePlatforms.length||platforms.some(platform=>gamePlatforms.includes(platform));
    const genresMatch=!selectedGenres.size||!gameGenres.length||[...selectedGenres].some(genre=>gameGenres.includes(genre));
    return(!query||haystack.includes(query))&&platformMatch&&genresMatch&&(!quickPlatform||!gamePlatforms.length||gamePlatforms.includes(quickPlatform))&&(!quickGenre||!gameGenres.length||gameGenres.includes(quickGenre))&&game.year>=yearFrom&&game.year<=yearTo&&(!quickYear||game.year>=quickYear)&&(!rating||rating>=ratingFrom&&rating<=ratingTo)&&(!userRating||userRating>=userFrom&&userRating<=userTo)&&(!quickRating||rating>=quickRating);
  });
  const sort=$('#sort').value;
  filtered.sort((a,b)=>sort==='rating'?(b.rating||0)-(a.rating||0):sort==='users'?(b.userRating||0)-(a.userRating||0):sort==='year'?b.year-a.year:sort==='title'?a.title.localeCompare(b.title,'ru'):(b.pop||b.year||0)-(a.pop||a.year||0));
  return filtered;
}

function resultCard(game,index){
  const media=game.cover?`<img src="${escapeHtml(game.cover)}" alt="${escapeHtml(game.title)}" loading="${index<4?'eager':'lazy'}" decoding="async">`:`<div class="result-placeholder">${escapeHtml(initials(game.title))}</div>`;
  const pills=[game.year,...(game.genres||[]).slice(0,2)].map(value=>`<span>${escapeHtml(value)}</span>`).join('');
  const platformMarks=(game.platforms||[]).map(platform=>`<b title="${escapeHtml(platform)}">${escapeHtml(platformCode(platform))}</b>`).join('');
  return `<article class="search-result-card" data-game="${escapeHtml(game.slug)}"><div class="result-accent" aria-hidden="true"></div><div class="result-media">${media}</div><div class="result-copy"><div class="result-title-line"><h3>${escapeHtml(game.title)}</h3>${game.editorChoice?'<span class="editor-choice">★ выбор редакции</span>':''}</div><div class="result-meta">${pills}</div>${game.desc?`<p>${escapeHtml(game.desc)}</p>`:''}${game.studio?`<small>${escapeHtml(game.studio)}</small>`:''}${platformMarks?`<div class="result-platforms">${platformMarks}</div>`:''}</div><div class="result-scores"><div><small>Игропоиск</small><strong>${visibleScore(game.rating)}</strong>${game.votes?`<span>${formatNumber(game.votes)} оценок</span>`:''}</div><div><small>Оценка игроков</small><strong class="user-score">${visibleScore(game.userRating)}</strong></div></div><button class="result-bookmark" type="button" aria-label="Добавить ${escapeHtml(game.title)} в закладки" aria-pressed="false">⌑</button></article>`;
}
function renderResults(){syncRangePair('#yearFrom','#yearTo',null,null,'#yearFromLabel','#yearToLabel');syncRangePair('#ratingFrom','#ratingTo','#ratingFromNumber','#ratingToNumber','#ratingFromLabel','#ratingToLabel');syncRangePair('#userRatingFrom','#userRatingTo','#userRatingFromNumber','#userRatingToNumber','#userRatingFromLabel','#userRatingToLabel');const filtered=filteredCatalog();$('#count').textContent=`Найдено игр: ${filtered.length}`;$('#applyCount').textContent=filtered.length;const target=$('#results');target.dataset.view=resultView;target.innerHTML=filtered.length?filtered.map(resultCard).join(''):'<div class="empty">По выбранным условиям игр нет.</div>'}
function bindRange(rangeFrom,rangeTo,numberFrom,numberTo){[rangeFrom,rangeTo].forEach(selector=>$(selector).addEventListener('input',renderResults));if(numberFrom)$(numberFrom).addEventListener('input',()=>{$(rangeFrom).value=$(numberFrom).value;renderResults()});if(numberTo)$(numberTo).addEventListener('input',()=>{$(rangeTo).value=$(numberTo).value;renderResults()})}
function resetFilters(){$$('.f-platform').forEach(input=>{input.checked=input.value==='PC'});selectedGenres=new Set(['RPG','Экшен']);$('#genreSelect').value='';$('#yearFrom').value=$('#yearFrom').min;$('#yearTo').value=2026;$('#ratingFrom').value=0;$('#ratingTo').value=10;$('#userRatingFrom').value=0;$('#userRatingTo').value=10;$('#query').value='';['#quickPlatform','#quickGenre','#quickYear','#quickRating','#quickPrice','#quickLanguage'].forEach(selector=>$(selector).value='');$('#sort').value='popularity';renderGenreChips();renderResults()}
function bind(){
  $('#query').addEventListener('input',renderResults);$$('.f-platform').forEach(input=>input.addEventListener('input',renderResults));['#quickPlatform','#quickGenre','#quickYear','#quickRating','#sort'].forEach(selector=>$(selector).addEventListener('change',renderResults));bindRange('#yearFrom','#yearTo');bindRange('#ratingFrom','#ratingTo','#ratingFromNumber','#ratingToNumber');bindRange('#userRatingFrom','#userRatingTo','#userRatingFromNumber','#userRatingToNumber');
  $('#genreSelect').addEventListener('change',event=>{if(event.target.value){selectedGenres.add(event.target.value);event.target.value='';renderGenreChips();renderResults()}});
  $('#selectedGenres').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-genre]');if(remove){selectedGenres.delete(remove.dataset.removeGenre);renderGenreChips();renderResults();return}if(event.target.closest('[data-open-genre]'))$('#genreSelect').focus()});
  $('#resetFilters').addEventListener('click',resetFilters);$('#applyFilters').addEventListener('click',()=>{$('#filters').classList.remove('open');$('#results').scrollIntoView({behavior:'smooth',block:'start'})});$('#filterToggle').addEventListener('click',()=>$('#filters').classList.toggle('open'));
  $$('.view-switch button').forEach(button=>button.addEventListener('click',()=>{resultView=button.dataset.view;$$('.view-switch button').forEach(item=>item.classList.toggle('active',item===button));renderResults()}));
  $('#results').addEventListener('click',event=>{const bookmark=event.target.closest('.result-bookmark');if(bookmark){event.preventDefault();event.stopPropagation();const active=bookmark.getAttribute('aria-pressed')==='true';bookmark.setAttribute('aria-pressed',String(!active))}});
}
async function loadCatalog(){try{const response=await fetch(`data/catalog-visible.json?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`Catalog HTTP ${response.status}`);const visible=await response.json();catalog=visible.map(item=>featuredBySlug.get(item.slug)||{...item,genres:[],platforms:[],studio:'',rating:0,userRating:0,votes:0,pop:item.year,desc:''})}catch(error){console.warn('Игропоиск: search catalog unavailable',error);catalog=[...featured]}const years=catalog.map(game=>Number(game.year)).filter(Number.isFinite);const minYear=Math.min(...years,2000);$('#yearFrom').min=minYear;$('#yearFrom').value=minYear;updateCounts();renderResults()}
renderGenreChips();bind();renderResults();loadCatalog();
})();
