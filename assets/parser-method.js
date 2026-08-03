(()=>{
'use strict';
const root=document.documentElement;
const type=document.body.dataset.parser;
const base='../../../';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const storageKey=`igropoisk-parser-draft-${type}`;
let originalConfig=null;
let draft=null;

function statusClass(status){return status==='active'||status==='success'?'ok':status==='error'?'error':'pending'}
function sourceRow(source,index){return `<div class="source-row" data-index="${index}"><input class="source-enabled" type="checkbox" ${source.enabled!==false?'checked':''} aria-label="Источник включён"><input class="source-name" value="${esc(source.name||'')}" placeholder="Название"><input class="source-url" value="${esc(source.url||'')}" placeholder="URL или шаблон URL"><input class="source-weight" type="number" min="0" max="2" step="0.05" value="${esc(source.weight??1)}" aria-label="Вес"><button class="source-remove" type="button" aria-label="Удалить источник">×</button></div>`}
function collectSources(){return [...document.querySelectorAll('.source-row')].map((row,index)=>({...(draft.sources[index]||{}),id:draft.sources[index]?.id||`custom-${Date.now()}-${index}`,enabled:row.querySelector('.source-enabled').checked,name:row.querySelector('.source-name').value.trim(),url:row.querySelector('.source-url').value.trim(),weight:Number(row.querySelector('.source-weight').value)||0})).filter(source=>source.name||source.url)}
function paintSources(){document.querySelector('#sourceEditor').innerHTML=(draft.sources||[]).map(sourceRow).join('');document.querySelectorAll('.source-remove').forEach(button=>button.onclick=()=>{draft.sources.splice(Number(button.closest('.source-row').dataset.index),1);paintSources()})}
function saveDraft(){draft={...draft,sources:collectSources()};localStorage.setItem(storageKey,JSON.stringify(draft));document.querySelector('#draftStatus').textContent='Черновик сохранён в этом браузере'}
function resetDraft(){localStorage.removeItem(storageKey);draft=structuredClone(originalConfig);paintSources();document.querySelector('#draftStatus').textContent='Загружена версия из репозитория'}
function exportDraft(){draft={...draft,sources:collectSources(),edited_at:new Date().toISOString()};const blob=new Blob([`${JSON.stringify(draft,null,2)}\n`],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${type}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
function familyCards(config){return (config.families||[]).map(item=>`<div class="parser-family"><b>${esc(item.label)}</b><span>${Math.round(Number(item.weight||0)*100)}%</span><small>${esc(item.metric||'')}</small></div>`).join('')}
function secrets(config){const names=[...new Set((config.sources||[]).flatMap(source=>source.secret_names||[]))];return names.length?names.map(name=>`<div class="parser-secret"><span>GitHub Secret</span><code>${esc(name)}</code></div>`).join(''):'<p>Для базовых источников секреты не требуются.</p>'}
function runBlock(run){
  if(!run)return'<p>Журнал ещё не создан. Запусти workflow или дождись расписания.</p>';
  const gate=run.gate||{};
  const rows=[
    ['Проверено',run.checked_at||'—'],['Игра',run.game_slug||'весь каталог'],['Результат',run.output||run.note||'—']
  ];
  if(gate.accepted_editorial!==undefined)rows.push(['Источники',`${gate.accepted_editorial} / ${gate.required_editorial||20}`]);
  if(gate.accepted_sections!==undefined)rows.push(['Разделы',`${gate.accepted_sections} / минимум ${gate.minimum_sections||'—'}`]);
  if(gate.accepted_words!==undefined)rows.push(['Объём',`${gate.accepted_words} / минимум ${gate.minimum_words||'—'} слов`]);
  if(gate.accepted_screenshots!==undefined)rows.push(['Скриншоты',`${gate.accepted_screenshots} / минимум ${gate.required_screenshots||'—'}`]);
  if(gate.image_audit_passed!==undefined)rows.push(['Vision-аудит',gate.image_audit_passed?'Пройден':'Не пройден']);
  if(gate.quality_audit_passed!==undefined)rows.push(['Редакторский аудит',gate.quality_audit_passed?'Пройден':'Не пройден']);
  if(run.items!==undefined||run.ranked_count!==undefined)rows.push(['Элементов',run.items??run.ranked_count]);
  if(run.error)rows.push(['Ошибка',run.error]);
  return `<div class="parser-run"><span class="ig-admin-status ${statusClass(run.status)}">${esc(run.status||'unknown')}</span><dl>${rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${run.note?`<div class="parser-note">${esc(run.note)}</div>`:''}</div>`;
}
function exampleLinks(config){return (config.examples||[]).map(item=>`<a href="${esc(item.url)}"><span>${esc(item.label)}</span><b>Открыть →</b></a>`).join('')||'<p>Примеры пока не добавлены.</p>'}
function previewPopular(data){if(!data?.ranking?.length)return'<p>Актуальный запуск ещё не сформировал рейтинг. Главная использует резервный порядок.</p>';return data.ranking.slice(0,8).map(item=>`<article class="popular-preview-card">${item.image?`<img src="${esc(item.image)}" alt="">`:'<div class="media-placeholder">И</div>'}<div><b>${esc(item.title)}</b><small>${esc((item.families||[]).join(' · '))}</small></div><div class="popular-preview-score">${esc(item.score)}</div></article>`).join('')}
function mediaItems(data){const media=data?.media||{};if(Array.isArray(media.items))return media.items.filter(item=>item.kind==='screenshot').map(item=>item.url).filter(Boolean);return (media.screenshots||[]).map(item=>typeof item==='string'?item:item?.url).filter(Boolean)}
function previewGame(data){if(!data)return'<p>Нет готового draft.</p>';const shots=mediaItems(data).slice(0,6),media=data.media||{};return `<div class="parser-result-head"><div><b>${esc(data.identity?.title||'Игра')}</b><small>${esc(data.release?.date_text||'')}</small></div><span class="ig-pill">${shots.length} скриншотов в предпросмотре</span></div><div class="parser-media-preview">${shots.map(url=>`<img src="${esc(url)}" alt="Проверенный скриншот" loading="lazy">`).join('')}</div><dl class="mini-stats"><dt>Hero</dt><dd>${esc(media.hero||'—')}</dd><dt>Обложка</dt><dd>${esc(media.cover||'—')}</dd><dt>Источники</dt><dd>${esc((data.sources||[]).length)}</dd></dl>`}
function previewNews(data){if(!data)return'<p>Пример новостной статьи не найден.</p>';return `<article class="parser-article-preview">${data.hero?`<img src="${esc(data.hero)}" alt="" loading="lazy">`:''}<div><span class="ig-kicker">Новостная статья</span><h3>${esc(data.title)}</h3><p>${esc(data.dek||data.lead||'')}</p><small>${esc((data.sections||[]).length)} раздела · ${esc((data.sources||[]).length)} источника</small><a class="ig-button" href="../../../news/${esc(data.slug)}/">Открыть статью →</a></div></article>`}
function previewRatings(data){if(!data)return'<p>Расчёт рейтинга не найден.</p>';return `<div class="parser-rating-summary"><strong>${esc(data.calculation?.score_10??'—')}</strong><div><b>${esc(data.method?.name||'Метод расчёта')}</b><small>${esc(data.method?.description||'')}</small></div></div><div class="parser-rating-rows">${(data.sources||[]).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(source.publication)}</span><b>${esc(source.normalized)} / 100</b></a>`).join('')}</div>`}
function previewReview(data){if(!data)return'<p>Статья не найдена.</p>';const validation=data.validation||{};return `<article class="parser-article-preview">${data.hero?`<img src="${esc(data.hero)}" alt="" loading="lazy">`:''}<div><span class="ig-kicker">Обзор Игропоиска</span><h3>${esc(data.title)}</h3><p>${esc(data.dek||'')}</p><div class="parser-outline">${(data.sections||[]).map(section=>`<span>${section.image?'▣':'—'} ${esc(section.heading)}</span>`).join('')}</div><small>${esc((data.sources||[]).length)} источников · ${esc(validation.words||'—')} слов · ${esc((data.sections||[]).length)} разделов</small><a class="ig-button" href="../../../article/${esc(data.slug)}/">Открыть статью →</a></div></article>`}
function previewForType(data){if(type==='popular')return previewPopular(data);if(type==='game-data')return previewGame(data);if(type==='news')return previewNews(data);if(type==='ratings')return previewRatings(data);if(type==='review-synthesis')return previewReview(data);return'<p>Предпросмотр не настроен.</p>'}
function render(config,run,previewData){const method=config.method||{};document.title=`${config.title} — Игропоиск`;document.querySelector('#parserTitle').textContent=config.title;document.querySelector('#parserPurpose').textContent=config.purpose||'';document.querySelector('#parserStatus').className=`ig-admin-status ${statusClass(config.status)}`;document.querySelector('#parserStatus').textContent=config.status||'unknown';document.querySelector('#parserSchedule').textContent=config.schedule||'Вручную';document.querySelector('#formula').textContent=method.formula||'Методика описана по этапам ниже.';document.querySelector('#normalization').textContent=method.normalization||'';document.querySelector('#steps').innerHTML=(method.steps||[]).map(step=>`<li>${esc(step)}</li>`).join('');const extra=[...(method.screenshot_rules||[]),...(method.article_structure||[])];const extraCard=document.querySelector('#extraMethod');extraCard.hidden=!extra.length;document.querySelector('#extraMethodList').innerHTML=extra.map(item=>`<li>${esc(item)}</li>`).join('');const family=document.querySelector('#familySection');family.hidden=!(config.families||[]).length;document.querySelector('#families').innerHTML=familyCards(config);document.querySelector('#secrets').innerHTML=secrets(config);document.querySelector('#run').innerHTML=runBlock(run);document.querySelector('#examples').innerHTML=exampleLinks(config);const preview=document.querySelector('#livePreview');preview.hidden=false;preview.innerHTML=previewForType(previewData);paintSources()}
function bindTheme(){const button=document.querySelector('#theme');root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';const paint=()=>button.textContent=root.dataset.theme==='light'?'☾':'☀';paint();button.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()}}
function previewPath(run){const game=run?.game_slug||'the-witcher-3-wild-hunt';return {popular:'data/popular/current.json','game-data':`data/drafts/${game}.json`,news:'data/news-articles/the-witcher-3-redkit.json',ratings:`data/ratings/${game}.json`,'review-synthesis':`data/articles/${game}.json`}[type]||''}
async function load(){
  const config=await fetchJSON(`${base}config/parsers/${type}.json`);
  const run=await fetchJSON(`${base}data/parser-runs/${type}.json`);
  const previewData=await fetchJSON(`${base}${previewPath(run)}`);
  if(!config){document.querySelector('#parserTitle').textContent='Методика не найдена';return}
  originalConfig=config;const saved=localStorage.getItem(storageKey);try{draft=saved?JSON.parse(saved):structuredClone(config)}catch{draft=structuredClone(config)}
  render(config,run,previewData);
  document.querySelector('#addSource').onclick=()=>{draft.sources=collectSources();draft.sources.push({id:`custom-${Date.now()}`,enabled:true,family:'custom',name:'Новый источник',type:'url',url:'https://',weight:1});paintSources()};
  document.querySelector('#saveDraft').onclick=saveDraft;document.querySelector('#resetDraft').onclick=resetDraft;document.querySelector('#exportDraft').onclick=exportDraft;document.querySelector('#draftStatus').textContent=saved?'Загружен локальный черновик':'Загружена версия из репозитория';bindTheme();
}
load();
})();
