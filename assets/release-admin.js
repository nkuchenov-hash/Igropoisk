(()=>{
'use strict';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const state={releases:[],changes:[],run:null,status:''};
const primaryEvent=game=>(game.events||[])[0]||{};
const imageUrl=game=>{const local=game.image?.local_url;if(local)return local.startsWith('assets/')?`../../../${local}`:local;return game.image?.source_url||''};
const dateLabel=event=>{
  if(event.precision==='tbd'||!(event.date||event.date_start))return 'Дата уточняется';
  const value=event.date||event.date_start;const d=new Date(`${value}T12:00:00Z`);
  if(event.precision==='year')return `${d.getUTCFullYear()} год`;
  if(event.precision==='quarter')return `${Math.floor(d.getUTCMonth()/3)+1} квартал ${d.getUTCFullYear()}`;
  if(event.precision==='month')return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);
};
const statusLabel=status=>({discovered:'Обнаружено',needs_review:'Требует проверки',draft:'Черновик',ready:'Готово',published:'Опубликовано'}[status]||'Черновик');
const sourceLabel=status=>({success:'Работает',partial:'Частично',error:'Ошибка',skipped:'Пропущен'}[status]||status||'Нет данных');
const imageStatus=game=>game.image?.status==='downloaded_verified'||game.image?.verified?{className:'ok',label:game.image?.status==='downloaded_verified'?'Скачано и проверено':'Официальная обложка'}:{className:'warning',label:'Нужна проверка'};

function metrics(){
  const rows=state.releases;const values=[
    ['Всего релизов',rows.length,'is-accent'],
    ['Требуют проверки',rows.filter(game=>game.editorial?.needs_review).length,''],
    ['Черновики',rows.filter(game=>game.editorial?.status==='draft').length,''],
    ['Готовы',rows.filter(game=>game.editorial?.status==='ready').length,''],
    ['Опубликованы',rows.filter(game=>game.editorial?.status==='published').length,'']
  ];
  $('#releaseAdminMetrics').innerHTML=values.map(([label,value,className])=>`<article class="release-admin-metric ${className}"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
}
function tabs(){
  const statuses=[['','Все'],['needs_review','На проверке'],['draft','Черновики'],['ready','Готовы'],['published','Опубликованы']];
  $('#releaseAdminTabs').innerHTML=statuses.map(([value,label])=>{const count=value?state.releases.filter(game=>game.editorial?.status===value).length:state.releases.length;return `<button class="${state.status===value?'active':''}" type="button" data-status-tab="${esc(value)}">${esc(label)} · ${count}</button>`}).join('');
}
function row(game){
  const event=primaryEvent(game);const image=imageStatus(game);const source=(game.sources||[])[0];const status=game.editorial?.status||'draft';const readiness=Number(game.editorial?.readiness||0);
  return `<tr><td><div class="release-admin-game"><div class="release-admin-game__cover">${imageUrl(game)?`<img src="${esc(imageUrl(game))}" alt="" loading="lazy">`:''}</div><div><strong>${esc(game.title)}</strong><small>${esc(game.developer||'Разработчик не указан')}</small></div></div></td><td><div class="release-admin-date"><strong>${esc(dateLabel(event))}</strong><span>${esc((event.platforms||[]).join(' · ')||'Платформы уточняются')}</span></div></td><td><div class="release-admin-source-count"><strong>${(game.sources||[]).length}</strong><span>${esc(source?.title||'Нет источника')}<br>${esc(source?.family||'')}</span></div></td><td><span class="release-admin-image-status ${image.className}">${esc(image.label)}</span></td><td><span class="release-admin-page-status ${esc(status)}">${esc(statusLabel(status))}</span><div class="release-admin-readiness" aria-label="Готовность ${readiness}%"><span style="width:${Math.max(0,Math.min(100,readiness))}%"></span></div></td><td><div class="release-admin-row-actions"><a href="../../../calendar/#game=${encodeURIComponent(game.slug)}" target="_blank">Проверить</a>${source?.url?`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Источник ↗</a>`:''}</div></td></tr>`;
}
function renderRows(){
  const query=$('#releaseAdminSearch').value.trim().toLowerCase();const selected=$('#releaseAdminStatus').value||state.status;
  const rows=state.releases.filter(game=>(!selected||game.editorial?.status===selected)&&(!query||`${game.title} ${game.developer||''} ${game.publisher||''}`.toLowerCase().includes(query)));
  $('#releaseAdminRows').innerHTML=rows.length?rows.map(row).join(''):`<tr><td colspan="6"><div class="release-admin-empty">По выбранным условиям записей нет.</div></td></tr>`;
  $$('#releaseAdminRows img').forEach(img=>img.addEventListener('error',()=>img.hidden=true,{once:true}));
}
function renderChanges(){
  const rows=state.changes.slice(0,12);
  $('#releaseAdminChanges').innerHTML=rows.length?rows.map(change=>`<article class="release-admin-change"><span class="release-admin-change__dot ${esc(change.severity||'')}"></span><div><strong>${esc(change.title||change.game_slug)}</strong><p>${esc(change.type==='delayed'?'Дата выхода перенесена':change.type==='date_changed'?'Изменена дата или точность периода':change.type==='new_release'?'Найден новый релиз':change.type==='missing_from_source'?'Запись исчезла из источника':change.new_value||'Обновлены данные')}</p></div><time>${esc(change.detected_at?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(change.detected_at)):'—')}</time></article>`).join(''):'<div class="release-admin-empty">Изменений пока нет.</div>';
}
function renderSources(){
  const sources=state.run?.sources||[];
  $('#releaseAdminRunStatus').textContent=sourceLabel(state.run?.status);
  $('#releaseAdminSources').innerHTML=sources.length?sources.map(source=>`<article class="release-admin-source"><div><strong>${esc(source.id)}</strong><span>${esc(source.items??0)} записей · ${esc(source.duration_ms?`${source.duration_ms} мс`:'время не указано')}${source.error?` · ${esc(source.error)}`:''}</span></div><b class="${esc(source.status||'')}">${esc(sourceLabel(source.status))}</b></article>`).join(''):'<div class="release-admin-empty">Журнал источников ещё не создан.</div>';
}
function bind(){
  $('#releaseAdminSearch').addEventListener('input',renderRows);$('#releaseAdminStatus').addEventListener('change',()=>{state.status='';tabs();renderRows()});
  $('#releaseAdminTabs').addEventListener('click',event=>{const button=event.target.closest('[data-status-tab]');if(!button)return;state.status=button.dataset.statusTab;$('#releaseAdminStatus').value='';tabs();renderRows()});
  const theme=$('#releaseAdminTheme');const root=document.documentElement;root.dataset.theme=localStorage.getItem('igroTheme')||'dark';const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';paint();theme.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()});
}
async function load(){
  try{
    const [releaseResponse,changeResponse,runResponse]=await Promise.all([fetch('../../../data/releases/current.json',{cache:'no-store'}),fetch('../../../data/releases/changes.json',{cache:'no-store'}),fetch('../../../data/parser-runs/releases.json',{cache:'no-store'})]);
    if(!releaseResponse.ok)throw new Error(`HTTP ${releaseResponse.status}`);
    state.releases=(await releaseResponse.json()).releases||[];
    if(changeResponse.ok)state.changes=(await changeResponse.json()).changes||[];
    if(runResponse.ok)state.run=await runResponse.json();
    metrics();tabs();renderRows();renderChanges();renderSources();bind();
  }catch(error){console.error(error);$('#releaseAdminRows').innerHTML='<tr><td colspan="6"><div class="release-admin-empty">Не удалось загрузить очередь релизов.</div></td></tr>';}
}
load();
})();
