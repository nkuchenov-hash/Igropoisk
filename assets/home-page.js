'use strict';

if (!window.IgropoiskHomeFeeds && document.readyState === 'loading') {
  document.write('<script src="features/home-feeds/content-api/index.js?v=20260810-1"><\/script>');
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const featured = [
  {slug:'elden-ring',title:'Elden Ring',year:2022,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'FromSoftware',rating:9.6,pop:9691,desc:'Большое фэнтезийное приключение в открытом мире.',appid:1245620},
  {slug:'baldurs-gate-3',title:'Baldur’s Gate 3',year:2023,genres:['RPG','Стратегия'],platforms:['PC','PlayStation','Xbox'],studio:'Larian Studios',rating:9.5,pop:9230,desc:'Ролевая игра с глубокой реактивностью мира и тактическими боями.',appid:1086940},
  {slug:'red-dead-redemption-2',title:'Red Dead Redemption 2',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Rockstar Games',rating:9.4,pop:8810,desc:'История о закате эпохи Дикого Запада в огромном живом мире.',appid:1174180},
  {slug:'the-witcher-3-wild-hunt',title:'The Witcher 3: Wild Hunt',year:2015,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:9.3,pop:8500,desc:'Большое приключение Геральта с сильными героями и сложными решениями.',appid:292030},
  {slug:'cyberpunk-2077',title:'Cyberpunk 2077',year:2020,genres:['RPG','Экшен'],platforms:['PC','PlayStation','Xbox'],studio:'CD Projekt RED',rating:8.8,pop:7900,desc:'Футуристическая ролевая игра о наёмнике Ви и Найт-Сити.',appid:1091500},
  {slug:'god-of-war',title:'God of War',year:2018,genres:['Экшен','Приключения'],platforms:['PC','PlayStation'],studio:'Santa Monica Studio',rating:9.2,pop:7600,desc:'Камерное путешествие Кратоса и Атрея по миру северных мифов.',appid:1593500},
  {slug:'hades',title:'Hades',year:2020,genres:['Экшен','RPG'],platforms:['PC','PlayStation','Xbox'],studio:'Supergiant Games',rating:9.2,pop:7100,desc:'Динамичный рогалик, где каждая смерть продолжает историю.',appid:1145360},
  {slug:'forza-horizon-5',title:'Forza Horizon 5',year:2021,genres:['Гонки'],platforms:['PC','Xbox'],studio:'Playground Games',rating:8.8,pop:6400,desc:'Автомобильный фестиваль в открытом мире Мексики.',appid:1551360},
  {slug:'helldivers-2',title:'Helldivers 2',year:2024,genres:['Шутер','Экшен'],platforms:['PC','PlayStation'],studio:'Arrowhead Game Studios',rating:8.7,pop:6200,desc:'Кооперативный шутер о хаотичных операциях Супер-Земли.',appid:553850},
  {slug:'hogwarts-legacy',title:'Hogwarts Legacy',year:2023,genres:['RPG','Приключения'],platforms:['PC','PlayStation','Xbox'],studio:'Avalanche Software',rating:8.4,pop:5900,desc:'Приключение в открытом мире школы чародейства и волшебства.',appid:990080}
].map(game => ({...game,cover:`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`,hero:`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_hero.jpg`}));

let catalog = [...featured];
const featuredBySlug = new Map(featured.map(game => [game.slug, game]));

function openPage(id) {
  const target = document.getElementById(id);
  if (!target?.classList.contains('page')) return false;
  $$('.page').forEach(page => page.classList.toggle('active', page.id === id));
  $$('.site-nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === id));
  window.scrollTo({top:0,behavior:'auto'});
  return true;
}

function routeFromLocation() {
  const id = decodeURIComponent(location.hash.replace(/^#/, '') || 'home');
  openPage(id) || openPage('home');
}

function openGame(slug) {
  window.location.href = `game/${encodeURIComponent(slug)}/`;
}

function bindNavigation() {
  $$('[data-page]').forEach(button => button.addEventListener('click', event => {
    const id = button.dataset.page;
    if (!openPage(id)) return;
    event.preventDefault();
    const next = id === 'home' ? `${location.pathname}${location.search}` : `#${encodeURIComponent(id)}`;
    history.replaceState(null, '', next);
  }));
  window.addEventListener('hashchange', routeFromLocation);
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-game]');
    if (target) openGame(target.dataset.game);
  });
}

function bindTheme() {
  const button = $('#theme');
  const saved = localStorage.getItem('igroTheme') || 'dark';
  document.documentElement.dataset.theme = saved;
  button.textContent = saved === 'light' ? '☾' : '☀';
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    button.textContent = next === 'light' ? '☾' : '☀';
    localStorage.setItem('igroTheme', next);
  });
}

function gameCard(game) {
  return `<article class="card game-card" data-game="${game.slug}"><img src="${game.cover}" alt="${game.title}" loading="lazy"><div class="card-body"><h3>${game.title}</h3><span class="score">${game.rating.toFixed(1)}</span></div></article>`;
}

function renderHome() {
  $('#popular').innerHTML = featured.map(gameCard).join('');
  $('#reviews').innerHTML = featured.slice(1,5).map(game => `<article class="card small-card" data-game="${game.slug}"><img src="${game.hero}" alt="${game.title}" loading="lazy"><div><div class="date">30 июля 2026</div><h3>${game.title}</h3></div></article>`).join('');
}

function initials(title) {
  return title.split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]).join('').toUpperCase();
}

function renderResults() {
  const queryValue = $('#query').value.trim().toLowerCase();
  const platforms = $$('.f-platform:checked').map(input => input.value);
  const genres = $$('.f-genre:checked').map(input => input.value);
  let yearFrom = Number($('#yearFrom').value);
  let yearTo = Number($('#yearTo').value);
  let ratingFrom = Number($('#ratingFrom').value);
  let ratingTo = Number($('#ratingTo').value);
  if (yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  if (ratingFrom > ratingTo) [ratingFrom, ratingTo] = [ratingTo, ratingFrom];
  $('#yearFromLabel').textContent = yearFrom;
  $('#yearToLabel').textContent = yearTo;
  $('#ratingFromLabel').textContent = ratingFrom.toFixed(1);
  $('#ratingToLabel').textContent = ratingTo.toFixed(1);

  const filtered = catalog.filter(game => {
    const haystack = [game.title, game.studio || '', ...(game.genres || [])].join(' ').toLowerCase();
    const platformMatch = !platforms.length || platforms.some(platform => (game.platforms || []).includes(platform));
    const genreMatch = !genres.length || genres.some(genre => (game.genres || []).includes(genre));
    const rating = game.rating || 0;
    return (!queryValue || haystack.includes(queryValue)) && platformMatch && genreMatch && game.year >= yearFrom && game.year <= yearTo && rating >= ratingFrom && rating <= ratingTo;
  });

  const sortMode = $('#sort').value;
  filtered.sort((a,b) => sortMode === 'rating' ? (b.rating || 0) - (a.rating || 0) : sortMode === 'year' ? b.year - a.year : sortMode === 'title' ? a.title.localeCompare(b.title,'ru') : (b.pop || 0) - (a.pop || 0));
  $('#count').textContent = `Найдено игр: ${filtered.length}`;
  $('#results').innerHTML = filtered.map(game => {
    const media = game.cover ? `<img src="${game.cover}" alt="${game.title}" loading="lazy">` : `<div class="result-placeholder">${initials(game.title)}</div>`;
    const pills = [game.year, ...(game.genres || []).slice(0,2)].map(value => `<span class="ig-pill">${value}</span>`).join('');
    return `<article class="result" data-game="${game.slug}"><div class="result-media">${media}</div><div><h3>${game.title}</h3><div class="result-meta">${pills}</div>${game.desc ? `<p>${game.desc}</p>` : ''}${game.studio ? `<small class="ig-muted">${game.studio}</small>` : ''}</div><div class="metric"><small>Игропоиск</small><div class="bigscore">${game.rating ? game.rating.toFixed(1) : '—'}</div></div></article>`;
  }).join('') || '<div class="empty">По выбранным условиям игр нет.</div>';
}

async function loadCatalog() {
  try {
    const response = await fetch('data/catalog-visible.json', {cache:'no-store'});
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    const visible = await response.json();
    catalog = visible.map(item => featuredBySlug.get(item.slug) || {...item,genres:[],platforms:[],studio:'',rating:0,pop:item.year});
  } catch (error) {
    console.warn(error);
    catalog = [...featured];
  }
  const years = catalog.map(game => Number(game.year)).filter(Number.isFinite);
  const minimumYear = Math.min(...years, 2000);
  $('#yearFrom').min = minimumYear;
  $('#yearFrom').value = minimumYear;
  $('#yearFromLabel').textContent = minimumYear;
  renderResults();
}

function bindFilters() {
  ['#query','#sort','#yearFrom','#yearTo','#ratingFrom','#ratingTo'].forEach(selector => $(selector).addEventListener('input', renderResults));
  $$('.f-platform,.f-genre').forEach(input => input.addEventListener('input', renderResults));
  $('#resetFilters').addEventListener('click', () => {
    $$('.f-platform,.f-genre').forEach(input => { input.checked = false; });
    $('#yearFrom').value = $('#yearFrom').min;
    $('#yearTo').value = 2026;
    $('#ratingFrom').value = 0;
    $('#ratingTo').value = 10;
    $('#query').value = '';
    renderResults();
  });
  $('#filterToggle').addEventListener('click', () => $('#filters').classList.toggle('open'));
}

function startHero() {
  const slides = $$('.hero-slide');
  let active = 0;
  window.setInterval(() => {
    slides[active].classList.remove('active');
    active = (active + 1) % slides.length;
    slides[active].classList.add('active');
  }, 5500);
}

function loadEnhancedSearch() {
  if (document.querySelector('script[data-search-page]')) return;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'assets/search-page.css?v=20260803-1';
  document.head.appendChild(style);
  const script = document.createElement('script');
  script.src = 'assets/search-page.js?v=20260803-1';
  script.dataset.searchPage = 'true';
  script.onload = () => {
    document.querySelector('.search-side-action')?.addEventListener('click', () => {
      document.querySelector('.site-nav [data-page="what-to-play"]')?.click();
    });
  };
  document.body.appendChild(script);
}

document.querySelector('.primary')?.classList.add('ig-button');
bindNavigation();
routeFromLocation();
bindTheme();
bindFilters();
renderHome();
renderResults();
loadCatalog().finally(loadEnhancedSearch);
startHero();
