(()=>{
'use strict';

if (window.IgropoiskEnhancedSearch) return;
window.IgropoiskEnhancedSearch=true;

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatNumber=value=>new Intl.NumberFormat('ru-RU',{notation:Number(value)>=100000?'compact':'standard',maximumFractionDigits:1}).format(Number(value)||0);
const CORE_GENRES=['RPG','Экшен','Стратегия','Приключения','Шутер','Хоррор','Гонки'];
const CONTENT_SHARDS=['2002-2015.json','2016-2017.json','2018-2019.json','2020.json','2021-2022.json','2023-2025.json'];

const featured=[
  {slug:'elden-ring',title:'Elden Ring',year:2022,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'FromSoftware',rating:9.6,pop:9691,desc:'Большое фэнтезийное приключение в открытом мире.',appid:1245620,editorChoice:true},
  {slug:'baldurs-gate-3',title:'Baldur’s Gate 3',year:2023,genres:['RPG','Стратегия'],platforms:['PC','PlayStation','Xbox'],studio:'Larian Studios',rating:9.5,pop:9230,desc:'Ролевая игра с глубокой реактивностью мира и тактическими боями.',appid:1086940},
  {slug:'red-dead-redemption-2',title:'Red Dead Redemption 2',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Rockstar Games',rating:9.4,pop:8810,desc:'История о закате эпохи Дикого Запада в огромном живом мире.',appid:1174180},
  {slug:'the-witcher-3-wild-hunt',title:'The Witcher 3: Wild Hunt',year:2015,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:9.3,pop:8500,desc:'Большое приключение Геральта с сильными героями и сложными решениями.',appid:292030},
  {slug:'cyberpunk-2077',title:'Cyberpunk 2077',year:2020,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:8.9,pop:7900,desc:'Футуристическая ролевая игра о наёмнике Ви и Найт-Сити.',appid:1091500},
  {slug:'god-of-war',title:'God of War',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation'],studio:'Santa Monica Studio',rating:9.2,pop:7600,desc:'Камерное путешествие Кратоса и Атрея по миру северных мифов.',appid:1593500},
  {slug:'hades',title:'Hades',year:2020,genres:['Экшен','RPG'],platforms:['PC','PlayStation','Xbox','Nintendo Switch'],studio:'Supergiant Games',rating:9.3,pop:7100,desc:'Динамичный рогалик, где каждая смерть продолжает историю.',appid:1145360},
  {slug:'forza-horizon-5',title:'Forza Horizon 5',year:2021,genres:['Гонки'],platforms:['PC','Xbox'],studio:'Playground Games',rating:8.8,pop:6400,desc:'Автомобильный фестиваль в открытом мире Мексики.',appid:1551360},
  {slug:'helldivers-2',title:'Helldivers 2',year:2024,genres:['Шутер','Экшен'],platforms:['PC','PlayStation'],studio:'Arrowhead Game Studios',rating:8.7,pop:6200,desc:'Кооперативный шутер о хаотичных операциях Супер-Земли.',appid:553850},
  {slug:'hogwarts-legacy',title:'Hogwarts Legacy',year:2023,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Avalanche Software',rating:8.4,pop:5900,desc:'Приключение в открытом мире школы чародейства и волшебства.',appid:990080}
].map(game=>({...game,cover:`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`}));
const featuredBySlug=new Map(featured.map(game=>[game.slug,game]));

let catalog=[...featured];
let resultView='list';

const genreMarkup=CORE_GENRES.map(genre=>`<label class="genre-option"><input class="ig-input ig-input--check f-genre" type="checkbox" value="${escapeHtml(genre)}"><span>${escapeHtml(genre)}</span><em data-genre-count="${escapeHtml(genre)}">0</em></label>`).join('');
const markup=`
<div class="ig-container search-shell">
  <div class="search-layout search-layout--enhanced">
    <aside class="filters search-filters ig-search-filter-panel" id="filters" aria-label="Фильтры каталога">
      <button class="ig-button search-reset" id="resetFilters" type="button"><span aria-hidden="true">↶</span> Сбросить фильтры</button>
      <section class="filter-section"><h3>Платформа</h3>
        <label class="filter-option"><span><input class="ig-input ig-input--check f-platform" type="checkbox" value="PC"><b class="platform-mark">PC</b> PC</span><em data-platform-count="PC">0</em></label>
        <label class="filter-option"><span><input class="ig-input ig-input--check f-platform" type="checkbox" value="PlayStation"><b class="platform-mark">PS</b> PlayStation</span><em data-platform-count="PlayStation">0</em></label>
        <label class="filter-option"><span><input class="ig-input ig-input--check f-platform" type="checkbox" value="Xbox"><b class="platform-mark">XB</b> Xbox</span><em data-platform-count="Xbox">0</em></label>
        <label class="filter-option"><span><input class="ig-input ig-input--check f-platform" type="checkbox" value="Nintendo Switch"><b class="platform-mark">NS</b> Nintendo Switch</span><em data-platform-count="Nintendo Switch">0</em></label>
      </section>
      <section class="filter-section"><h3>Жанры</h3><div class="genre-options" id="genreOptions">${genreMarkup}</div></section>
      <section class="filter-section range-block"><h3>Год выхода</h3><div class="range-values"><span id="yearFromLabel">2000</span><b id="yearToLabel">2026</b></div><div class="dual-range"><input class="ig-input ig-input--range" id="yearFrom" type="range" min="2000" max="2026" value="2000" aria-label="Год от"><input class="ig-input ig-input--range" id="yearTo" type="range" min="2000" max="2026" value="2026" aria-label="Год до"></div></section>
      <section class="filter-section range-block"><h3>Рейтинг Игропоиска</h3><div class="range-inputs"><label>от <input class="ig-input ig-input--number" id="ratingFromNumber" type="number" min="0" max="10" step=".1" value="0"></label><label>до <input class="ig-input ig-input--number" id="ratingToNumber" type="number" min="0" max="10" step=".1" value="10"></label></div><div class="range-values"><span id="ratingFromLabel">0.0</span><b id="ratingToLabel">10.0</b></div><div class="dual-range"><input class="ig-input ig-input--range" id="ratingFrom" type="range" min="0" max="10" step=".1" value="0" aria-label="Рейтинг от"><input class="ig-input ig-input--range" id="ratingTo" type="range" min="0" max="10" step=".1" value="10" aria-label="Рейтинг до"></div></section>
      <section class="filter-section range-block"><h3>Оценка пользователей</h3><div class="range-inputs"><label>от <input class="ig-input ig-input--number" id="userRatingFromNumber" type="number" min="0" max="10" step=".1" value="0"></label><label>до <input class="ig-input ig-input--number" id="userRatingToNumber" type="number" min="0" max="10" step=".1" value="10"></label></div><div class="range-values"><span id="userRatingFromLabel">0.0</span><b id="userRatingToLabel">10.0</b></div><div class="dual-range"><input class="ig-input ig-input--range" id="userRatingFrom" type="range" min="0" max="10" step=".1" value="0" aria-label="Оценка пользователей от"><input class="ig-input ig-input--range" id="userRatingTo" type="range" min="0" max="10" step=".1" value="10" aria-label="Оценка пользователей до"></div></section>
      <button class="ig-button ig-button--accent search-apply" id="applyFilters" type="button">Показать <span id="applyCount">0</span> игр</button>
    </aside>
    <section class="search-main">
      <header class="search-title-row"><div><h1>Поиск игр</h1><p class="results-count" id="count">Найдено игр: 0</p></div><button class="ig-button filter-toggle" id="filterToggle" type="button">Фильтры</button></header>
      <label class="search-query"><input class="ig-input ig-input--search" id="query" type="search" list="gameSearchSuggestions" autocomplete="off" placeholder="Начните вводить название игры — варианты появятся сразу"><span aria-hidden="true">⌕</span></label>
      <datalist id="gameSearchSuggestions"></datalist>
      <p class="search-help">Живой поиск работает по названию, студии и жанрам.</p>
      <div class="ig-toolbar search-toolbar"><div class="quick-filters" aria-label="Быстрые фильтры">
        <select class="ig-input ig-input--select" id="quickPlatform" aria-label="Платформа"><option value="">Платформа</option><option>PC</option><option>PlayStation</option><option>Xbox</option><option>Nintendo Switch</option></select>
        <select class="ig-input ig-input--select" id="quickGenre" aria-label="Жанр"><option value="">Жанр</option>${CORE_GENRES.map(genre=>`<option>${escapeHtml(genre)}</option>`).join('')}</select>
        <select class="ig-input ig-input--select" id="quickYear" aria-label="Год выхода"><option value="">Год выхода</option><option value="2024">2024+</option><option value="2020">2020+</option><option value="2015">2015+</option></select>
        <select class="ig-input ig-input--select" id="quickRating" aria-label="Оценка"><option value="">Оценка</option><option value="9">9.0+</option><option value="8">8.0+</option><option value="7">7.0+</option></select>
      </div><div class="search-view-tools"><select class="ig-input ig-input--select" id="sort" aria-label="Сортировка"><option value="popularity">Сортировка: По популярности</option><option value="rating">По рейтингу редакции</option><option value="users">По оценке игроков</option><option value="year">По году</option><option value="title">По названию</option></select><div class="view-switch" aria-label="Вид результатов"><button class="ig-icon-button" type="button" data-view="grid" aria-label="Плитка">▦</button><button class="ig-icon-button active" type="button" data-view="list" aria-label="Список">☷</button></div></div></div>
      <div class="search-results" id="results" data-view="list"></div>
    </section>
    <aside class="search-right-rail" aria-label="Подсказки поиска">
      <section class="ig-card ig-search-side-card search-side-card search-tip-card"><h3>Как искать точнее</h3><p>Используйте фильтры слева, чтобы уточнить результаты по платформе, жанру, году выхода и рейтингу.</p><div class="search-tip-mark" aria-hidden="true">⌁</div></section>
      <section class="ig-card ig-search-side-card search-side-card"><h3>Подбор без фильтров</h3><p>Не знаете, во что поиграть? Помощник задаст несколько вопросов и подберёт игры по вашим предпочтениям.</p><button class="ig-button search-side-action" type="button" data-page="what-to-play">Подобрать игру</button></section>
      <section class="ig-card ig-search-side-card search-side-card search-factors"><h3>Учитываем</h3><ul><li><span aria-hidden="true">★</span> рейтинг редакции</li><li><span aria-hidden="true">●</span> оценки игроков</li><li><span aria-hidden="true">↗</span> популярность</li><li><span aria-hidden="true">◷</span> свежесть обзоров</li></ul></section>
    </aside>
  </div>
</div>`;

const searchPage=document.querySelector('#search');
if(!searchPage)return;
searchPage.innerHTML=markup;

function asArray(value){return Array.isArray(value)?value.filter(Boolean):[]}
function finite(value){const number=Number(value);return Number.isFinite(number)?number:0}
function firstString(value){return asArray(value).find(Boolean)||''}
function envelopeValue(value){return value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'value')?value.value:value}
function registryField(entity,key){return envelopeValue(entity?.fields?.[key])}
function registryIdentity(entity,key){return envelopeValue(entity?.identity?.[key])}
function mediaUrl(value){if(typeof value==='string')return value;if(Array.isArray(value)){for(const item of value){const url=mediaUrl(item);if(url)return url}return''}return value&&typeof value==='object'?(value.url||value.cover_url||value.src||''):''}
function russianText(...values){for(const value of values){for(const item of Array.isArray(value)?value:[value]){const text=String(item??'').trim();if(text&&/[А-Яа-яЁё]/u.test(text))return text}}return''}
function initials(title){return String(title||'').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'ИП'}
function platformCode(platform){return({PC:'PC',PlayStation:'PS',Xbox:'XB','Nintendo Switch':'NS','PC VR':'VR'}[platform]||String(platform).slice(0,2).toUpperCase())}
function visibleScore(value){return finite(value)>0?finite(value).toFixed(1):'—'}
function steamCover(appid){const id=finite(appid);return id>0?`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`:''}
function extractYear(value,fallback){const match=String(value||'').match(/\b(19|20)\d{2}\b/);return finite(fallback)||finite(match?.[0])||0}
function registryYear(entity){for(const release of asArray(entity?.releases)){const year=extractYear(envelopeValue(release?.date),0);if(year)return year}return 0}
function registryPoster(entity){const media=asArray(entity?.media).filter(item=>mediaUrl(item));const preferred=media.find(item=>/(cover|poster|box|portrait|library[_-]?600x900)/i.test(`${item?.kind||''} ${mediaUrl(item)}`));return preferred?mediaUrl(preferred):''}
function registryAnyMedia(entity){return mediaUrl(asArray(entity?.media).find(item=>mediaUrl(item)))||''}
function normalizePlatform(platform){const value=String(platform||'').trim();if(/^PlayStation/i.test(value))return'PlayStation';if(/^Xbox/i.test(value))return'Xbox';if(/^Nintendo Switch/i.test(value))return'Nintendo Switch';if(/^PC(\s|$)/i.test(value))return value.toUpperCase().includes('VR')?'PC VR':'PC';return value}
function normalizeGenre(genre){const value=String(genre||'').trim();const lower=value.toLowerCase();if(lower==='action rpg')return'RPG';if(lower==='horror')return'Хоррор';if(lower==='action')return'Экшен';if(lower==='adventure')return'Приключения';if(lower==='strategy')return'Стратегия';if(lower==='shooter')return'Шутер';if(lower==='racing')return'Гонки';return value}
function normalizeGame(item,rich={},draft={},registry={}){
  const identity=rich.identity||draft.identity||{};
  const classification=rich.classification||draft.classification||{};
  const requirements=rich.requirements||draft.requirements||{};
  const companies=rich.companies||draft.companies||{};
  const editorial=rich.editorial||draft.editorial||{};
  const ratings=rich.ratings||draft.ratings||{};
  const media=rich.media||draft.media||{};
  const gameMeta=draft.game?.meta||{};
  const fallback=featuredBySlug.get(item.slug)||{};
  const appid=finite(item.steam_appid||identity.steam_appid||registry?.externalIds?.steamAppId||fallback.appid);
  const registryGenres=asArray(registryField(registry,'genres'));
  const registryPlatforms=asArray(registryField(registry,'platforms'));
  const genres=[...new Set(asArray(classification.genres).concat(registryGenres).map(normalizeGenre).filter(Boolean))];
  const platforms=[...new Set(asArray(classification.platforms).concat(asArray(requirements.platforms),registryPlatforms).map(normalizePlatform).filter(Boolean))];
  const poster=registryPoster(registry);
  const cover=mediaUrl(item.cover)||mediaUrl(media.cover)||mediaUrl(gameMeta.cover_url)||mediaUrl(draft.cover)||poster||mediaUrl(fallback.cover)||steamCover(appid)||registryAnyMedia(registry);
  return {
    ...item,
    title:identity.title||registryIdentity(registry,'canonicalTitle')||item.title||fallback.title||item.slug,
    year:extractYear(rich.release?.date_text||draft.release?.date_text,item.year||registryYear(registry)||fallback.year),
    genres:genres.length?genres:asArray(fallback.genres),
    platforms:platforms.length?platforms:asArray(fallback.platforms),
    studio:firstString(companies.developers)||firstString(registryField(registry,'developers'))||fallback.studio||'',
    rating:finite(ratings.igropoisk)||finite(item.rating)||finite(fallback.rating),
    userRating:finite(ratings.users)||finite(item.userRating),
    votes:finite(ratings.user_votes)||finite(item.votes),
    pop:finite(item.pop)||finite(fallback.pop)||finite(item.year)||registryYear(registry),
    desc:russianText(editorial.short_description,editorial.integrated_description,registryField(registry,'shortDescription'),registryField(registry,'description'),fallback.desc),
    appid,
    cover,
    published:Boolean(item.published||registry?.workflow?.pageStatus==='published'),
    editorChoice:Boolean(item.editorChoice||fallback.editorChoice)
  };
}
function getRange(fromSelector,toSelector){let from=finite($(fromSelector).value),to=finite($(toSelector).value);if(from>to)[from,to]=[to,from];return[from,to]}
function syncRangePair(rangeFrom,rangeTo,numberFrom,numberTo,labelFrom,labelTo){
  const fromInput=$(rangeFrom),toInput=$(rangeTo);const[from,to]=getRange(rangeFrom,rangeTo);fromInput.value=from;toInput.value=to;
  if(numberFrom)$(numberFrom).value=from;if(numberTo)$(numberTo).value=to;
  const decimals=rangeFrom.includes('year')?0:1;$(labelFrom).textContent=Number(from).toFixed(decimals);$(labelTo).textContent=Number(to).toFixed(decimals);
}
function updateCounts(){
  ['PC','PlayStation','Xbox','Nintendo Switch'].forEach(platform=>{const node=$(`[data-platform-count="${platform}"]`);if(node)node.textContent=catalog.filter(game=>(game.platforms||[]).includes(platform)).length});
  CORE_GENRES.forEach(genre=>{const node=$(`[data-genre-count="${genre}"]`);if(node)node.textContent=catalog.filter(game=>(game.genres||[]).includes(genre)).length});
}
function updateLiveSuggestions(){const query=$('#query').value.trim().toLowerCase();const matches=(query?catalog.filter(game=>[game.title,game.studio].join(' ').toLowerCase().includes(query)):catalog).slice(0,12);$('#gameSearchSuggestions').innerHTML=matches.map(game=>`<option value="${escapeHtml(game.title)}">${escapeHtml(game.studio||game.year||'')}</option>`).join('')}
function filteredCatalog(){
  const query=$('#query').value.trim().toLowerCase();
  const platforms=$$('.f-platform:checked').map(input=>input.value);
  const genres=$$('.f-genre:checked').map(input=>input.value);
  const quickPlatform=$('#quickPlatform').value,quickGenre=$('#quickGenre').value,quickYear=finite($('#quickYear').value),quickRating=finite($('#quickRating').value);
  const[yearFrom,yearTo]=getRange('#yearFrom','#yearTo'),[ratingFrom,ratingTo]=getRange('#ratingFrom','#ratingTo'),[userFrom,userTo]=getRange('#userRatingFrom','#userRatingTo');
  const ratingActive=ratingFrom>0||ratingTo<10,userActive=userFrom>0||userTo<10;
  const yearActive=yearFrom>finite($('#yearFrom').min)||yearTo<finite($('#yearTo').max);
  const filtered=catalog.filter(game=>{
    const gamePlatforms=game.platforms||[],gameGenres=game.genres||[],rating=finite(game.rating),userRating=finite(game.userRating),haystack=[game.title,game.studio||'',...gameGenres].join(' ').toLowerCase();
    const platformMatch=!platforms.length||platforms.some(platform=>gamePlatforms.includes(platform));
    const genreMatch=!genres.length||genres.some(genre=>gameGenres.includes(genre));
    const yearMatch=!yearActive||(game.year>0&&game.year>=yearFrom&&game.year<=yearTo);
    return (!query||haystack.includes(query))&&platformMatch&&genreMatch&&(!quickPlatform||gamePlatforms.includes(quickPlatform))&&(!quickGenre||gameGenres.includes(quickGenre))&&yearMatch&&(!quickYear||(game.year>0&&game.year>=quickYear))&&(!ratingActive||(rating>0&&rating>=ratingFrom&&rating<=ratingTo))&&(!userActive||(userRating>0&&userRating>=userFrom&&userRating<=userTo))&&(!quickRating||(rating>0&&rating>=quickRating));
  });
  const sort=$('#sort').value;
  filtered.sort((a,b)=>sort==='rating'?finite(b.rating)-finite(a.rating):sort==='users'?finite(b.userRating)-finite(a.userRating):sort==='year'?finite(b.year)-finite(a.year):sort==='title'?a.title.localeCompare(b.title,'ru'):finite(b.pop||b.year)-finite(a.pop||a.year));
  return filtered;
}
function resultCard(game,index){
  const media=game.cover?`<img src="${escapeHtml(game.cover)}" alt="${escapeHtml(game.title)}" loading="${index<6?'eager':'lazy'}" decoding="async" data-fallback="${escapeHtml(initials(game.title))}">`:`<div class="result-placeholder">${escapeHtml(initials(game.title))}</div>`;
  const pills=[game.year,...(game.genres||[]).slice(0,2)].filter(Boolean).map(value=>`<span class="ig-chip">${escapeHtml(value)}</span>`).join('');
  const platformMarks=(game.platforms||[]).map(platform=>`<b title="${escapeHtml(platform)}">${escapeHtml(platformCode(platform))}</b>`).join('');
  const route=game.published?` data-game="${escapeHtml(game.slug)}"`:'';
  const stateClass=game.published?' ig-card--interactive':' search-result-card--static';
  return `<article class="ig-card${stateClass} ig-search-result search-result-card"${route}><div class="result-accent" aria-hidden="true"></div><div class="result-media">${media}</div><div class="result-copy"><div class="result-title-line"><h3>${escapeHtml(game.title)}</h3>${game.editorChoice?'<span class="ig-chip editor-choice">★ выбор редакции</span>':''}</div><div class="result-meta">${pills}</div>${game.desc?`<p>${escapeHtml(game.desc)}</p>`:''}${game.studio?`<small>${escapeHtml(game.studio)}</small>`:''}${platformMarks?`<div class="result-platforms">${platformMarks}</div>`:''}</div><div class="result-scores"><div><small>Игропоиск</small><strong>${visibleScore(game.rating)}</strong>${game.votes?`<span>${formatNumber(game.votes)} оценок</span>`:''}</div><div><small>Оценка игроков</small><strong class="user-score">${visibleScore(game.userRating)}</strong></div></div></article>`;
}
function renderResults(){
  syncRangePair('#yearFrom','#yearTo',null,null,'#yearFromLabel','#yearToLabel');
  syncRangePair('#ratingFrom','#ratingTo','#ratingFromNumber','#ratingToNumber','#ratingFromLabel','#ratingToLabel');
  syncRangePair('#userRatingFrom','#userRatingTo','#userRatingFromNumber','#userRatingToNumber','#userRatingFromLabel','#userRatingToLabel');
  const filtered=filteredCatalog();$('#count').textContent=`Найдено игр: ${filtered.length}`;$('#applyCount').textContent=filtered.length;const target=$('#results');target.dataset.view=resultView;target.innerHTML=filtered.length?filtered.map(resultCard).join(''):'<div class="ig-empty-state empty">По выбранным условиям игр нет.</div>';
}
function bindRange(rangeFrom,rangeTo,numberFrom,numberTo){[rangeFrom,rangeTo].forEach(selector=>$(selector).addEventListener('input',renderResults));if(numberFrom)$(numberFrom).addEventListener('input',()=>{$(rangeFrom).value=$(numberFrom).value;renderResults()});if(numberTo)$(numberTo).addEventListener('input',()=>{$(rangeTo).value=$(numberTo).value;renderResults()})}
function resetFilters(){$$('.f-platform,.f-genre').forEach(input=>{input.checked=false});$('#yearFrom').value=$('#yearFrom').min;$('#yearTo').value=$('#yearTo').max;$('#ratingFrom').value=0;$('#ratingTo').value=10;$('#userRatingFrom').value=0;$('#userRatingTo').value=10;$('#query').value='';['#quickPlatform','#quickGenre','#quickYear','#quickRating'].forEach(selector=>$(selector).value='');$('#sort').value='popularity';updateLiveSuggestions();renderResults()}
function bind(){
  $('#query').addEventListener('input',()=>{updateLiveSuggestions();renderResults()});
  $$('.f-platform,.f-genre').forEach(input=>input.addEventListener('change',renderResults));
  ['#quickPlatform','#quickGenre','#quickYear','#quickRating','#sort'].forEach(selector=>$(selector).addEventListener('change',renderResults));
  bindRange('#yearFrom','#yearTo');bindRange('#ratingFrom','#ratingTo','#ratingFromNumber','#ratingToNumber');bindRange('#userRatingFrom','#userRatingTo','#userRatingFromNumber','#userRatingToNumber');
  $('#resetFilters').addEventListener('click',resetFilters);$('#applyFilters').addEventListener('click',()=>{$('#filters').classList.remove('open');$('#results').scrollIntoView({behavior:'smooth',block:'start'})});$('#filterToggle').addEventListener('click',()=>$('#filters').classList.toggle('open'));
  $$('.view-switch button').forEach(button=>button.addEventListener('click',()=>{resultView=button.dataset.view;$$('.view-switch button').forEach(item=>item.classList.toggle('active',item===button));renderResults()}));
  $('#results').addEventListener('error',event=>{const image=event.target;if(!(image instanceof HTMLImageElement)||!image.closest('.result-media'))return;const fallback=document.createElement('div');fallback.className='result-placeholder';fallback.textContent=image.dataset.fallback||'ИП';image.replaceWith(fallback)},true);
  $$('[data-page="search"]').forEach(trigger=>trigger.addEventListener('click',()=>window.setTimeout(()=>$('#query')?.focus({preventScroll:true}),0)));
}
async function loadJson(path){const response=await fetch(`${path}?v=20260819-5`,{cache:'no-store'});if(!response.ok)throw new Error(`${path}: ${response.status}`);return response.json()}
async function loadRichMap(){const settled=await Promise.allSettled(CONTENT_SHARDS.map(file=>loadJson(`data/game-content/${file}`)));const map=new Map();settled.forEach(result=>{if(result.status!=='fulfilled')return;Object.entries(result.value?.games||{}).forEach(([slug,data])=>map.set(slug,data))});return map}
function buildRegistryBundle(snapshot){
  const map=new Map();const seeds=[];
  Object.values(snapshot?.games||{}).forEach(entity=>{
    if(entity?.workflow?.status==='merged_into_another_game'||entity?.presentation?.standalonePage===false)return;
    const slug=String(registryIdentity(entity,'slug')||'').trim();if(!slug)return;
    map.set(slug,entity);
    seeds.push({game_id:entity.id,slug,title:registryIdentity(entity,'canonicalTitle')||slug,year:registryYear(entity),steam_appid:finite(entity?.externalIds?.steamAppId),published:entity?.workflow?.pageStatus==='published'});
  });
  return {map,seeds};
}
async function enrichMissingFromDrafts(items,richMap,registryMap,visibleSlugs){
  const needs=items.filter(item=>{
    if(!visibleSlugs.has(item.slug))return false;
    const rich=richMap.get(item.slug)||{};const registry=registryMap.get(item.slug)||{};const identity=rich.identity||{};
    const appid=finite(item.steam_appid||identity.steam_appid||registry?.externalIds?.steamAppId);
    const hasCover=Boolean(mediaUrl(rich.media?.cover)||registryPoster(registry)||steamCover(appid));
    const hasGenres=asArray(rich.classification?.genres).length||asArray(registryField(registry,'genres')).length;
    return !hasCover||!hasGenres;
  });
  const queue=[...needs];const drafts=new Map();const workers=Array.from({length:Math.min(8,queue.length)},async()=>{while(queue.length){const item=queue.shift();try{drafts.set(item.slug,await loadJson(`data/drafts/${encodeURIComponent(item.slug)}.json`))}catch(_){/* Some visible entries intentionally have no draft. */}}});
  await Promise.all(workers);return drafts;
}
async function loadCatalog(){
  try{
    const [visible,richMap,registrySnapshot]=await Promise.all([loadJson('data/catalog-visible.json'),loadRichMap(),loadJson('data/game-registry/registry.transition.json')]);
    const registryBundle=buildRegistryBundle(registrySnapshot);
    const visibleBySlug=new Map(asArray(visible).map(item=>[item.slug,item]));
    const visibleSlugs=new Set(visibleBySlug.keys());
    const baseItems=registryBundle.seeds.length?registryBundle.seeds:asArray(visible).map(item=>({...item,published:true}));
    const items=baseItems.map(seed=>({...visibleBySlug.get(seed.slug),...seed,published:Boolean(seed.published||visibleSlugs.has(seed.slug))}));
    const drafts=await enrichMissingFromDrafts(items,richMap,registryBundle.map,visibleSlugs);
    catalog=items.map(item=>normalizeGame(item,richMap.get(item.slug)||{},drafts.get(item.slug)||{},registryBundle.map.get(item.slug)||{}));
    const years=catalog.map(game=>finite(game.year)).filter(Boolean);const minYear=Math.min(...years,2000),maxYear=Math.max(...years,2026);$('#yearFrom').min=minYear;$('#yearFrom').max=maxYear;$('#yearFrom').value=minYear;$('#yearTo').min=minYear;$('#yearTo').max=maxYear;$('#yearTo').value=maxYear;
  }catch(error){console.warn('Игропоиск: search catalog unavailable',error);catalog=[...featured];}
  updateCounts();updateLiveSuggestions();renderResults();
}

bind();updateLiveSuggestions();renderResults();loadCatalog();
})();
