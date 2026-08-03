(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const slug=document.body.dataset.article||new URLSearchParams(location.search).get('game')||'';
const root=document.documentElement;
const fetchJSON=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`${response.status}: ${url}`);return response.json()};

function sectionMarkup(section){
  const paragraphs=section.paragraphs||[];
  const image=section.image;
  return `<section class="article-section" id="${esc(section.id||'')}"><h2>${esc(section.heading)}</h2>${paragraphs.map((paragraph,index)=>`${index===1&&image?figureMarkup(image):''}<p>${esc(paragraph)}</p>`).join('')}${paragraphs.length<2&&image?figureMarkup(image):''}</section>`;
}
function figureMarkup(image){
  return `<figure class="article-figure"><img src="${esc(image.url)}" alt="${esc(image.alt||image.caption||'Скриншот игры')}" loading="lazy"><figcaption><span>${esc(image.caption||'')}</span>${image.source_url?`<a href="${esc(image.source_url)}" target="_blank" rel="noopener noreferrer">${esc(image.source_name||'Источник изображения')} ↗</a>`:`<small>${esc(image.source_name||'')}</small>`}</figcaption></figure>`;
}
function sourcesMarkup(sources){
  return `<section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Проверяемость</div><h2>Источники, использованные при написании статьи</h2><p>Список включает только материалы, факты или изображения из которых реально использованы в тексте.</p></div><div class="article-sources__list">${(sources||[]).map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b>${source.purpose?`<small>${esc(source.purpose)}</small>`:''}</div><strong>↗</strong></a>`).join('')}</div><div class="article-method">Материал является самостоятельным редакционным синтезом. Аргументы разных авторов сопоставляются, факты проверяются, формулировки исходных публикаций не копируются.</div></section>`;
}
function gateMarkup(run){
  if(!run||run.game_slug!==slug||run.status==='success'||run.gate?.passed)return'';
  const required=run.gate?.required_editorial||20;
  const accepted=run.gate?.accepted_editorial??0;
  return `<div class="article-method"><b>Демонстрационный макет, не опубликованный обзор.</b><br>Собрано профессиональных источников: ${esc(accepted)} из ${esc(required)}. Новый стандарт Игропоиска требует 20 независимых редакционных обзоров; до прохождения gate этот материал используется только как пример структуры статьи.</div>`;
}
function render(article,run){
  document.title=`${article.title} — Игропоиск`;
  const blocked=run&&run.game_slug===slug&&run.status!=='success'&&!run.gate?.passed;
  document.body.innerHTML=`<header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="../../index.html">ИГРОПОИСК</a><nav class="article-nav"><a href="../../index.html">Главное</a><a href="../../game/${encodeURIComponent(article.game_slug)}/">Страница игры</a></nav><button class="ig-button" id="theme" type="button" style="margin-left:auto">☀</button></div></header><section class="article-hero" id="articleHero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">${blocked?'Демонстрационный макет':'Обзор Игропоиска'}</div><h1>${esc(article.title)}</h1><div class="article-dek">${esc(article.dek)}</div><div class="article-meta"><span>${esc(article.author)}</span><span>${esc(article.published_at)}</span><strong class="article-score">${esc(article.score)} / 10</strong></div></div></div></section><main class="ig-container article-layout"><article class="article-body">${gateMarkup(run)}<p class="article-lead">${esc(article.lead)}</p>${(article.sections||[]).map(sectionMarkup).join('')}${sourcesMarkup(article.sources)}</article></main>`;
  document.querySelector('#articleHero').style.backgroundImage=`url("${String(article.hero||'').replace(/"/g,'%22')}")`;
  const theme=document.querySelector('#theme');root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';paint();theme.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()};
}
Promise.all([fetchJSON(`../../data/articles/${slug}.json`),fetchJSON('../../data/parser-runs/review-synthesis.json').catch(()=>null)]).then(([article,run])=>render(article,run)).catch(error=>{document.body.innerHTML=`<main class="ig-container" style="padding:60px 0"><h1>Обзор пока не опубликован</h1><p class="ig-muted">${esc(error.message)}</p><a class="ig-button" href="../../index.html">На главную</a></main>`});
})();
