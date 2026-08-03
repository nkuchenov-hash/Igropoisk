(()=>{
'use strict';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_GENITIVE=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const state={releases:[],changes:[],view:matchMedia('(max-width:760px)').matches?'list':'calendar',cursor:new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)),bookmarks:new Set(JSON.parse(localStorage.getItem('igroReleaseBookmarks')||'[]'))};

const primaryEvent=game=>(game.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
const eventDate=event=>event.date||event.date_start||null;
const dateObject=value=>value?new Date(`${value}T12:00:00Z`):null;
const imageUrl=game=>{const local=game.image?.local_url;if(local)return local.startsWith('assets/')?`../${local}`:local;return game.image?.source_url||''};
const sourceStatus=event=>event.status==='confirmed'?'Подтверждено':'Ожидает подтверждения';
const precisionLabel=precision=>({exact:'Точная дата',month:'Месяц',quarter:'Квартал',year:'Год',tbd:'Дата уточняется'}[precision]||'Дата уточняется');
const editorialLabel=status=>({discovered:'Обнаружено',needs_review:'Требует проверки',draft:'Черновик страницы',ready:'Готово к публикации',published:'Страница опубликована'}[status]||'Черновик страницы');
const dateLabel=event=>{
  if(event.precision==='tbd'||!eventDate(event))return 'Дата уточняется';
  const d=dateObject(eventDate(event));
  if(event.precision==='year')return `${d.getUTCFullYear()} год`;
  if(event.precision==='quarter')return `${Math.floor(d.getUTCMonth()/3)+1} квартал ${d.getUTCFullYear()}`;
  if(event.precision==='month')return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const dateShort=event=>{
  if(event.precision!=='exact'||!event.date)return dateLabel(event);
  const d=dateObject(event.date);return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]}`;
};
const isSameUTCDate=(a,b)=>a&&b&&a.getUTCFullYear()===b.getUTCFullYear()&&a.getUTCMonth()===b.getUTCMonth()&&a.getUTCDate()===b.getUTCDate();
const monthBounds=()=>({start:new Date(Date.UTC(state.cursor.getUTCFullYear(),state.cursor.getUTCMonth(),1)),end:new Date(Date.UTC(state.cursor.getUTCFullYear(),state.cursor.getUTCMonth()+1,0,23,59,59))});
const overlapsMonth=event=>{
  if(event.precision==='tbd')return true;
  const {start,end}=monthBounds();
  const eventStart=Date.parse(`${event.date_start||event.date}T00:00:00Z`);
  const eventEnd=Date.parse(`${event.date_end||event.date||event.date_start}T23:59:59Z`);
  return Number.isFinite(eventStart)&&Number.isFinite(eventEnd)&&eventStart<=end.getTime()&&eventEnd>=start.getTime();
};
const platforms=game=>primaryEvent(game).platforms||[];
const selectedTypes=()=>$$('input[name="releaseType"]:checked').map(input=>input.value);

function filtered({month=true}={}){
  const platform=$('#releasePlatform').value;
  const genre=$('#releaseGenre').value;
  const precision=$('#releasePrecision').value;
  const hasPage=$('#filterHasPage').checked;
  const needsReview=$('#filterNeedsReview').checked;
  const types=selectedTypes();
  return state.releases.filter(game=>{
    const event=primaryEvent(game);
    return (!month||overlapsMonth(event))&&
      (!platform||platforms(game).includes(platform))&&
      (!genre||(game.genres||[]).includes(genre))&&
      (!precision||event.precision===precision)&&
      (!hasPage||game.editorial?.has_page)&&
      (!needsReview||game.editorial?.needs_review)&&
      (!types.length||types.includes(game.release_type||'full'));
  }).sort((a,b)=>String(eventDate(primaryEvent(a))||'9999').localeCompare(String(eventDate(primaryEvent(b))||'9999'))||a.title.localeCompare(b.title,'ru'));
}

function media(game,kind='cover'){
  const url=imageUrl(game);
  return `<div class="${kind}">${url?`<img src="${esc(url)}" alt="Обложка ${esc(game.title)}" loading="lazy" decoding="async">`:''}</div>`;
}
function compactPlatforms(game){return platforms(game).slice(0,3).join(' · ')||'Платформы уточняются'}
function bindBrokenImages(root=document){$$('img',root).forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement?.classList.add('is-broken')},{once:true}))}

function renderCalendar(rows){
  const year=state.cursor.getUTCFullYear();const month=state.cursor.getUTCMonth();
  const first=new Date(Date.UTC(year,month,1));
  const mondayOffset=(first.getUTCDay()+6)%7;
  const gridStart=new Date(Date.UTC(year,month,1-mondayOffset));
  const exactByDate=new Map();const approximate=[];
  rows.forEach(game=>{const event=primaryEvent(game);if(event.precision==='exact'&&event.date){if(!exactByDate.has(event.date))exactByDate.set(event.date,[]);exactByDate.get(event.date).push(game)}else approximate.push(game)});
  const today=new Date();
  let cells='';
  for(let index=0;index<42;index++){
    const day=new Date(gridStart);day.setUTCDate(gridStart.getUTCDate()+index);
    const key=day.toISOString().slice(0,10);const games=exactByDate.get(key)||[];
    const other=day.getUTCMonth()!==month;const isToday=isSameUTCDate(day,today);
    const items=games.slice(0,2).map(game=>`<button class="release-calendar-item ${state.bookmarks.has(game.slug)?'is-bookmarked':''}" type="button" data-release="${esc(game.slug)}">${media(game,'release-calendar-item__media')}<span><h3>${esc(game.title)}</h3><span>${esc(compactPlatforms(game))}</span></span></button>`).join('');
    const more=games.length>2?`<button class="release-calendar-more" type="button" data-day="${key}">+ ещё ${games.length-2}</button>`:'';
    cells+=`<div class="release-day ${other?'is-other':''} ${isToday?'is-today':''}" data-date="${key}"><div class="release-day__number"><span>${day.getUTCDate()}</span>${games.length?`<span class="release-day__count">${games.length}</span>`:''}</div><div class="release-day-items">${items}${more}</div></div>`;
  }
  const approximateHTML=approximate.length?`<section class="release-approximate"><h3>Без точного дня</h3><div class="release-approximate-grid">${approximate.map(game=>`<button class="release-approximate-chip" type="button" data-release="${esc(game.slug)}">${esc(game.title)} · ${esc(dateLabel(primaryEvent(game)))}</button>`).join('')}</div></section>`:'';
  return `<div class="release-calendar-shell"><div class="release-weekdays">${WEEKDAYS.map(day=>`<span>${day}</span>`).join('')}</div><div class="release-calendar-grid">${cells}</div>${approximateHTML}</div>`;
}

function dateGroupLabel(event){
  if(event.precision!=='exact'||!event.date)return {number:'—',title:dateLabel(event),weekday:precisionLabel(event.precision)};
  const d=dateObject(event.date);
  return {number:String(d.getUTCDate()),title:MONTHS_GENITIVE[d.getUTCMonth()],weekday:new Intl.DateTimeFormat('ru-RU',{weekday:'short',timeZone:'UTC'}).format(d)};
}
function listItem(game){
  const event=primaryEvent(game);const bookmarked=state.bookmarks.has(game.slug);
  return `<article class="release-list-item" data-release="${esc(game.slug)}">${media(game,'release-list-item__media')}<div><h3>${esc(game.title)}</h3><p>${esc(game.developer||'Разработчик уточняется')} · ${esc(compactPlatforms(game))}</p><div class="release-list-item__meta"><span>${esc((game.genres||[]).slice(0,2).join(' · ')||'Жанр уточняется')}</span><span>${esc(sourceStatus(event))}</span><span>${esc(editorialLabel(game.editorial?.status))}</span></div></div><button class="release-bookmark" type="button" data-bookmark="${esc(game.slug)}" aria-label="Добавить ${esc(game.title)} в отслеживаемые" aria-pressed="${bookmarked}">${bookmarked?'◆':'◇'}</button></article>`;
}
function renderList(rows){
  const groups=new Map();
  rows.forEach(game=>{const event=primaryEvent(game);const key=event.precision==='exact'&&event.date?event.date:`${event.precision}:${event.date_start||'tbd'}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(game)});
  return `<div class="release-list">${[...groups.values()].map(games=>{const label=dateGroupLabel(primaryEvent(games[0]));return `<section class="release-list-group"><header class="release-list-date"><strong>${esc(label.number)}</strong><div><span>${esc(label.title)}</span><small>${esc(label.weekday)}</small></div></header>${games.map(listItem).join('')}</section>`}).join('')}</div>`;
}
function renderFeed(rows){
  return `<div class="release-feed">${rows.map(game=>{const event=primaryEvent(game);return `<article class="release-feed-card" data-release="${esc(game.slug)}"><div class="release-feed-card__hero">${media(game,'release-feed-card__image')}<span class="release-feed-date">${esc(dateLabel(event))}</span></div><div class="release-feed-card__body"><h3>${esc(game.title)}</h3><p>${esc(game.developer||'Разработчик уточняется')} готовит ${esc((game.genres||[]).slice(0,2).join(' / ')||'новую игру')} для ${esc(compactPlatforms(game))}.</p><div class="release-feed-card__footer"><span>${esc(sourceStatus(event))}</span><span>${esc(editorialLabel(game.editorial?.status))}</span></div></div></article>`}).join('')}</div>`;
}

function render(){
  const rows=filtered();
  $('#releasePeriodTitle').textContent=`${MONTHS[state.cursor.getUTCMonth()]} ${state.cursor.getUTCFullYear()}`;
  $('#releaseResultCount').textContent=`Найдено: ${rows.length}`;
  const view=$('#releaseView');
  if(!rows.length)view.innerHTML='<div class="release-empty">В этом периоде нет релизов, соответствующих выбранным фильтрам.</div>';
  else if(state.view==='calendar'&&!matchMedia('(max-width:760px)').matches)view.innerHTML=renderCalendar(rows);
  else if(state.view==='feed')view.innerHTML=renderFeed(rows);
  else view.innerHTML=renderList(rows);
  $$('.release-view-tabs button').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
  bindBrokenImages(view);renderUpcoming();
}

function renderUpcoming(){
  const nowDate=new Date();const rows=filtered({month:false}).filter(game=>{const value=eventDate(primaryEvent(game));return !value||dateObject(value)>=new Date(Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),nowDate.getUTCDate()))}).slice(0,6);
  $('#releaseUpcoming').innerHTML=rows.length?rows.map(game=>`<article class="release-upcoming-item" data-release="${esc(game.slug)}">${media(game,'release-upcoming-item__media')}<div><h3>${esc(game.title)}</h3><span>${esc(dateShort(primaryEvent(game)))}</span></div></article>`).join(''):'<div class="release-empty">Нет ближайших релизов.</div>';
  bindBrokenImages($('#releaseUpcoming'));
}
function renderChanges(){
  const rows=state.changes.slice(0,5);
  $('#releaseChanges').innerHTML=rows.length?rows.map(change=>`<article class="release-change ${esc(change.severity||'')}"><strong>${esc(change.title||change.game_slug)}</strong><span>${esc(change.type==='delayed'?'Релиз перенесён':change.type==='date_changed'?'Дата изменена':change.type==='new_release'?'Добавлен новый релиз':change.new_value||'Обновление данных')}</span></article>`).join(''):'<div class="release-change"><strong>Изменений пока нет</strong><span>История появится после следующего обновления парсера.</span></div>';
}

function fillFilters(){
  const allPlatforms=[...new Set(state.releases.flatMap(platforms))].sort((a,b)=>a.localeCompare(b,'ru'));
  const genres=[...new Set(state.releases.flatMap(game=>game.genres||[]))].sort((a,b)=>a.localeCompare(b,'ru'));
  $('#releasePlatform').insertAdjacentHTML('beforeend',allPlatforms.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
  $('#releaseGenre').insertAdjacentHTML('beforeend',genres.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
}
function updateStats(){
  $('#releaseTotal').textContent=state.releases.length;
  $('#releaseExact').textContent=state.releases.filter(game=>primaryEvent(game).precision==='exact').length;
  $('#releaseReview').textContent=state.releases.filter(game=>game.editorial?.needs_review).length;
}

function toggleBookmark(slug){
  if(state.bookmarks.has(slug))state.bookmarks.delete(slug);else state.bookmarks.add(slug);
  localStorage.setItem('igroReleaseBookmarks',JSON.stringify([...state.bookmarks]));render();
  const open=$('#releaseModalContent [data-modal-bookmark]');if(open&&open.dataset.modalBookmark===slug){open.setAttribute('aria-pressed',String(state.bookmarks.has(slug)));open.textContent=state.bookmarks.has(slug)?'◆ Отслеживается':'◇ Отслеживать'}
}
function detail(game){
  const event=primaryEvent(game);const bookmarked=state.bookmarks.has(game.slug);
  const sources=(game.sources||[]).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(source.title||source.family)}</span><span>Источник ↗</span></a>`).join('');
  return `<section class="release-detail-hero">${media(game,'release-detail-cover')}<div class="release-detail-copy"><h2 id="releaseModalTitle">${esc(game.title)}</h2><div class="release-detail-tags">${(game.genres||[]).slice(0,3).map(genre=>`<span>${esc(genre)}</span>`).join('')}</div><span class="release-detail-label">Дата выхода</span><strong class="release-detail-date">${esc(dateLabel(event))}</strong><div class="release-detail-platforms">${esc(compactPlatforms(game))}</div><div class="release-detail-actions"><button class="primary" type="button" data-modal-bookmark="${esc(game.slug)}" aria-pressed="${bookmarked}">${bookmarked?'◆ Отслеживается':'◇ Отслеживать'}</button><button type="button" data-release-notify="${esc(game.slug)}">♢ Напомнить о релизе</button>${game.editorial?.has_page?`<a href="../game/${encodeURIComponent(game.slug)}/">Открыть страницу игры</a>`:''}</div></div></section><div class="release-detail-body"><section class="release-detail-panel"><h3>Статус релиза</h3><p>${esc(sourceStatus(event))}. Точность: ${esc(precisionLabel(event.precision))}. ${game.editorial?.needs_review?'Редакция проверяет конфликтующие или неполные данные.':'Дата прошла автоматическую проверку по сохранённым источникам.'}</p><div class="release-source-list">${sources||'<p>Источник будет добавлен после проверки.</p>'}</div></section><aside class="release-detail-panel"><h3>Карточка игры</h3><dl class="release-detail-dl"><dt>Разработчик</dt><dd>${esc(game.developer||'—')}</dd><dt>Издатель</dt><dd>${esc(game.publisher||'—')}</dd><dt>Страница</dt><dd>${esc(editorialLabel(game.editorial?.status))}</dd><dt>Готовность</dt><dd>${esc(game.editorial?.readiness??0)}%</dd><dt>Регион</dt><dd>${esc(event.region||'worldwide')}</dd></dl></aside></div>`;
}
function openRelease(slug,pushHash=true){
  const game=state.releases.find(item=>item.slug===slug);if(!game)return;
  const event=primaryEvent(game);if(eventDate(event)){const d=dateObject(eventDate(event));state.cursor=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));}
  $('#releaseModalContent').innerHTML=detail(game);bindBrokenImages($('#releaseModalContent'));
  $('#releaseModal').hidden=false;document.body.classList.add('release-lock');
  if(pushHash)history.replaceState(null,'',`#game=${encodeURIComponent(slug)}`);
}
function closeRelease(){
  $('#releaseModal').hidden=true;document.body.classList.remove('release-lock');
  if(location.hash.startsWith('#game='))history.replaceState(null,'',location.pathname+location.search);
}
function openFilters(){
  $('#releaseFilterSheet').hidden=false;document.body.classList.add('release-lock');
}
function closeFilters(){
  $('#releaseFilterSheet').hidden=true;document.body.classList.remove('release-lock');render();
}

function bind(){
  $$('.release-view-tabs button').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;render()}));
  ['#releasePlatform','#releaseGenre','#releasePrecision','#filterHasPage','#filterNeedsReview'].forEach(selector=>$(selector).addEventListener('change',render));
  $$('input[name="releaseType"]').forEach(input=>input.addEventListener('change',render));
  $('#releasePrev').addEventListener('click',()=>{state.cursor=new Date(Date.UTC(state.cursor.getUTCFullYear(),state.cursor.getUTCMonth()-1,1));render()});
  $('#releaseNext').addEventListener('click',()=>{state.cursor=new Date(Date.UTC(state.cursor.getUTCFullYear(),state.cursor.getUTCMonth()+1,1));render()});
  $('#releaseToday').addEventListener('click',()=>{const d=new Date();state.cursor=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));render()});
  $('#openReleaseFilters').addEventListener('click',openFilters);
  $$('[data-close-filters]').forEach(button=>button.addEventListener('click',closeFilters));
  $$('[data-close-release]').forEach(button=>button.addEventListener('click',closeRelease));
  $('#resetReleaseFilters').addEventListener('click',()=>{$('#releasePlatform').value='';$('#releaseGenre').value='';$('#releasePrecision').value='';$('#filterHasPage').checked=false;$('#filterNeedsReview').checked=false;$$('input[name="releaseType"]').forEach(input=>input.checked=true);render()});
  document.addEventListener('click',event=>{
    const bookmark=event.target.closest('[data-bookmark]');if(bookmark){event.stopPropagation();toggleBookmark(bookmark.dataset.bookmark);return}
    const modalBookmark=event.target.closest('[data-modal-bookmark]');if(modalBookmark){toggleBookmark(modalBookmark.dataset.modalBookmark);return}
    const notify=event.target.closest('[data-release-notify]');if(notify){const key=`igroReleaseNotify:${notify.dataset.releaseNotify}`;const active=localStorage.getItem(key)==='1';localStorage.setItem(key,active?'0':'1');notify.textContent=active?'♢ Напомнить о релизе':'✓ Напоминание включено';return}
    const target=event.target.closest('[data-release]');if(target)openRelease(target.dataset.release);
    const day=event.target.closest('[data-day]');if(day){state.view='list';render();}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('#releaseModal').hidden)closeRelease();else if(!$('#releaseFilterSheet').hidden)closeFilters()}});
  const theme=$('#releaseTheme');const root=document.documentElement;root.dataset.theme=localStorage.getItem('igroTheme')||'dark';const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';paint();theme.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()});
}

async function load(){
  try{
    const [releaseResponse,changeResponse]=await Promise.all([fetch('../data/releases/current.json',{cache:'no-store'}),fetch('../data/releases/changes.json',{cache:'no-store'})]);
    if(!releaseResponse.ok)throw new Error(`Release data HTTP ${releaseResponse.status}`);
    const payload=await releaseResponse.json();state.releases=payload.releases||[];
    if(changeResponse.ok){const changes=await changeResponse.json();state.changes=changes.changes||[]}
    const hash=decodeURIComponent(location.hash.replace(/^#game=/,''));
    if(hash&&location.hash.startsWith('#game=')){const game=state.releases.find(item=>item.slug===hash);const value=game&&eventDate(primaryEvent(game));if(value){const d=dateObject(value);state.cursor=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));}}
    fillFilters();updateStats();renderChanges();bind();render();
    if(hash&&location.hash.startsWith('#game='))openRelease(hash,false);
  }catch(error){console.error(error);$('#releaseView').innerHTML='<div class="release-empty">Не удалось загрузить календарь. Данные не были заменены выдуманными значениями.</div>';$('#releaseResultCount').textContent='Ошибка загрузки';}
}
load();
})();
