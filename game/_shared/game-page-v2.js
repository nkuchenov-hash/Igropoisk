(()=>{
'use strict';

const root=document.documentElement;
const shell=document.body.dataset;
const slug=shell.slug||location.pathname.split('/').filter(Boolean).at(-1)||'game';
const seedTitle=shell.title||slug.replace(/-/g,' ');
const seedYear=Number(shell.year)||0;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const nonEmpty=value=>value!==null&&value!==undefined&&value!=='';
const first=(...values)=>values.find(nonEmpty);
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const initials=value=>String(value||'Игра').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const join=value=>arr(value).filter(Boolean).join(', ');
const formatScore=value=>{const number=Number(value);return Number.isFinite(number)?(number>10?String(Math.round(number)):number.toFixed(1).replace('.0','')):'—'};
const chunkForYear=year=>year<=2015?'2002-2015':year<=2017?'2016-2017':year<=2019?'2018-2019':year===2020?'2020':year<=2022?'2021-2022':'2023-2025';
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch(error){console.warn('Игропоиск:',url,error);return null}};

const fallback={
  identity:{slug,title:seedTitle,steam_appid:null},
  release:{date_text:seedYear||'Уточняется'},
  companies:{developers:[],publishers:[]},
  classification:{genres:[],platforms:[],categories:[]},
  editorial:{short_description:`${seedTitle} — игра ${seedYear||''} года.`,integrated_description:'',features:[]},
  media:{hero:'',cover:'',screenshots:[],videos:[]},
  ratings:{igropoisk:null,users:null,user_votes:0},
  links:{official:'',store:''},
  materials:{reviews:[],news:[],guides:[]},
  requirements:{platforms:[]},
  sources:[],awards:[]
};

function draftMatches(curated,draft){
  if(!draft?.identity)return false;
  const expectedId=Number(curated?.identity?.steam_appid);
  const actualId=Number(draft.identity.steam_appid);
  if(expectedId&&actualId)return expectedId===actualId;
  return canonical(draft.identity.title)===canonical(curated?.identity?.title||seedTitle);
}

function mergeGame(curatedRaw,draftRaw,awardsRaw){
  const curated=curatedRaw||{};
  const game={
    ...fallback,...curated,
    identity:{...fallback.identity,...curated.identity},release:{...fallback.release,...curated.release},
    companies:{...fallback.companies,...curated.companies},classification:{...fallback.classification,...curated.classification},
    editorial:{...fallback.editorial,...curated.editorial},media:{...fallback.media,...curated.media},
    ratings:{...fallback.ratings,...curated.ratings},links:{...fallback.links,...curated.links},
    materials:{...fallback.materials,...curated.materials},requirements:{...fallback.requirements,...curated.requirements},
    sources:arr(curated.sources),awards:arr(curated.awards)
  };
  if(draftMatches(game,draftRaw)){
    const draft=draftRaw;
    game.media={
      ...draft.media,...game.media,
      hero:first(game.media?.hero,draft.media?.hero,''),cover:first(game.media?.cover,draft.media?.cover,''),
      screenshots:arr(game.media?.screenshots).length?arr(game.media.screenshots):arr(draft.media?.screenshots),
      videos:arr(game.media?.videos).length?arr(game.media.videos):arr(draft.media?.videos)
    };
    game.links={...draft.links,...game.links,official:first(game.links?.official,draft.links?.official,''),store:first(game.links?.store,draft.links?.store,'')};
    game.sources=[...arr(game.sources),...arr(draft.sources)].filter((item,index,list)=>item?.url&&list.findIndex(other=>other.url===item.url)===index);
    game.materials={
      reviews:arr(game.materials?.reviews).length?arr(game.materials.reviews):arr(draft.materials?.reviews),
      news:arr(game.materials?.news).length?arr(game.materials.news):arr(draft.materials?.news),
      guides:arr(game.materials?.guides).length?arr(game.materials.guides):arr(draft.materials?.guides)
    };
    if(!nonEmpty(game.ratings?.igropoisk))game.ratings.igropoisk=draft.ratings?.igropoisk;
    if(!nonEmpty(game.ratings?.users))game.ratings.users=draft.ratings?.users;
    if(!game.ratings?.user_votes)game.ratings.user_votes=draft.ratings?.user_votes||0;
  }
  const parsedAwards=arr(awardsRaw?.awards||awardsRaw).filter(item=>item?.name&&(item.source_url||item.url));
  game.awards=[...arr(game.awards),...parsedAwards].filter((item,index,list)=>{
    const url=item.source_url||item.url;
    return item?.name&&url&&list.findIndex(other=>(other.source_url||other.url)===url&&other.name===item.name)===index;
  });
  const appid=Number(game.identity?.steam_appid);
  if(appid){
    game.media.hero=first(game.media.hero,`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`);
    game.media.cover=first(game.media.cover,`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`);
  }
  game.requirements.platforms=arr(game.requirements?.platforms).length?arr(game.requirements.platforms):arr(game.classification?.platforms);
  return game;
}

function shellHTML(){
  document.body.innerHTML=`
<header class="game-header"><div class="ig-container game-header__inner"><a class="game-logo" href="../../index.html">ИГРОПОИСК</a><nav class="game-nav"><a href="../../index.html">Главное</a><a href="../../index.html#search">Поиск игр</a><a href="../../index.html#news">Новости</a></nav><div class="game-header__actions"><a class="header-icon" href="../../index.html#search" aria-label="Поиск">⌕</a><button class="header-icon" id="theme" type="button" aria-label="Переключить тему">☀</button></div></div></header>
<section class="game-hero" id="gameHero"><div class="ig-container game-hero__inner"><div class="breadcrumbs"><a href="../../index.html">Главное</a> / <a href="../../index.html#search">Игры</a> / <span id="crumb"></span></div><div class="hero-copy"><h1 id="gameTitle"></h1><div class="hero-meta" id="gameMeta"></div><div class="hero-actions"><button class="state-button" id="favorite" type="button" aria-pressed="false">♡ В избранное</button><button class="state-button" id="wantToPlay" type="button" aria-pressed="false">＋ Хочу сыграть</button><button class="state-button accent" id="rateGame" type="button">Оценить игру</button></div></div><aside class="hero-score-area"><div class="hero-score-card"><div class="score-line"><strong id="editorialScore">—</strong><div><b>Рейтинг Игропоиска</b><small id="editorialNote">Редакционная оценка</small></div></div><div class="score-line"><strong id="userScore">—</strong><div><b>Оценка игроков</b><small id="userScoreNote">Оценок пока нет</small></div></div><button class="text-action" id="rateInline" type="button">Оценить игру</button></div></aside><div class="hero-media" id="heroMedia" aria-label="Медиа игры"></div></div></section>
<main class="ig-container game-main"><nav class="game-tabs" role="tablist"><button class="active" data-tab="overview">Об игре</button><button data-tab="reviews">Обзоры</button><button data-tab="media">Медиа</button><button data-tab="news">Новости</button><button data-tab="requirements">Системные требования</button><button data-tab="guides">Гайды</button><button data-tab="sourcesTab">Источники <span id="sourceCount"></span></button></nav>
<section class="game-tab active" id="overview"><div class="overview-grid"><article class="game-panel about-panel"><h2>Об игре</h2><p id="description"></p><h3>Жанры</h3><div class="tag-row" id="genreTags"></div></article><article class="game-panel"><h2>Ключевые особенности</h2><ul class="feature-list" id="featureList"></ul></article><aside class="game-panel"><h2>Информация</h2><dl class="detail-table" id="details"></dl></aside><aside class="game-panel"><h2>Оценки</h2><div class="rating-list" id="ratingList"></div></aside></div><div class="lower-grid"><section class="game-panel" id="awardsPanel" hidden><h2>Награды из источников</h2><div class="award-sources" id="awards"></div></section><section class="game-panel"><h2>Официальные страницы</h2><div class="store-list" id="officialLinks"></div></section><section class="game-panel similar-panel"><h2>Похожие игры</h2><div class="similar-row" id="similarGames"></div></section></div></section>
<section class="game-tab" id="reviews"><div class="content-sidebar"><div><article class="game-panel featured-review" id="featuredReview"></article><div class="review-grid" id="reviewGrid"></div></div><aside class="sidebar-stack"><section class="game-panel"><h2>Источники обзоров</h2><div class="source-list" id="reviewSources"></div></section><section class="game-panel"><h2>Сначала прочитать</h2><div id="readFirst"></div></section></aside></div></section>
<section class="game-tab" id="media"><div class="media-feature-grid"><article class="media-feature" id="mediaFeature"></article><div class="media-mosaic" id="mediaMosaic"></div></div><h2 class="subsection-title">Все материалы</h2><div class="horizontal-media" id="mediaAll"></div></section>
<section class="game-tab" id="news"><div class="news-layout"><div><article class="game-panel featured-news" id="featuredNews"></article><div class="game-panel news-list" id="newsList"></div></div><aside class="news-sidebar"><section class="game-panel"><h2>Официальные обновления</h2><div class="source-list" id="officialUpdates"></div></section><section class="game-panel"><h2>Хронология</h2><div class="timeline" id="timeline"></div></section></aside></div></section>
<section class="game-tab" id="requirements"><div class="requirements-notice">Платформы вынесены в системные требования. Значения показываются только из данных магазина или официального источника.</div><div class="requirements-grid"><section class="game-panel"><h2>Минимальные</h2><dl class="requirements-table" id="minimumRequirements"></dl></section><section class="game-panel"><h2>Рекомендуемые</h2><dl class="requirements-table" id="recommendedRequirements"></dl></section><section class="game-panel platforms-panel"><h2>Платформы</h2><div id="platformRequirements"></div></section></div></section>
<section class="game-tab" id="guides"><div class="guides-layout"><div><article class="game-panel featured-guide" id="featuredGuide"></article><div class="guide-grid" id="guideGrid"></div></div><aside class="sidebar-stack"><section class="game-panel"><h2>Быстрые ссылки</h2><div class="quick-links" id="guideQuickLinks"></div></section><section class="game-panel"><h2>Обновлено</h2><div id="guideUpdated"></div></section></aside></div></section>
<section class="game-tab" id="sourcesTab"><div class="game-panel"><h2>Источники данных</h2><div class="source-list" id="sources"></div></div></section></main>
<dialog class="rating-dialog" id="ratingDialog"><div class="rating-dialog__body"><div class="rating-dialog__head"><div><h2>Оценить игру</h2><p id="ratingDialogTitle"></p></div><button class="rating-dialog__close" id="ratingClose" type="button" aria-label="Закрыть">×</button></div><div class="rating-scale" id="ratingScale"></div><div class="rating-dialog__note">Оценка сохраняется только в вашем браузере и не подменяет общий рейтинг игроков.</div></div></dialog>`;
}

function imageMarkup(url,title,className=''){
  return url?`<img class="${className}" src="${esc(url)}" alt="${esc(title)}" loading="lazy" data-fallback="${esc(initials(title))}">`:`<div class="media-placeholder ${className}">${esc(initials(title))}</div>`;
}

function installImageFallbacks(){
  document.querySelectorAll('img[data-fallback]').forEach(image=>image.addEventListener('error',()=>{const replacement=document.createElement('div');replacement.className=`media-placeholder ${image.className||''}`;replacement.textContent=image.dataset.fallback||'И';image.replaceWith(replacement)},{once:true}));
}

function renderHero(game){
  const title=game.identity.title||seedTitle;
  const shots=arr(game.media.screenshots).map(item=>typeof item==='string'?item:item?.url||item?.src||item?.image).filter(Boolean);
  const videos=arr(game.media.videos).map(item=>typeof item==='string'?{thumbnail:item}:item).filter(Boolean);
  const hero=first(game.media.hero,shots[0],game.media.cover,'');
  document.querySelector('#gameHero').style.backgroundImage=hero?`url("${hero.replace(/"/g,'%22')}")`:'';
  document.querySelector('#gameTitle').textContent=title;
  document.querySelector('#crumb').textContent=title;
  document.querySelector('#gameMeta').textContent=[game.release.date_text,join(game.classification.genres),join(game.companies.developers)].filter(Boolean).join(' · ');
  document.querySelector('#editorialScore').textContent=formatScore(game.ratings.igropoisk);
  document.querySelector('#editorialNote').textContent=nonEmpty(game.ratings.igropoisk)?'Сводная редакционная оценка':'Оценка формируется';
  document.querySelector('#userScore').textContent=formatScore(game.ratings.users);
  document.querySelector('#userScoreNote').textContent=nonEmpty(game.ratings.users)?`${Number(game.ratings.user_votes||0).toLocaleString('ru-RU')} оценок`:'Оценок пока нет';
  const mediaItems=[...(videos[0]?[{url:first(videos[0].thumbnail,videos[0].poster,videos[0].image,videos[0].url),video:true,label:'Трейлер'}]:[]),...shots.map(url=>({url}))];
  if(!mediaItems.length){if(hero)mediaItems.push({url:hero});if(game.media.cover&&game.media.cover!==hero)mediaItems.push({url:game.media.cover})}
  const visible=mediaItems.slice(0,8);const extra=Math.max(0,mediaItems.length-visible.length);
  document.querySelector('#heroMedia').innerHTML=visible.map((item,index)=>`<button class="hero-media__item${item.video?' trailer':''}${extra&&index===visible.length-1?' more':''}" type="button"${extra&&index===visible.length-1?` data-more="+${extra}"`:''}>${imageMarkup(item.url,title)}${item.video?'<span class="play">▶</span><b>ТРЕЙЛЕР</b>':''}</button>`).join('')||`<div class="hero-media__item">${imageMarkup('',title)}</div>`;
  document.querySelectorAll('.hero-media__item').forEach(button=>button.addEventListener('click',()=>document.querySelector('[data-tab="media"]')?.click()));
}

function renderOverview(game,catalog){
  const title=game.identity.title;
  const description=first(game.editorial.integrated_description,game.editorial.short_description,`${title} — страница игры в каталоге Игропоиска.`);
  document.querySelector('#description').textContent=description;
  const genres=[...arr(game.classification.genres),...arr(game.classification.categories).filter(value=>!String(value).toLowerCase().includes('achievement'))].slice(0,10);
  document.querySelector('#genreTags').innerHTML=genres.map(value=>`<span class="game-chip">${esc(value)}</span>`).join('')||'<span class="game-chip">Жанр уточняется</span>';
  const features=arr(game.editorial.features).filter(Boolean).slice(0,8);
  document.querySelector('#featureList').innerHTML=(features.length?features:['Исследование мира','Развитие персонажа','Сюжетные задания']).map(value=>`<li>${esc(value)}</li>`).join('');
  document.querySelector('#details').innerHTML=`<dt>Дата выхода</dt><dd>${esc(game.release.date_text)}</dd><dt>Разработчик</dt><dd>${esc(join(game.companies.developers)||'Уточняется')}</dd><dt>Издатель</dt><dd>${esc(join(game.companies.publishers)||'Уточняется')}</dd><dt>Жанры</dt><dd>${esc(join(game.classification.genres)||'Уточняются')}</dd>`;
  const editorial=Number(game.ratings.igropoisk),users=Number(game.ratings.users);
  document.querySelector('#ratingList').innerHTML=`<div><span>Игропоиск</span><i><b style="width:${Number.isFinite(editorial)?Math.min(100,editorial>10?editorial:editorial*10):0}%"></b></i><strong>${formatScore(editorial)}</strong></div><div><span>Игроки</span><i><b style="width:${Number.isFinite(users)?Math.min(100,users>10?users:users*10):0}%"></b></i><strong>${formatScore(users)}</strong></div>`;
  const links=[game.links.official&&['Официальный сайт',game.links.official],game.links.store&&['Страница магазина',game.links.store]].filter(Boolean);
  document.querySelector('#officialLinks').innerHTML=links.map(([label,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(label)}</b><span>Открыть ↗</span></a>`).join('')||'<div><b>Ссылки проверяются</b><span>Нет подтверждённого URL</span></div>';
  renderAwards(game.awards);
  const nearby=arr(catalog).filter(item=>item.slug!==slug).sort((a,b)=>Math.abs(Number(a.year)-seedYear)-Math.abs(Number(b.year)-seedYear)).slice(0,8);
  document.querySelector('#similarGames').innerHTML=nearby.map(item=>`<a href="../${encodeURIComponent(item.slug)}/"><div><div class="media-placeholder">${esc(initials(item.title))}</div></div><b>${esc(item.title)}</b></a>`).join('');
}

function renderAwards(awards){
  const valid=arr(awards).filter(item=>item?.name&&(item.source_url||item.url));
  const panel=document.querySelector('#awardsPanel');
  panel.hidden=!valid.length;
  document.querySelector('#awards').innerHTML=valid.map(item=>{const url=item.source_url||item.url;const image=item.image_url||item.logo_url||'';return `<a class="award-source"${image?'':' style="grid-template-columns:1fr"'} href="${esc(url)}" target="_blank" rel="noopener noreferrer">${image?imageMarkup(image,item.name):''}<div><b>${esc(item.name)}</b>${item.category?`<span>${esc(item.category)}</span>`:''}<small>${esc([item.year,item.source_name||item.source].filter(Boolean).join(' · '))} ↗</small></div></a>`}).join('');
}

function normalizeMaterial(item,type,title,image){
  if(typeof item==='string')return{title:item,description:'',source:'Игропоиск',url:'',image,type};
  return{title:first(item?.title,item?.name,`${type}: ${title}`),description:first(item?.description,item?.summary,item?.text,''),source:first(item?.source_name,item?.source,item?.domain,'Игропоиск'),url:first(item?.url,item?.source_url,''),image:first(item?.image,item?.thumbnail,image,''),date:first(item?.date,item?.published_at,''),score:item?.score,type};
}

function renderReviews(game){
  const title=game.identity.title;const hero=first(game.media.hero,arr(game.media.screenshots)[0],game.media.cover,'');
  document.querySelector('#featuredReview').innerHTML=`<div class="featured-review__media">${imageMarkup(hero,title)}</div><div class="featured-review__copy"><small>ОБЗОР ИГРОПОИСКА</small><h2>Почему ${esc(title)} стоит внимания</h2><p>${esc(first(game.editorial.integrated_description,game.editorial.short_description))}</p><div class="review-meta">Редакционный материал · данные страницы проверяются по источникам</div></div><div class="review-score">${formatScore(game.ratings.igropoisk)}<small>/10</small></div>`;
  const sourceReviews=arr(game.sources).filter(source=>source?.url&&/review|editorial/i.test(String(source.type||''))).map(source=>normalizeMaterial(source,'Обзор',title,hero));
  const parsed=[...arr(game.materials.reviews).map(item=>normalizeMaterial(item,'Обзор',title,hero)),...sourceReviews].filter((item,index,list)=>!item.url||list.findIndex(other=>other.url===item.url)===index);
  const internal=[
    {source:'Игропоиск',title:'Главные достоинства',description:arr(game.editorial.features).slice(0,3).join(' · ')||'Ключевые стороны игры собраны в разделе «Об игре».'},
    {source:'Игропоиск',title:'Кому подойдёт эта игра',description:`Жанры: ${join(game.classification.genres)||'уточняются'}. Платформы: ${join(game.classification.platforms)||'уточняются'}.`}
  ];
  const cards=[...parsed,...internal].slice(0,6);
  document.querySelector('#reviewGrid').innerHTML=cards.map(item=>`<article class="game-panel review-card"><div class="review-card__head"><small>${esc(item.source)}</small>${nonEmpty(item.score)?`<strong>${formatScore(item.score)}<small>/10</small></strong>`:''}</div><h3>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:esc(item.title)}</h3><p>${esc(item.description||'Открыть материал и исходный источник.')}</p>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Читать в источнике ↗</a>`:''}</article>`).join('');
  const external=parsed.filter(item=>item.url);
  document.querySelector('#reviewSources').innerHTML=external.map(item=>`<div><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a><span>↗</span></div>`).join('')||'<div><span>Внешние обзоры появятся только после парсинга реальных публикаций.</span></div>';
  document.querySelector('#readFirst').innerHTML=`<div class="read-first"><span>Обзор Игропоиска</span><b>${formatScore(game.ratings.igropoisk)}</b></div><div class="read-first"><span>Об игре</span><b>${arr(game.editorial.features).length} фактов</b></div>`;
}

function renderMedia(game){
  const title=game.identity.title;const shots=arr(game.media.screenshots).map(item=>typeof item==='string'?item:item?.url||item?.src||item?.image).filter(Boolean);const hero=first(game.media.hero,shots[0],game.media.cover,'');
  const all=[hero,...shots,game.media.cover].filter((value,index,list)=>value&&list.indexOf(value)===index);
  document.querySelector('#mediaFeature').innerHTML=`${imageMarkup(all[0],title)}<div><small>ГЛАВНЫЙ МАТЕРИАЛ</small><b>${esc(title)}</b></div>`;
  document.querySelector('#mediaMosaic').innerHTML=all.slice(1,7).map(url=>`<article>${imageMarkup(url,title)}</article>`).join('')||`<article>${imageMarkup('',title)}</article>`;
  document.querySelector('#mediaAll').innerHTML=all.map((url,index)=>`<article><div>${imageMarkup(url,title)}</div><b>${index===0?'Обложка и атмосфера':`Скриншот ${index}`}</b><small>${esc(title)}</small></article>`).join('')||`<article><div>${imageMarkup('',title)}</div><b>Медиа готовится</b></article>`;
}

function renderNews(game){
  const title=game.identity.title;const hero=first(game.media.hero,arr(game.media.screenshots)[0],game.media.cover,'');
  const parsed=arr(game.materials.news).map(item=>normalizeMaterial(item,'Новость',title,hero)).filter(item=>item.title);
  const official=[game.links.official&&{title:'Официальные новости и обновления',source:'Официальный сайт',url:game.links.official,description:'Новости разработчиков и издателя.'},game.links.store&&{title:'Обновления на странице магазина',source:'Магазин',url:game.links.store,description:'Патчи, объявления и данные о версии игры.'}].filter(Boolean);
  const items=[...parsed,...official];const featured=items[0]||{title:`Новости ${title}`,source:'Игропоиск',description:'Подтверждённые новости появятся после парсинга официальных источников.',url:'',image:hero};
  document.querySelector('#featuredNews').innerHTML=`${imageMarkup(first(featured.image,hero),title)}<div><span class="news-badge">${esc(featured.source||'НОВОСТИ')}</span><h2>${featured.url?`<a href="${esc(featured.url)}" target="_blank" rel="noopener noreferrer">${esc(featured.title)}</a>`:esc(featured.title)}</h2><p>${esc(featured.description||'')}</p></div>`;
  document.querySelector('#newsList').innerHTML=items.slice(1,7).map(item=>`<article>${imageMarkup(first(item.image,hero),title)}<div><h3>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:esc(item.title)}</h3><p>${esc(item.description||'')}</p><small>${esc([item.date,item.source].filter(Boolean).join(' · '))}</small></div></article>`).join('')||'<div class="empty-state">Дополнительные новости появятся после проверки источников.</div>';
  document.querySelector('#officialUpdates').innerHTML=official.map(item=>`<div><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a><span>↗</span></div>`).join('')||'<div><span>Официальные ссылки пока не найдены.</span></div>';
  document.querySelector('#timeline').innerHTML=[game.release.date_text,...parsed.map(item=>item.date).filter(Boolean)].slice(0,5).map((date,index)=>`<div><b>${index===0?'Выход игры':'Публикация'}</b><span>${esc(date)}</span></div>`).join('');
}

function requirementRows(value){
  if(!value||typeof value!=='object')return'<dt>Данные</dt><dd>Точные значения доступны только после парсинга официальной страницы магазина.</dd>';
  const entries=Object.entries(value).filter(([,item])=>nonEmpty(item));
  return entries.length?entries.map(([key,item])=>`<dt>${esc(key)}</dt><dd>${esc(Array.isArray(item)?item.join(', '):item)}</dd>`).join(''):'<dt>Данные</dt><dd>Точные значения доступны только после парсинга официальной страницы магазина.</dd>';
}

function renderRequirements(game){
  const minimum=game.requirements.minimum||game.requirements.pc?.minimum;const recommended=game.requirements.recommended||game.requirements.pc?.recommended;
  document.querySelector('#minimumRequirements').innerHTML=requirementRows(minimum);
  document.querySelector('#recommendedRequirements').innerHTML=requirementRows(recommended);
  const platforms=arr(game.requirements.platforms);
  document.querySelector('#platformRequirements').innerHTML=platforms.map(platform=>`<div><b>${esc(platform)}</b><small>Поддерживаемая платформа</small></div>`).join('')||'<div><b>Платформы уточняются</b><small>Нет подтверждённых данных</small></div>';
}

function renderGuides(game){
  const title=game.identity.title;const hero=first(game.media.hero,arr(game.media.screenshots)[0],game.media.cover,'');const features=arr(game.editorial.features).filter(Boolean);
  document.querySelector('#featuredGuide').innerHTML=`${imageMarkup(hero,title)}<div><small>ГАЙД ИГРОПОИСКА</small><h2>С чего начать в ${esc(title)}</h2><p>${esc(features[0]||'Сначала изучите основные системы и не спешите переходить к сложным заданиям.')}</p></div>`;
  const parsed=arr(game.materials.guides).map(item=>normalizeMaterial(item,'Гайд',title,hero));
  const generated=(features.length?features:['Первые шаги','Развитие персонажа','Исследование мира','Сложные задания']).slice(0,4).map((feature,index)=>({source:'Игропоиск',title:index===0?'Первые шаги':feature,description:index===0?`Основные системы ${title} и порядок знакомства с ними.`:`Практический разбор: ${feature}.`,image:hero}));
  const items=[...parsed,...generated].slice(0,8);
  document.querySelector('#guideGrid').innerHTML=items.map(item=>`<article class="game-panel guide-card">${imageMarkup(first(item.image,hero),title)}<div><small>${esc(item.source||'Игропоиск')}</small><h3>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:esc(item.title)}</h3><p>${esc(item.description||'')}</p></div></article>`).join('');
  document.querySelector('#guideQuickLinks').innerHTML=features.slice(0,6).map(feature=>`<a href="#">${esc(feature)}</a>`).join('')||'<span class="ig-muted">Ссылки формируются из проверенных особенностей игры.</span>';
  document.querySelector('#guideUpdated').innerHTML=`<div class="updated-guide"><span>Страница игры</span><b>${esc(game.release.date_text)}</b></div>`;
}

function renderSources(game){
  const sources=[...arr(game.sources),game.links.official&&{title:'Официальный сайт',url:game.links.official,domain:new URL(game.links.official).hostname},game.links.store&&{title:'Страница магазина',url:game.links.store,domain:new URL(game.links.store).hostname}].filter(Boolean).filter((item,index,list)=>item.url&&list.findIndex(other=>other.url===item.url)===index);
  document.querySelector('#sources').innerHTML=sources.map(source=>`<div><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.source_name||source.domain)}</a><span>${esc(source.domain||'↗')}</span></div>`).join('')||'<div><span>Источники находятся на редакционной проверке.</span></div>';
  document.querySelector('#sourceCount').textContent=sources.length?String(sources.length):'';
}

function bindTabs(){document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('.game-tab').forEach(section=>section.classList.toggle('active',section.id===button.dataset.tab));window.scrollTo({top:document.querySelector('.game-tabs').offsetTop-root.style.getPropertyValue('--ig-header-height'),behavior:'smooth'})}))}

function bindTheme(){const button=document.querySelector('#theme');root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';const paint=()=>button.textContent=root.dataset.theme==='light'?'☾':'☀';paint();button.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()})}

function bindStateButton(selector,key,activeText,inactiveText){const button=document.querySelector(selector);const storageKey=`igropoisk-${key}-${slug}`;const paint=()=>{const active=localStorage.getItem(storageKey)==='1';button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);button.textContent=active?activeText:inactiveText};button.addEventListener('click',()=>{localStorage.setItem(storageKey,localStorage.getItem(storageKey)==='1'?'0':'1');paint()});paint()}

function bindRating(title){
  const dialog=document.querySelector('#ratingDialog');const scale=document.querySelector('#ratingScale');const storageKey=`igropoisk-rating-${slug}`;
  document.querySelector('#ratingDialogTitle').textContent=title;
  scale.innerHTML=Array.from({length:10},(_,index)=>`<button type="button" data-rating="${index+1}">${index+1}</button>`).join('');
  const paint=()=>{const value=localStorage.getItem(storageKey);scale.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.rating===value));document.querySelector('#rateGame').textContent=value?`Ваша оценка: ${value}`:'Оценить игру';document.querySelector('#rateInline').textContent=value?`Ваша оценка: ${value}`:'Оценить игру'};
  scale.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{localStorage.setItem(storageKey,button.dataset.rating);paint();dialog.close()}));
  [document.querySelector('#rateGame'),document.querySelector('#rateInline')].forEach(button=>button.addEventListener('click',()=>dialog.showModal()));
  document.querySelector('#ratingClose').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});paint();
}

async function load(){
  shellHTML();
  root.dataset.designSystem='igropoisk-game-v2';
  const chunk=chunkForYear(seedYear);
  const [curatedFile,draft,awards,catalog]=await Promise.all([
    fetchJSON(`../../data/game-content/${chunk}.json`),fetchJSON(`../../data/drafts/${shell.draft||slug}.json`),fetchJSON(`../../data/awards/${slug}.json`),fetchJSON('../../data/catalog-visible.json')
  ]);
  const curated=curatedFile?.games?.[slug]||null;
  const game=mergeGame(curated,draft,awards);
  document.title=`${game.identity.title} — Игропоиск`;
  renderHero(game);renderOverview(game,catalog);renderReviews(game);renderMedia(game);renderNews(game);renderRequirements(game);renderGuides(game);renderSources(game);
  bindTabs();bindTheme();bindStateButton('#favorite','favorite','♥ В избранном','♡ В избранное');bindStateButton('#wantToPlay','want','✓ Хочу сыграть','＋ Хочу сыграть');bindRating(game.identity.title);installImageFallbacks();
}

load();
})();
