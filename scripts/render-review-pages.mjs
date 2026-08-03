import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const articlesDir=path.join(root,'data/articles');
const mediaDir=path.join(root,'data/article-media');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const imagesFor=section=>section.images?.length?section.images:(section.image?[section.image]:[]);

function card(section){
  const images=imagesFor(section).filter(image=>image?.url);
  if(!images.length)return'';
  return `<figure class="article-shot-card" data-card="${esc(section.id)}"><div class="article-shot-card__viewport"><div class="article-shot-card__track">${images.map(image=>`<div class="article-shot-card__slide"><img src="${esc(image.url)}" alt="${esc(image.alt||image.caption||'Скриншот игры')}" loading="lazy"></div>`).join('')}</div>${images.length>1?`<button class="article-shot-card__arrow prev" type="button">‹</button><button class="article-shot-card__arrow next" type="button">›</button><div class="article-shot-card__counter"><span>1</span> / ${images.length}</div>`:''}</div><figcaption><div class="article-shot-card__caption">${esc(images[0].caption||'')}</div><div class="article-shot-card__footer"><div class="article-shot-card__dots">${images.map((_,index)=>`<button type="button" data-index="${index}" class="${index===0?'active':''}"></button>`).join('')}</div><a class="article-shot-card__source" href="${esc(images[0].source_url||'#')}" target="_blank" rel="noopener">${esc(images[0].source_name||'Источник')} ↗</a></div></figcaption></figure>`;
}
function sectionMarkup(section){const paragraphs=section.paragraphs||[];const insertAt=Math.max(1,Math.floor(paragraphs.length/2));return `<section class="article-section" id="${esc(section.id)}"><h2>${esc(section.heading)}</h2>${paragraphs.map((paragraph,index)=>`${index===insertAt?card(section):''}<p>${esc(paragraph)}</p>`).join('')}${paragraphs.length<=insertAt?card(section):''}</section>`;}
function page(article){
  const sections=article.sections||[];
  const imageCount=sections.reduce((sum,section)=>sum+imagesFor(section).length,0);
  return `<!doctype html>
<html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(article.dek||article.title)}"><title>${esc(article.title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/review-article.css"><link rel="stylesheet" href="/Igropoisk/article/_shared/review-shot-card.css"></head><body data-article="${esc(article.slug)}"><header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="/Igropoisk/">ИГРОПОИСК</a><nav class="article-nav"><a href="/Igropoisk/">Главное</a><a class="article-nav__game" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/">← К игре</a></nav></div></header><section class="article-hero" style="background-image:url(&quot;${esc(article.hero||'')}&quot;)"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(article.title)}</h1><div class="article-dek">${esc(article.dek)}</div><div class="article-meta"><span>${esc(article.author)}</span><span>${esc(article.reading_time_minutes)} мин</span><span>${(article.sources||[]).length} источников</span><strong class="article-score">${esc(article.score)} / 10</strong></div></div></div></section><main class="ig-container article-layout"><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/"><span>←</span><div><small>Страница игры</small><b>Открыть карточку игры</b></div></a><article class="article-body"><section class="article-quality"><div><strong>${(article.sources||[]).length}</strong><span>источников</span></div><div><strong>${imageCount}</strong><span>кадров</span></div><div><strong>${esc(article.reading_time_minutes)}</strong><span>минут чтения</span></div></section><p class="article-lead">${esc(article.lead)}</p>${sections.map(sectionMarkup).join('')}<section class="article-verdict"><div class="article-kicker">Вердикт</div><h2>${esc(article.score)} / 10</h2><p>${esc(article.verdict?.summary||'')}</p></section><section class="article-sources"><div class="article-sources__head"><div class="article-kicker">Источники</div><h2>Материалы, использованные при написании</h2></div><div class="article-sources__list">${(article.sources||[]).map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b><small>${esc(source.purpose||'')}</small></div><strong>↗</strong></a>`).join('')}</div></section><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/"><span>←</span><div><small>Страница игры</small><b>Вернуться к игре</b></div></a></article></main><script src="/Igropoisk/article/_shared/review-carousel.js" defer></script></body></html>`;
}

if(!fs.existsSync(articlesDir))process.exit(0);
for(const name of fs.readdirSync(articlesDir).filter(name=>name.endsWith('.json'))){
  const article=read(path.join(articlesDir,name));
  const mediaPath=path.join(mediaDir,name);
  if(fs.existsSync(mediaPath)){
    const media=read(mediaPath);const map=new Map((media.sections||[]).map(section=>[section.id,section.images||[]]));
    article.sections=(article.sections||[]).map(section=>map.has(section.id)?{...section,images:map.get(section.id)}:section);
  }
  const out=path.join(root,'article',article.slug,'index.html');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,page(article));
  console.log(`Rendered ${article.slug}`);
}
