(()=>{
'use strict';

const root=document.documentElement;
const shell=document.body.dataset;
const slug=shell.slug||location.pathname.split('/').filter(Boolean).at(-1)||'game';
const seedTitle=shell.title||slug.replace(/-/g,' ');
const seedYear=Number(shell.year)||0;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const nonEmpty=value=>value!==null&&value!==undefined&&value!=='';
const first=(...values)=>values.find(nonEmpty);
const join=value=>arr(value).filter(Boolean).join(', ');
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const initials=value=>String(value||'Игра').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const chunkForYear=year=>year<=2015?'2002-2015':year<=2017?'2016-2017':year<=2019?'2018-2019':year===2020?'2020':year<=2022?'2021-2022':'2023-2025';
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch(error){console.warn('Игропоиск:',url,error);return null}};
const formatScore=value=>{const number=Number(value);return Number.isFinite(number)?(number>10?String(Math.round(number)):number.toFixed(1).replace('.0','')):'—'};
const mediaUrl=item=>typeof item==='string'?item:first(item?.url,item?.src,item?.image,item?.thumbnail,item?.poster,'');
const unique=list=>list.filter((value,index,items)=>value&&items.indexOf(value)===index);

const fallback={
  identity:{slug,title:seedTitle,steam_appid:null},release:{date_text:seedYear||'Уточняется'},
  companies:{developers:[],publishers:[]},classification:{genres:[],platforms:[],categories:[]},
  editorial:{short_description:`${seedTitle} — игра ${seedYear||''} года.`,integrated_description:'',features:[]},
  media:{hero:'',cover:'',screenshots:[],videos:[],artwork:[]},ratings:{igropoisk:null,users:null,user_votes:0},
  links:{official:'',store:''},materials:{reviews:[],news:[],guides:[]},requirements:{platforms:[]},sources:[],awards:[]
};

function draftMatches(curated,draft){
  if(!draft?.identity)return false;
  const expectedId=Number(curated?.identity?.steam_appid),actualId=Number(draft.identity.steam_appid);
  return expectedId&&actualId?expectedId===actualId:canonical(draft.identity.title)===canonical(curated?.identity?.title||seedTitle);
}

function mergeGame(curatedRaw,draftRaw,awardsRaw,reviewFeed,ratingFeed,newsFeed){
  const curated=curatedRaw||{};
  const game={...fallback,...curated,
    identity:{...fallback.identity,...curated.identity},release:{...fallback.release,...curated.release},
    companies:{...fallback.companies,...curated.companies},classification:{...fallback.classification,...curated.classification},
    editorial:{...fallback.editorial,...curated.editorial},media:{...fallback.media,...curated.media},ratings:{...fallback.ratings,...curated.ratings},
    links:{...fallback.links,...curated.links},materials:{...fallback.materials,...curated.materials},requirements:{...fallback.requirements,...curated.requirements},
    sources:arr(curated.sources),awards:arr(curated.awards)
  };
  if(draftMatches(game,draftRaw)){
    const draft=draftRaw;
    game.media={...draft.media,...game.media,
      hero:first(game.media.hero,draft.media?.hero,''),cover:first(game.media.cover,draft.media?.cover,''),
      screenshots:arr(game.media.screenshots).length?arr(game.media.screenshots):arr(draft.media?.screenshots),
      videos:arr(game.media.videos).length?arr(game.media.videos):arr(draft.media?.videos),
      artwork:arr(game.media.artwork).length?arr(game.media.artwork):arr(draft.media?.artwork)
    };
    game.links={...draft.links,...game.links,official:first(game.links.official,draft.links?.official,''),store:first(game.links.store,draft.links?.store,'')};
    game.sources=[...arr(game.sources),...arr(draft.sources)].filter((item,index,list)=>item?.url&&list.findIndex(other=>other.url===item.url)===index);
    if(!game.editorial.integrated_description)game.editorial.integrated_description=draft.editorial?.integrated_description||'';
    if(!game.editorial.short_description)game.editorial.short_description=draft.editorial?.short_description||'';
  }
  game.awards=[...arr(game.awards),...arr(awardsRaw?.awards||awardsRaw)].filter((item,index,list)=>item?.name&&(item.source_url||item.url)&&list.findIndex(other=>other.name===item.name&&(other.source_url||other.url)===(item.source_url||item.url))===index);
  if(reviewFeed?.reviews)game.materials.reviews=reviewFeed.reviews;
  if(reviewFeed?.igropoisk_article)game.igropoisk_article=reviewFeed.igropoisk_article;
  if(newsFeed?.items)game.materials.news=newsFeed.items;
  if(nonEmpty(ratingFeed?.calculation?.score_10))game.ratings.igropoisk=ratingFeed.calculation.score_10;
  game.rating_method=ratingFeed||null;
  const appid=Number(game.identity.steam_appid);
  if(appid){game.media.hero=first(game.media.hero,`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`);game.media.cover=first(game.media.cover,`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`)}
  game.requirements.platforms=arr(game.requirements.platforms).length?arr(game.requirements.platforms):arr(game.classification.platforms);
  return game;
}

function shellHTML(){
  document.body.innerHTML=`
<header class="game-header"><div class="ig-container game-header__inner"><a class="game-logo" href="../../index.html">ИГРОПОИСК</a><nav class="game-nav"><a href="../../index.html">Главное</a><a href="../../index.html#search">Поиск игр</a><a href="../../index.html#news">Новости</a></nav><div class="game-header__actions"><a class="header-icon" href="../../index.html#search" aria-label="Поиск">⌕</a><button class="header-icon" id="theme" type="button" aria-label="Переключить тему">☀</button></div></div></header>
<section class="game-hero" id="gameHero"><div class="ig-container game-hero__inner"><div class="breadcrumbs"><a href="../../index.html">Главное</a> / <a href="../../index.html#search">Игры</a> / <span id="crumb"></span></div><div class="hero-copy"><h1 id="gameTitle"></h1><div class="hero-meta" id="gameMeta"></div><div class="hero-actions"><button class="state-button" id="favorite" type="button" aria-pressed="false">♡ В избранное</button><button class="state-button" id="wantToPlay" type="button" aria-pressed="false">＋ Хочу сыграть</button><button class="state-button accent" id="rateGame" type="button">Оценить игру</button></div></div><aside class="hero-score-area"><div class="hero-score-card ig-glass-panel"><div class="score-line"><strong class="ig-score-editorial" id="editorialScore">—</strong><div><b>Рейтинг Игропоиска</b><small id="editorialNote">Расчёт по источникам</small></div></div><div class="score-line"><strong class="ig-score-user" id="userScore">—</strong><div><b>Оценка игроков</b><small id="userScoreNote">Оценок пока нет</small></div></div><button class="text-action" id="rateInline" type="button">Оценить игру</button></div></aside><div class="hero-media-shell"><button class="hero-media-arrow prev" id="heroPrev" type="button" aria-label="Предыдущие скриншоты">‹</button><div class="hero-media" id="heroMedia" aria-label="Медиа игры"></div><button class="hero-media-arrow next" id="heroNext" type="button" aria-label="Следующие скриншоты">›</button></div></div></section>
<main class="ig-container game-main"><nav class="game-tabs" role="tablist"><button class="active" data-tab="overview">Об игре</button><button data-tab="reviews">Обзоры</button><button data-tab="media">Медиа</button><button data-tab="news">Новости</button><button data-tab="requirements">Системные требования</button><button data-tab="guides">Гайды</button><button data-tab="sourcesTab">Источники <span id="sourceCount"></span></button></nav>
<section class="game-tab active" id="overview"><div class="overview-grid"><article class="game-panel about-panel"><h2>Об игре</h2><p id="description"></p><h3>Жанры</h3><div class="tag-row" id="genreTags"></div></article><article class="game-panel"><h2>Ключевые особенности</h2><ul class="feature-list" id="featureList"></ul></article><aside class="game-panel"><h2>Информация</h2><dl class="detail-table" id="details"></dl></aside><aside class="game-panel"><h2>Оценки</h2><div class="rating-list" id="ratingList"></div></aside></div><div class="lower-grid"><section class="game-panel"><h2>Официальные страницы</h2><div class="store-list" id="officialLinks"></div></section><section class="game-panel similar-panel"><h2>Похожие игры</h2><div class="similar-row" id="similarGames"></div></section><section class="game-panel" id="awardsPanel" hidden><h2>Награды из источников</h2><div class="award-sources" id="awards"></div></section></div></section>
<section class="game-tab" id="reviews"><div class="reviews-main"><article class="game-panel ig-review-feature" id="featuredReview"></article><div class="reviews-heading"><h2>Обзоры других изданий</h2><span class="ig-muted" id="externalReviewCount"></span></div><div class="ig-external-review-grid" id="reviewGrid"></div></div></section>
<section class="game-tab" id="media"><section class="ig-media-group" id="videoGroup"><div class="ig-media-group__head"><h2>Видео</h2><span id="videoCount"></span></div><div class="ig-media-grid" id="mediaVideos"></div></section><section class="ig-media-group" id="screenshotGroup"><div class="ig-media-group__head"><h2>Скриншоты</h2><span id="screenshotCount"></span></div><div class="ig-media-grid" id="mediaScreenshots"></div></section><section class="ig-media-group" id="artGroup"><div class="ig-media-group__head"><h2>Арты и обложки</h2><span id="artCount"></span></div><div class="ig-media-grid" id="mediaArt"></div></section></section>
<section class="game-tab" id="news"><div class="news-layout"><div><article class="game-panel featured-news" id="featuredNews"></article><div class="game-panel news-list" id="newsList"></div></div><aside class="news-sidebar"><section class="game-panel"><h2>Официальные обновления</h2><div class="source-list" id="officialUpdates"></div></section><section class="game-panel"><h2>Хронология</h2><div class="timeline" id="timeline"></div></section></aside></div></section>
<section class="game-tab" id="requirements"><div class="requirements-notice">Платформы и технические характеристики показываются только из данных магазина или официального источника.</div><div class="requirements-grid"><section class="game-panel"><h2>Минимальные</h2><dl class="requirements-table" id="minimumRequirements"></dl></section><section class="game-panel"><h2>Рекомендуемые</h2><dl class="requirements-table" id="recommendedRequirements"></dl></section><section class="game-panel platforms-panel"><h2>Платформы</h2><div id="platformRequirements"></div></section></div></section>
<section class="game-tab" id="guides"><div class="guides-layout"><div><article class="game-panel featured-guide" id="featuredGuide"></article><div class="guide-grid" id="guideGrid"></div></div><aside class="sidebar-stack"><section class="game-panel"><h2>Быстрые ссылки</h2><div class="quick-links" id="guideQuickLinks"></div></section><section class="game-panel"><h2>Обновлено</h2><div id="guideUpdated"></div></section></aside></div></section>
<section class="game-tab" id="sourcesTab"><div class="game-panel"><h2>Источники данных</h2><div class="source-list" id="sources"></div></div></section></main>
<dialog class="rating-dialog" id="ratingDialog"><div class="rating-dialog__body"><div class="rating-dialog__head"><div><h2>Оценить игру</h2><p id="ratingDialogTitle"></p></div><button class="rating-dialog__close" id="ratingClose" type="button" aria-label="Закрыть">×</button></div><div class="rating-scale" id="ratingScale"></div><div class="rating-dialog__note" id="ratingNote">Оценка отправляется в постоянную базу. Для одной игры учитывается одна текущая оценка с уникального IP; история изменений сохраняется.</div></div></dialog>`;
}

function imageMarkup(url,title,className=''){
  return url?`<img class="${className}" src="${esc(url)}" alt="${esc(title)}" loading="lazy" data-fallback="${esc(initials(title))}">`:`<div class="media-placeholder ${className}">${esc(initials(title))}</div>`;
}
function installImageFallbacks(){document.querySelectorAll('img[data-fallback]').forEach(image=>image.addEventListener('error',()=>{const replacement=document.createElement('div');replacement.className=`media-placeholder ${image.className||''}`;replacement.textContent=image.dataset.fallback||'И';image.replaceWith(replacement)},{once:true}))}

function renderHero(game){
  const title=game.identity.title||seedTitle;
  const shots=unique(arr(game.media.screenshots).map(mediaUrl));
  const videos=arr(game.media.videos).map(item=>typeof item==='string'?{thumbnail:item}:item).filter(Boolean);
  const hero=first(game.media.hero,shots[0],game.media.cover,'');
  const heroNode=document.querySelector('#gameHero');
  const setHero=(url,button)=>{if(url)heroNode.style.backgroundImage=`url("${String(url).replace(/"/g,'%22')}")`;document.querySelectorAll('.hero-media__item').forEach(item=>item.classList.toggle('active',item===button))};
  setHero(hero,null);
  document.querySelector('#gameTitle').textContent=title;document.querySelector('#crumb').textContent=title;
  document.querySelector('#gameMeta').textContent=[game.release.date_text,join(game.classification.genres),join(game.companies.developers)].filter(Boolean).join(' · ');
  document.querySelector('#editorialScore').textContent=formatScore(game.ratings.igropoisk);
  document.querySelector('#editorialNote').textContent=game.rating_method?.method?.name||'Сводная редакционная оценка';
  const votes=Number(game.ratings.user_votes||0),userValue=votes>0?game.ratings.users:null;
  document.querySelector('#userScore').textContent=formatScore(userValue);document.querySelector('#userScoreNote').textContent=votes>0?`${votes.toLocaleString('ru-RU')} оценок`:'Оценок пока нет';
  const items=[...videos.map(video=>({url:first(video.thumbnail,video.poster,video.image,video.url),video:true,label:first(video.title,'Видео')})),...shots.map((url,index)=>({url,label:`Скриншот ${index+1}`})),...unique([game.media.cover,game.media.hero]).filter(url=>url&&!shots.includes(url)).map(url=>({url,label:'Арт'}))].filter(item=>item.url);
  const rail=document.querySelector('#heroMedia');
  rail.innerHTML=items.map((item,index)=>`<button class="hero-media__item${item.video?' trailer':''}${index===0?' active':''}" type="button" data-image="${esc(item.url)}">${imageMarkup(item.url,item.label||title)}${item.video?'<span class="play">▶</span><b>ВИДЕО</b>':''}</button>`).join('')||`<div class="hero-media__item">${imageMarkup('',title)}</div>`;
  rail.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>setHero(button.dataset.image,button)));
  const prev=document.querySelector('#heroPrev'),next=document.querySelector('#heroNext');
  const update=()=>{prev.disabled=rail.scrollLeft<4;next.disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-4};
  const move=direction=>rail.scrollBy({left:direction*rail.clientWidth*.72,behavior:'smooth'});
  prev.onclick=()=>move(-1);next.onclick=()=>move(1);rail.addEventListener('scroll',update,{passive:true});requestAnimationFrame(update);
}

async function hydrateSimilarGames(catalog){
  const nearby=arr(catalog).filter(item=>item.slug!==slug).sort((a,b)=>Math.abs(Number(a.year)-seedYear)-Math.abs(Number(b.year)-seedYear)).slice(0,10);
  const chunks=[...new Set(nearby.map(item=>chunkForYear(Number(item.year))))];
  const files=await Promise.all(chunks.map(chunk=>fetchJSON(`../../data/game-content/${chunk}.json`)));
  const records=new Map();files.forEach(file=>Object.entries(file?.games||{}).forEach(([key,value])=>records.set(key,value)));
  document.querySelector('#similarGames').innerHTML=nearby.map(item=>{
    const game=records.get(item.slug)||{};const appid=Number(game.identity?.steam_appid);
    const image=first(game.media?.hero,mediaUrl(arr(game.media?.screenshots)[0]),game.media?.cover,appid?`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`:'');
    return `<a class="ig-game-card-wide" href="../${encodeURIComponent(item.slug)}/"><div class="ig-game-card-wide__media">${imageMarkup(image,item.title)}</div><div class="ig-game-card-wide__body"><b>${esc(item.title)}</b><span>${esc(item.year||'')}</span></div></a>`;
  }).join('');installImageFallbacks();
}

function renderOverview(game,catalog){
  const title=game.identity.title;document.querySelector('#description').textContent=first(game.editorial.integrated_description,game.editorial.short_description,`${title} — страница игры в каталоге Игропоиска.`);
  const genres=[...arr(game.classification.genres),...arr(game.classification.categories).filter(value=>!/achievement/i.test(String(value)))].slice(0,10);
  document.querySelector('#genreTags').innerHTML=genres.map(value=>`<span class="game-chip">${esc(value)}</span>`).join('')||'<span class="game-chip">Жанр уточняется</span>';
  const features=arr(game.editorial.features).filter(Boolean).slice(0,8);document.querySelector('#featureList').innerHTML=(features.length?features:['Исследование мира','Развитие персонажа','Сюжетные задания','Вариативные решения']).map(value=>`<li>${esc(value)}</li>`).join('');
  document.querySelector('#details').innerHTML=`<dt>Дата выхода</dt><dd>${esc(game.release.date_text)}</dd><dt>Разработчик</dt><dd>${esc(join(game.companies.developers)||'Уточняется')}</dd><dt>Издатель</dt><dd>${esc(join(game.companies.publishers)||'Уточняется')}</dd><dt>Жанры</dt><dd>${esc(join(game.classification.genres)||'Уточняются')}</dd>`;
  const editorial=Number(game.ratings.igropoisk),users=Number(game.ratings.users),votes=Number(game.ratings.user_votes||0);
  document.querySelector('#ratingList').innerHTML=`<div><span>Игропоиск</span><i><b style="width:${Number.isFinite(editorial)?Math.min(100,editorial*10):0}%"></b></i><strong>${formatScore(editorial)}</strong></div><div><span>Игроки</span><i><b style="width:${votes>0&&Number.isFinite(users)?Math.min(100,users*10):0}%"></b></i><strong class="ig-score-user">${votes>0?formatScore(users):'—'}</strong></div>`;
  const links=[game.links.official&&['Официальный сайт',game.links.official],game.links.store&&['Страница магазина',game.links.store]].filter(Boolean);document.querySelector('#officialLinks').innerHTML=links.map(([label,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(label)}</b><span>Открыть ↗</span></a>`).join('')||'<div><b>Ссылки проверяются</b><span>Нет подтверждённого URL</span></div>';
  renderAwards(game.awards);hydrateSimilarGames(catalog);
}
function renderAwards(awards){const valid=arr(awards).filter(item=>item?.name&&(item.source_url||item.url));const panel=document.querySelector('#awardsPanel');panel.hidden=!valid.length;document.querySelector('#awards').innerHTML=valid.map(item=>`<a class="award-source" style="grid-template-columns:1fr" href="${esc(item.source_url||item.url)}" target="_blank" rel="noopener noreferrer"><div><b>${esc(item.name)}</b>${item.category?`<span>${esc(item.category)}</span>`:''}<small>${esc([item.year,item.source_name||item.source].filter(Boolean).join(' · '))} ↗</small></div></a>`).join('')}

function normalizeReview(item,title,hero){return{source:first(item?.source,item?.source_name,item?.domain,'Издание'),title:first(item?.title,item?.name,`Обзор ${title}`),description:first(item?.description,item?.summary,''),score:item?.score,scale:item?.scale,url:first(item?.url,item?.source_url,''),image:first(item?.image,item?.thumbnail,hero,'')}}
function renderReviews(game){
  const title=game.identity.title,hero=first(game.media.hero,mediaUrl(arr(game.media.screenshots)[0]),game.media.cover,'');
  const article=game.igropoisk_article;const articleUrl=article?.url||'';
  document.querySelector('#featuredReview').innerHTML=`<div class="ig-review-feature__media">${imageMarkup(hero,title)}</div><div class="ig-review-feature__body"><small>ОБЗОР ИГРОПОИСКА</small><h2>${esc(article?.title||`Обзор ${title}`)}</h2><p>${esc(article?.description||first(game.editorial.integrated_description,game.editorial.short_description))}</p><div class="ig-review-feature__meta"><strong class="ig-review-feature__score">${formatScore(first(article?.score,game.ratings.igropoisk))}/10</strong><span>Редакционный синтез нескольких источников</span></div>${articleUrl?`<a class="ig-review-link" href="${esc(articleUrl)}">Открыть полный обзор →</a>`:'<div class="article-source-note">Статья ещё не опубликована.</div>'}</div>`;
  const reviews=arr(game.materials.reviews).map(item=>normalizeReview(item,title,hero)).filter(item=>item.url);
  document.querySelector('#externalReviewCount').textContent=reviews.length?`${reviews.length} материалов`:'';
  document.querySelector('#reviewGrid').innerHTML=reviews.map(item=>`<article class="ig-external-review"><div class="ig-external-review__head"><span>${esc(item.source)}</span>${nonEmpty(item.score)?`<strong class="ig-external-review__score">${formatScore(item.score)}${Number(item.scale)===100?'/100':'/10'}</strong>`:''}</div><h3>${esc(item.title)}</h3><p>${esc(item.description||'Открыть оригинальный обзор издания.')}</p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Перейти к обзору ↗</a></article>`).join('')||'<div class="empty-state">Внешние обзоры появятся после парсинга реальных публикаций.</div>';
}

function mediaCard(url,title,label,video=false){return `<article class="ig-media-card"><div class="ig-media-card__image">${imageMarkup(url,title)}${video?'<span class="ig-play-overlay">▶</span>':''}</div><div class="ig-media-card__body"><b>${esc(label)}</b><small>${esc(title)}</small></div></article>`}
function renderMedia(game){
  const title=game.identity.title;const videos=arr(game.media.videos).map(item=>typeof item==='string'?{thumbnail:item,title:'Видео'}:item).filter(Boolean);const shots=unique(arr(game.media.screenshots).map(mediaUrl));const art=unique([...arr(game.media.artwork).map(mediaUrl),game.media.cover,game.media.hero]).filter(url=>!shots.includes(url));
  const groups=[['videoGroup','mediaVideos','videoCount',videos, item=>mediaCard(first(item.thumbnail,item.poster,item.image,item.url),title,first(item.title,'Видео'),true)],['screenshotGroup','mediaScreenshots','screenshotCount',shots,(url,index)=>mediaCard(url,title,`Скриншот ${index+1}`)],['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт']];
  groups.forEach(([groupId,targetId,countId,items,render])=>{const group=document.querySelector(`#${groupId}`);group.hidden=!items.length;document.querySelector(`#${countId}`).textContent=items.length?String(items.length):'';document.querySelector(`#${targetId}`).innerHTML=items.map(render).join('')});
}

function normalizeMaterial(item,type,title,image){if(typeof item==='string')return{title:item,description:'',source:'Игропоиск',url:'',image,type};return{title:first(item?.title,item?.name,`${type}: ${title}`),description:first(item?.description,item?.summary,item?.text,''),source:first(item?.source_name,item?.source,item?.domain,'Игропоиск'),url:first(item?.url,item?.source_url,''),image:first(item?.image,item?.thumbnail,image,''),date:first(item?.date,item?.published_at,''),type}}
function renderNews(game){
  const title=game.identity.title,hero=first(game.media.hero,mediaUrl(arr(game.media.screenshots)[0]),game.media.cover,'');const parsed=arr(game.materials.news).map(item=>normalizeMaterial(item,'Новость',title,hero)).filter(item=>item.title);
  const official=[game.links.official&&{title:'Официальные новости и обновления',source:'Официальный сайт',url:game.links.official,description:'Новости разработчиков и издателя.'},game.links.store&&{title:'Обновления на странице магазина',source:'Магазин',url:game.links.store,description:'Патчи, объявления и данные о версии игры.'}].filter(Boolean);const items=[...parsed,...official];const featured=items[0]||{title:`Новости ${title}`,source:'Игропоиск',description:'Подтверждённые новости появятся после работы новостного парсера.',image:hero};
  document.querySelector('#featuredNews').innerHTML=`${imageMarkup(first(featured.image,hero),title)}<div><span class="news-badge">${esc(featured.source||'НОВОСТИ')}</span><h2>${featured.url?`<a href="${esc(featured.url)}" target="_blank" rel="noopener noreferrer">${esc(featured.title)}</a>`:esc(featured.title)}</h2><p>${esc(featured.description||'')}</p></div>`;
  document.querySelector('#newsList').innerHTML=items.slice(1,7).map(item=>`<article>${imageMarkup(first(item.image,hero),title)}<div><h3>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:esc(item.title)}</h3><p>${esc(item.description||'')}</p><small>${esc([item.date,item.source].filter(Boolean).join(' · '))}</small></div></article>`).join('')||'<div class="empty-state">Дополнительные новости появятся после проверки источников.</div>';
  document.querySelector('#officialUpdates').innerHTML=official.map(item=>`<div><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a><span>↗</span></div>`).join('')||'<div><span>Официальные ссылки пока не найдены.</span></div>';document.querySelector('#timeline').innerHTML=[game.release.date_text,...parsed.map(item=>item.date).filter(Boolean)].slice(0,5).map((date,index)=>`<div><b>${index===0?'Выход игры':'Публикация'}</b><span>${esc(date)}</span></div>`).join('');
}
function requirementRows(value){if(!value||typeof value!=='object')return'<dt>Данные</dt><dd>Точные значения доступны только после парсинга официальной страницы магазина.</dd>';const entries=Object.entries(value).filter(([,item])=>nonEmpty(item));return entries.length?entries.map(([key,item])=>`<dt>${esc(key)}</dt><dd>${esc(Array.isArray(item)?item.join(', '):item)}</dd>`).join(''):'<dt>Данные</dt><dd>Точные значения доступны только после парсинга официальной страницы магазина.</dd>'}
function renderRequirements(game){document.querySelector('#minimumRequirements').innerHTML=requirementRows(game.requirements.minimum||game.requirements.pc?.minimum);document.querySelector('#recommendedRequirements').innerHTML=requirementRows(game.requirements.recommended||game.requirements.pc?.recommended);document.querySelector('#platformRequirements').innerHTML=arr(game.requirements.platforms).map(platform=>`<div><b>${esc(platform)}</b><small>Поддерживаемая платформа</small></div>`).join('')||'<div><b>Платформы уточняются</b><small>Нет подтверждённых данных</small></div>'}
function renderGuides(game){const title=game.identity.title,hero=first(game.media.hero,mediaUrl(arr(game.media.screenshots)[0]),game.media.cover,''),features=arr(game.editorial.features).filter(Boolean);document.querySelector('#featuredGuide').innerHTML=`${imageMarkup(hero,title)}<div><small>ГАЙД ИГРОПОИСКА</small><h2>С чего начать в ${esc(title)}</h2><p>${esc(features[0]||'Сначала изучите основные системы игры.')}</p></div>`;const parsed=arr(game.materials.guides).map(item=>normalizeMaterial(item,'Гайд',title,hero));document.querySelector('#guideGrid').innerHTML=parsed.map(item=>`<article class="game-panel guide-card">${imageMarkup(first(item.image,hero),title)}<div><small>${esc(item.source)}</small><h3>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`:esc(item.title)}</h3><p>${esc(item.description||'')}</p></div></article>`).join('')||'<div class="empty-state">Гайды появятся после редакционной подготовки.</div>';document.querySelector('#guideQuickLinks').innerHTML=features.slice(0,6).map(feature=>`<span>${esc(feature)}</span>`).join('')||'<span class="ig-muted">Материалы готовятся.</span>';document.querySelector('#guideUpdated').innerHTML=`<div class="updated-guide"><span>Страница игры</span><b>${esc(game.release.date_text)}</b></div>`}
function renderSources(game){const safeHost=url=>{try{return new URL(url).hostname}catch{return''}};const sources=[...arr(game.sources),game.links.official&&{title:'Официальный сайт',url:game.links.official,domain:safeHost(game.links.official)},game.links.store&&{title:'Страница магазина',url:game.links.store,domain:safeHost(game.links.store)}].filter(Boolean).filter((item,index,list)=>item.url&&list.findIndex(other=>other.url===item.url)===index);document.querySelector('#sources').innerHTML=sources.map(source=>`<div><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.source_name||source.domain)}</a><span>${esc(source.domain||'↗')}</span></div>`).join('')||'<div><span>Источники находятся на редакционной проверке.</span></div>';document.querySelector('#sourceCount').textContent=sources.length?String(sources.length):''}

function bindTabs(){document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('.game-tab').forEach(section=>section.classList.toggle('active',section.id===button.dataset.tab));const top=document.querySelector('.game-tabs').getBoundingClientRect().top+scrollY-64;scrollTo({top,behavior:'smooth'})}))}
function bindTheme(){const button=document.querySelector('#theme');root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';const paint=()=>button.textContent=root.dataset.theme==='light'?'☾':'☀';paint();button.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()}}
function bindStateButton(selector,key,activeText,inactiveText){const button=document.querySelector(selector),storageKey=`igropoisk-${key}-${slug}`;const paint=()=>{const active=localStorage.getItem(storageKey)==='1';button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);button.textContent=active?activeText:inactiveText};button.onclick=()=>{localStorage.setItem(storageKey,localStorage.getItem(storageKey)==='1'?'0':'1');paint()};paint()}

async function refreshUserRating(apiBase,game){
  if(!apiBase)return;
  const data=await fetchJSON(`${apiBase.replace(/\/$/,'')}/api/ratings/${encodeURIComponent(slug)}`);if(!data)return;
  game.ratings.users=data.average;game.ratings.user_votes=data.count;const votes=Number(data.count||0);document.querySelector('#userScore').textContent=votes?formatScore(data.average):'—';document.querySelector('#userScoreNote').textContent=votes?`${votes.toLocaleString('ru-RU')} оценок`:'Оценок пока нет';
}
function bindRating(title,runtime,game){
  const dialog=document.querySelector('#ratingDialog'),scale=document.querySelector('#ratingScale'),note=document.querySelector('#ratingNote'),apiBase=String(runtime?.ratings_api_base||'').replace(/\/$/,'');document.querySelector('#ratingDialogTitle').textContent=title;scale.innerHTML=Array.from({length:10},(_,index)=>`<button type="button" data-rating="${index+1}">${index+1}</button>`).join('');
  const open=()=>dialog.showModal();[document.querySelector('#rateGame'),document.querySelector('#rateInline')].forEach(button=>button.onclick=open);document.querySelector('#ratingClose').onclick=()=>dialog.close();dialog.onclick=event=>{if(event.target===dialog)dialog.close()};
  if(!apiBase){scale.querySelectorAll('button').forEach(button=>button.disabled=true);note.innerHTML='<strong>Сервер оценок ещё не подключён.</strong> GitHub Pages не может хранить голоса в базе. Backend-модуль подготовлен в репозитории и должен быть развёрнут отдельно.';return}
  scale.querySelectorAll('button').forEach(button=>button.onclick=async()=>{button.disabled=true;note.textContent='Сохраняем оценку…';try{const response=await fetch(`${apiBase}/api/ratings/${encodeURIComponent(slug)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rating:Number(button.dataset.rating)})});const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);note.textContent='Оценка сохранена. Учитывается одна текущая оценка с IP; история изменений записана.';document.querySelector('#rateGame').textContent=`Ваша оценка: ${button.dataset.rating}`;document.querySelector('#rateInline').textContent=`Ваша оценка: ${button.dataset.rating}`;await refreshUserRating(apiBase,game);setTimeout(()=>dialog.close(),500)}catch(error){note.textContent=`Не удалось сохранить: ${error.message}`}finally{button.disabled=false}})
}

async function load(){
  shellHTML();root.dataset.designSystem='igropoisk-game-v3';const chunk=chunkForYear(seedYear);
  const [curatedFile,draft,awards,catalog,reviews,rating,news,runtime]=await Promise.all([fetchJSON(`../../data/game-content/${chunk}.json`),fetchJSON(`../../data/drafts/${shell.draft||slug}.json`),fetchJSON(`../../data/awards/${slug}.json`),fetchJSON('../../data/catalog-visible.json'),fetchJSON(`../../data/reviews/${slug}.json`),fetchJSON(`../../data/ratings/${slug}.json`),fetchJSON(`../../data/news/${slug}.json`),fetchJSON('../../config/runtime.json')]);
  const game=mergeGame(curatedFile?.games?.[slug]||null,draft,awards,reviews,rating,news);document.title=`${game.identity.title} — Игропоиск`;
  renderHero(game);renderOverview(game,catalog);renderReviews(game);renderMedia(game);renderNews(game);renderRequirements(game);renderGuides(game);renderSources(game);bindTabs();bindTheme();bindStateButton('#favorite','favorite','♥ В избранном','♡ В избранное');bindStateButton('#wantToPlay','want','✓ Хочу сыграть','＋ Хочу сыграть');bindRating(game.identity.title,runtime,game);installImageFallbacks();await refreshUserRating(runtime?.ratings_api_base,game);
}
load();
})();
