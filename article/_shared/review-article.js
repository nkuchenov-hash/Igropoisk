(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const slug=document.body.dataset.article||new URLSearchParams(location.search).get('game')||'';
const root=document.documentElement;
const fetchJSON=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`${response.status}: ${url}`);return response.json()};

function figureMarkup(image){
  return `<figure class="article-figure"><img src="${esc(image.url)}" alt="${esc(image.alt||image.caption||'Скриншот игры')}" loading="lazy"><figcaption><span>${esc(image.caption||'')}</span>${image.source_url?`<a href="${esc(image.source_url)}" target="_blank" rel="noopener noreferrer">${esc(image.source_name||'Источник изображения')} ↗</a>`:`<small>${esc(image.source_name||'')}</small>`}</figcaption></figure>`;
}
function sectionMarkup(section){
  const paragraphs=section.paragraphs||[];
  const image=section.image;
  return `<section class="article-section" id="${esc(section.id||'')}"><h2>${esc(section.heading)}</h2>${paragraphs.map((paragraph,index)=>`${index===1&&image?figureMarkup(image):''}<p>${esc(paragraph)}</p>`).join('')}${paragraphs.length<2&&image?figureMarkup(image):''}</section>`;
}
function tocMarkup(sections){
  return `<nav class="article-toc" aria-label="Оглавление"><div class="article-kicker">В этом обзоре</div><ol>${(sections||[]).map((section,index)=>`<li><a href="#${esc(section.id)}"><span>${String(index+1).padStart(2,'0')}</span>${esc(section.heading)}</a></li>`).join('')}</ol></nav>`;
}
function sourcesMarkup(sources,methodology){
  const editorial=(sources||[]).filter(source=>source.type==='editorial');
  return `<section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Проверяемость</div><h2>Источники, использованные при написании статьи</h2><p>${editorial.length} независимых профессиональных обзоров и дополнительные официальные источники. В список включены только материалы, повлиявшие на текст, проверку фактов или выбор изображений.</p></div><div class="article-sources__list">${(sources||[]).map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b>${source.purpose?`<small>${esc(source.purpose)}</small>`:''}</div><strong>↗</strong></a>`).join('')}</div><div class="article-method">${esc(methodology||'Материал является самостоятельным редакционным синтезом. Аргументы сопоставлены, факты проверены, формулировки исходных публикаций не копируются.')}</div></section>`;
}
function qualityMarkup(article,run){
  const gate=article.source_gate||run?.gate||{};
  const passed=article.publication_status==='published'&&gate.passed!==false;
  if(!passed){
    return `<section class="article-quality article-quality--blocked"><b>Материал не прошёл публикационную проверку.</b><span>Принято источников: ${esc(gate.accepted_editorial??0)} из ${esc(gate.required_editorial??20)}.</span></section>`;
  }
  const editorial=(article.sources||[]).filter(source=>source.type==='editorial').length;
  return `<section class="article-quality"><div><strong>${esc(editorial)}</strong><span>независимых обзоров</span></div><div><strong>${esc(article.sections?.length||0)}</strong><span>тематических разделов</span></div><div><strong>${esc(article.reading_time_minutes||'—')}</strong><span>минут чтения</span></div><a href="#sources">Проверить источники ↓</a></section>`;
}
function render(article,run){
  document.title=`${article.title} — Игропоиск`;
  const editorialCount=(article.sources||[]).filter(source=>source.type==='editorial').length;
  document.body.innerHTML=`<header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="../../index.html">ИГРОПОИСК</a><nav class="article-nav"><a href="../../index.html">Главное</a><a href="../../game/${encodeURIComponent(article.game_slug)}/">Страница игры</a></nav><button class="ig-button" id="theme" type="button" style="margin-left:auto" aria-label="Переключить тему">☀</button></div></header><section class="article-hero" id="articleHero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(article.title)}</h1><div class="article-dek">${esc(article.dek)}</div><div class="article-meta"><span>${esc(article.author)}</span><span>${esc(article.updated_at||article.published_at)}</span><span>${esc(article.reading_time_minutes||'—')} мин</span><span>${editorialCount} источников</span><strong class="article-score">${esc(article.score)} / 10</strong></div></div></div></section><main class="ig-container article-layout"><article class="article-body">${qualityMarkup(article,run)}<p class="article-lead">${esc(article.lead)}</p>${tocMarkup(article.sections)}${(article.sections||[]).map(sectionMarkup).join('')}${sourcesMarkup(article.sources,article.methodology)}</article></main>`;
  document.querySelector('#articleHero').style.backgroundImage=`url("${String(article.hero||'').replace(/"/g,'%22')}")`;
  const theme=document.querySelector('#theme');
  root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';
  const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';
  paint();
  theme.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()};
}
Promise.all([fetchJSON(`../../data/articles/${slug}.json`),fetchJSON('../../data/parser-runs/review-synthesis.json').catch(()=>null)]).then(([article,run])=>render(article,run)).catch(error=>{document.body.innerHTML=`<main class="ig-container" style="padding:60px 0"><h1>Обзор пока не опубликован</h1><p class="ig-muted">${esc(error.message)}</p><a class="ig-button" href="../../index.html">На главную</a></main>`});
})();
