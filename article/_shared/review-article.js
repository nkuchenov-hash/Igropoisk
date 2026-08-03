(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const slug=document.body.dataset.article||new URLSearchParams(location.search).get('game')||'';
const root=document.documentElement;
const fetchJSON=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`${response.status}: ${url}`);return response.json()};
const sectionImages=section=>(section.images?.length?section.images:(section.image?[section.image]:[])).filter(item=>item?.url);

function cardMarkup(section){
  const images=sectionImages(section);
  if(!images.length)return'';
  return `<figure class="article-shot-card" data-shot-card="${esc(section.id)}"><div class="article-shot-card__viewport"><div class="article-shot-card__track">${images.map(image=>`<div class="article-shot-card__slide"><img src="${esc(image.url)}" alt="${esc(image.alt||image.caption||'Скриншот игры')}" loading="lazy"></div>`).join('')}</div>${images.length>1?`<button class="article-shot-card__arrow prev" type="button" aria-label="Предыдущий скриншот">‹</button><button class="article-shot-card__arrow next" type="button" aria-label="Следующий скриншот">›</button><div class="article-shot-card__counter"><span>1</span> / ${images.length}</div>`:''}</div><figcaption><div class="article-shot-card__caption">${esc(images[0].caption||'')}</div><div class="article-shot-card__footer"><div class="article-shot-card__dots">${images.map((_,index)=>`<button class="${index===0?'active':''}" type="button" data-index="${index}" aria-label="Скриншот ${index+1}"></button>`).join('')}</div><a class="article-shot-card__source" href="${esc(images[0].source_url||'#')}" target="_blank" rel="noopener noreferrer">${esc(images[0].source_name||'Источник')} ↗</a></div></figcaption></figure>`;
}
function sectionMarkup(section){const paragraphs=section.paragraphs||[];const insertAt=Math.min(2,Math.max(1,Math.floor(paragraphs.length/2)));return `<section class="article-section" id="${esc(section.id||'')}"><h2>${esc(section.heading)}</h2>${paragraphs.map((paragraph,index)=>`${index===insertAt?cardMarkup(section):''}<p>${esc(paragraph)}</p>`).join('')}${paragraphs.length<=insertAt?cardMarkup(section):''}</section>`}
function tocMarkup(sections){return `<nav class="article-toc" aria-label="Оглавление"><div class="article-kicker">В этом обзоре</div><ol>${(sections||[]).map((section,index)=>`<li><a href="#${esc(section.id)}"><span>${String(index+1).padStart(2,'0')}</span>${esc(section.heading)}</a></li>`).join('')}</ol></nav>`}
function sourcesMarkup(sources,methodology){const editorial=(sources||[]).filter(source=>source.type==='editorial'||source.id?.startsWith('source-'));return `<section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Проверяемость</div><h2>Источники, использованные при написании статьи</h2><p>${editorial.length} независимых профессиональных обзоров и дополнительные источники.</p></div><div class="article-sources__list">${(sources||[]).map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b>${source.purpose?`<small>${esc(source.purpose)}</small>`:''}</div><strong>↗</strong></a>`).join('')}</div><div class="article-method">${esc(methodology||'Материал является самостоятельным редакционным синтезом.')}</div></section>`}
function qualityMarkup(article,run){const gate=article.source_gate||run?.gate||{};const passed=article.publication_status==='published'&&gate.passed!==false;if(!passed)return `<section class="article-quality article-quality--blocked"><b>Материал не прошёл публикационную проверку.</b></section>`;const editorial=(article.sources||[]).filter(source=>source.type==='editorial'||source.id?.startsWith('source-')).length;const images=(article.sections||[]).reduce((sum,section)=>sum+sectionImages(section).length,0);return `<section class="article-quality"><div><strong>${editorial}</strong><span>независимых обзоров</span></div><div><strong>${images}</strong><span>кадров в карточках</span></div><div><strong>${esc(article.reading_time_minutes||'—')}</strong><span>минут чтения</span></div><a href="#sources">Проверить источники ↓</a></section>`}
function gameReturn(gameSlug,label){return `<a class="article-game-return" href="../../game/${encodeURIComponent(gameSlug)}/"><span>←</span><div><small>Страница игры</small><b>${esc(label)}</b></div></a>`}
function applyMedia(article,mediaData){if(!mediaData?.sections)return article;const map=new Map(mediaData.sections.map(item=>[item.id,item.images||[]]));return {...article,sections:(article.sections||[]).map(section=>map.has(section.id)?{...section,images:map.get(section.id)}:section)}
function installShotCards(article){
  const byId=new Map((article.sections||[]).map(section=>[section.id,sectionImages(section)]));
  document.querySelectorAll('[data-shot-card]').forEach(card=>{
    const images=byId.get(card.dataset.shotCard)||[];
    if(!images.length)return;
    const track=card.querySelector('.article-shot-card__track');
    const counter=card.querySelector('.article-shot-card__counter span');
    const caption=card.querySelector('.article-shot-card__caption');
    const source=card.querySelector('.article-shot-card__source');
    const dots=[...card.querySelectorAll('.article-shot-card__dots button')];
    let index=0;
    const show=value=>{index=(value+images.length)%images.length;track.style.transform=`translateX(-${index*100}%)`;if(counter)counter.textContent=String(index+1);caption.textContent=images[index].caption||'';source.href=images[index].source_url||'#';source.textContent=`${images[index].source_name||'Источник'} ↗`;dots.forEach((dot,i)=>dot.classList.toggle('active',i===index))};
    card.querySelector('.prev')?.addEventListener('click',()=>show(index-1));
    card.querySelector('.next')?.addEventListener('click',()=>show(index+1));
    dots.forEach(dot=>dot.addEventListener('click',()=>show(Number(dot.dataset.index))));
    let startX=0;
    const viewport=card.querySelector('.article-shot-card__viewport');
    viewport.addEventListener('pointerdown',event=>{startX=event.clientX});
    viewport.addEventListener('pointerup',event=>{const delta=event.clientX-startX;if(Math.abs(delta)>45)show(index+(delta<0?1:-1))});
  });
}
function render(article,run){
  document.title=`${article.title} — Игропоиск`;
  const editorialCount=(article.sources||[]).filter(source=>source.type==='editorial'||source.id?.startsWith('source-')).length;
  document.body.innerHTML=`<header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="../../index.html">ИГРОПОИСК</a><nav class="article-nav"><a href="../../index.html">Главное</a><a class="article-nav__game" href="../../game/${encodeURIComponent(article.game_slug)}/">← К игре</a></nav><button class="ig-button" id="theme" type="button">☀</button></div></header><section class="article-hero" id="articleHero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(article.title)}</h1><div class="article-dek">${esc(article.dek)}</div><div class="article-meta"><span>${esc(article.author)}</span><span>${esc(article.updated_at||article.published_at)}</span><span>${esc(article.reading_time_minutes||'—')} мин</span><span>${editorialCount} источников</span><strong class="article-score">${esc(article.score)} / 10</strong></div></div></div></section><main class="ig-container article-layout">${gameReturn(article.game_slug,'Открыть карточку игры')}<article class="article-body">${qualityMarkup(article,run)}<p class="article-lead">${esc(article.lead)}</p>${tocMarkup(article.sections)}${(article.sections||[]).map(sectionMarkup).join('')}${sourcesMarkup(article.sources,article.methodology)}${gameReturn(article.game_slug,'Назад к информации, медиа и обзорам игры')}</article></main>`;
  document.querySelector('#articleHero').style.backgroundImage=`url("${String(article.hero||'').replace(/"/g,'%22')}")`;
  installShotCards(article);
  const theme=document.querySelector('#theme');
  root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';
  const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';paint();
  theme.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()});
}
Promise.all([fetchJSON(`../../data/articles/${slug}.json`),fetchJSON(`../../data/parser-runs/review-synthesis-${slug}.json`).catch(()=>null),fetchJSON(`../../data/article-media/${slug}.json`).catch(()=>null)]).then(([article,run,media])=>render(applyMedia(article,media),run)).catch(error=>{document.body.innerHTML=`<main class="ig-container" style="padding:60px 0"><h1>Обзор пока не опубликован</h1><p>${esc(error.message)}</p><a class="ig-button" href="../../game/${encodeURIComponent(slug)}/">К странице игры</a></main>`});
})();
