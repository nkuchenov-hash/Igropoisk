(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const statusClass=status=>status==='success'?'ok':status==='error'?'error':'pending';
const statusLabel=status=>({success:'Работает',error:'Ошибка',pending:'Ожидает запуска',partial:'Частично'}[status]||status||'Нет данных');

function parserCard(type,title,description,page,workflow,run){
  const details=run?`<dl class="mini-stats"><dt>Игра</dt><dd>${esc(run.game_slug||'весь каталог')}</dd><dt>Проверено</dt><dd>${esc(run.checked_at||'—')}</dd><dt>Результат</dt><dd>${esc(run.output||run.note||'—')}</dd></dl>`:'<p>Журнал ещё не создан.</p>';
  return `<article class="ig-admin-card" id="${esc(type)}"><span class="ig-admin-status ${statusClass(run?.status)}">${esc(statusLabel(run?.status))}</span><h2>${esc(title)}</h2><p>${esc(description)}</p>${details}<div class="admin-card-actions"><a class="ig-button" href="parsers/${esc(page)}/">Открыть методику →</a><a class="ig-button secondary" href="https://github.com/nkuchenov-hash/Igropoisk/actions/workflows/${esc(workflow)}" target="_blank" rel="noopener noreferrer">Запуск ↗</a></div></article>`;
}

function ratingTable(rating){
  const rows=(rating?.sources||[]).map(source=>`<tr><td data-label="Издание">${esc(source.publication)}</td><td data-label="Исходная оценка">${esc(source.score)} / ${esc(source.scale)}</td><td data-label="Нормализовано">${esc(source.normalized)}</td><td data-label="Статус"><span class="ig-admin-status ${statusClass(source.status)}">${esc(source.status)}</span></td><td data-label="URL"><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Источник ↗</a></td></tr>`).join('');
  return `<section class="ig-admin-card" style="margin-top:18px"><div class="ig-admin-status ok">Формула прозрачна</div><h2>Расчёт рейтинга Игропоиска</h2><p>${esc(rating?.method?.description||'Нет данных')}</p><div class="ig-table-scroll"><table class="ig-data-table"><thead><tr><th>Издание</th><th>Исходная оценка</th><th>Нормализовано</th><th>Статус</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table></div><div class="ig-panel" style="margin-top:16px"><b>Медиана:</b> ${esc(rating?.calculation?.median_100??'—')} / 100　→　<strong class="ig-rating">${esc(rating?.calculation?.score_10??'—')} / 10</strong><br><code>${esc(JSON.stringify(rating?.calculation?.sorted||[]))}</code></div></section>`;
}

function bindAdminNavigation(){
  const links=[...document.querySelectorAll('.ig-admin-sidebar a[href^="#"]')];
  const sections=links.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);
  links.forEach(link=>link.addEventListener('click',()=>links.forEach(item=>item.classList.toggle('active',item===link))));
  if(!('IntersectionObserver' in window)||!sections.length)return;
  const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!visible)return;links.forEach(link=>link.classList.toggle('active',link.getAttribute('href')===`#${visible.target.id}`))},{rootMargin:'-18% 0px -68% 0px',threshold:[0,.15,.4]});
  sections.forEach(section=>observer.observe(section));
}

async function load(){
  const [popularRun,gameRun,newsRun,ratingRun,reviewRun,rating,runtime]=await Promise.all([
    fetchJSON('../data/parser-runs/popular.json'),fetchJSON('../data/parser-runs/game-data.json'),fetchJSON('../data/parser-runs/news.json'),fetchJSON('../data/parser-runs/ratings.json'),fetchJSON('../data/parser-runs/review-synthesis.json'),fetchJSON('../data/ratings/the-witcher-3-wild-hunt.json'),fetchJSON('../config/runtime.json')
  ]);
  document.querySelector('#parserCards').innerHTML=[
    parserCard('popular-parser','Парсер «Сейчас популярно»','Считает актуальный интерес по игровым СМИ, Reddit, YouTube, Twitch и Steam.','popular','popular-parser.yml',popularRun),
    parserCard('game-parser','Парсер данных игры','Название, разработчики, жанры, платформы, скриншоты, видео и системные требования.','game-data','game-data-parser.yml',gameRun),
    parserCard('news-parser','Парсер новостей','Получает официальные новости и публикации СМИ, сохраняет URL, дату, автора и журнал.','news','news-parser.yml',newsRun),
    parserCard('rating-parser','Парсер рейтингов','Показывает каждую извлечённую оценку и рассчитывает итог по опубликованной формуле.','ratings','ratings-parser.yml',ratingRun),
    parserCard('review-synthesis','AI-обзор Игропоиска','Интегрирует несколько источников в самостоятельную статью с разделами, скриншотами и списком источников.','review-synthesis','review-synthesis.yml',reviewRun)
  ].join('');
  document.querySelector('#ratingAudit').innerHTML=ratingTable(rating);
  const connected=Boolean(runtime?.ratings_api_base);
  document.querySelector('#backendStatus').innerHTML=`<span class="ig-admin-status ${connected?'ok':'pending'}">${connected?'Подключён':'Не развёрнут'}</span><h2>База пользовательских оценок</h2><p>${connected?'Клиент отправляет оценки в постоянную D1-базу.':'Код Worker и D1-схема готовы, но адрес API ещё не указан в config/runtime.json.'}</p><dl class="mini-stats"><dt>Уникальность</dt><dd>HMAC от IP + slug игры</dd><dt>История</dt><dd>Каждая отправка сохраняется в rating_events</dd><dt>Raw IP</dt><dd>Не хранится</dd></dl><a class="ig-button" href="../backend/ratings-worker/README.md">Инструкция подключения</a>`;
  const theme=document.querySelector('#theme');const root=document.documentElement;root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';paint();theme.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()};
  bindAdminNavigation();
}
load();
})();
