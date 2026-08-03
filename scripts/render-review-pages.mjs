import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const articlesDir=path.join(root,'data/articles');
const mediaDir=path.join(root,'data/article-media');
const policy=JSON.parse(fs.readFileSync(path.join(root,'config/parsers/review-media-policy.json'),'utf8'));
const balance=policy.article_balance||{};
const quality=policy.quality_gate||{};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';return `${u.origin}${u.pathname}${u.search}`}catch{return String(value||'')}};
const imagesFor=section=>(section.images?.length?section.images:(section.image?[section.image]:[])).filter(image=>image?.url);

function validate(article){
  const sections=article.sections||[];
  const articleWords=countWords([article.lead,...sections.flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
  const allImages=sections.flatMap(imagesFor);
  const urls=allImages.map(image=>canonical(image.url));
  const uniqueUrls=new Set(urls);
  const errors=[];
  if(articleWords<Number(balance.minimum_words||2200))errors.push(`article words ${articleWords}/${balance.minimum_words}`);
  if(sections.length<Number(balance.minimum_sections||8))errors.push(`sections ${sections.length}/${balance.minimum_sections}`);
  for(const section of sections){
    const words=countWords((section.paragraphs||[]).join(' '));
    const images=imagesFor(section);
    if(words<Number(balance.minimum_words_per_section||220))errors.push(`${section.id}: words ${words}/${balance.minimum_words_per_section}`);
    if(images.length<Number(balance.screenshots_per_section?.minimum||3))errors.push(`${section.id}: images ${images.length}/${balance.screenshots_per_section?.minimum}`);
  }
  if(allImages.length<Number(balance.minimum_total_screenshots||30))errors.push(`images ${allImages.length}/${balance.minimum_total_screenshots}`);
  if(uniqueUrls.size!==allImages.length)errors.push(`duplicate image URLs: ${allImages.length-uniqueUrls.size}`);
  if(uniqueUrls.size<Number(balance.minimum_unique_screenshots||30))errors.push(`unique images ${uniqueUrls.size}/${balance.minimum_unique_screenshots}`);
  const historical=Number(article.release_year||article.identity?.release_year||0)<2010;
  const minWidth=Number(historical?quality.minimum_width_historical:quality.minimum_width_modern)||1280;
  const minHeight=Number(historical?quality.minimum_height_historical:quality.minimum_height_modern)||720;
  for(const image of allImages){
    const width=Number(image.width||0),height=Number(image.height||0);
    if(quality.require_known_dimensions&&(!width||!height))errors.push(`unknown dimensions: ${image.url}`);
    if(width&&width<minWidth)errors.push(`image too narrow ${width}px: ${image.url}`);
    if(height&&height<minHeight)errors.push(`image too short ${height}px: ${image.url}`);
  }
  if(errors.length)throw new Error(`${article.slug}: publication blocked\n- ${errors.join('\n- ')}`);
  return {articleWords,imageCount:allImages.length};
}

function card(section){
  const images=imagesFor(section);
  const payload=JSON.stringify(images).replace(/</g,'\\u003c');
  return `<figure class="article-shot-card" data-shot-card tabindex="0"><div class="article-shot-card__viewport"><div class="article-shot-card__track">${images.map((image,index)=>`<div class="article-shot-card__slide" data-index="${index}"><img src="${esc(image.url)}" alt="${esc(image.alt||image.caption||'Скриншот игры')}" width="${Number(image.width)}" height="${Number(image.height)}" loading="${index===0?'eager':'lazy'}" decoding="async"></div>`).join('')}</div><button class="article-shot-card__arrow prev" type="button" aria-label="Предыдущий скриншот">‹</button><button class="article-shot-card__arrow next" type="button" aria-label="Следующий скриншот">›</button><div class="article-shot-card__counter"><span>1</span> / ${images.length}</div></div><figcaption><div class="article-shot-card__caption">${esc(images[0].caption||'')}</div><div class="article-shot-card__footer"><div class="article-shot-card__dots">${images.map((_,index)=>`<button type="button" data-index="${index}" class="${index===0?'active':''}" aria-label="Скриншот ${index+1}"></button>`).join('')}</div><a class="article-shot-card__source" href="${esc(images[0].source_url||'#')}" target="_blank" rel="noopener">${esc(images[0].source_name||'Источник')} ↗</a></div></figcaption><script type="application/json" class="article-shot-card__data">${payload}</script></figure>`;
}

function sectionMarkup(section,index){
  const paragraphs=section.paragraphs||[];
  const insertAt=Math.max(1,Math.floor(paragraphs.length/2));
  return `<section class="article-section" id="${esc(section.id)}"><h2><span>${String(index+1).padStart(2,'0')}</span>${esc(section.heading)}</h2>${paragraphs.map((paragraph,pIndex)=>`${pIndex===insertAt?card(section):''}<p>${esc(paragraph)}</p>`).join('')}${paragraphs.length<=insertAt?card(section):''}</section>`;
}

function toc(sections){return `<aside class="article-left-rail"><nav class="article-toc" aria-label="Оглавление"><div class="article-kicker">Оглавление</div><ol>${sections.map((section,index)=>`<li><a href="#${esc(section.id)}"><span>${String(index+1).padStart(2,'0')}</span><b>${esc(section.heading)}</b></a></li>`).join('')}</ol><a class="article-toc__top" href="#top">Наверх ↑</a></nav></aside>`;}

function rightRail(article,stats){
  const identity=article.identity||{};
  const rows=[['Разработчик',identity.developer||article.developer],['Издатель',identity.publisher||article.publisher],['Дата выхода',identity.release_date||article.release_date],['Жанр',(identity.genres||article.genres||[]).join?.(', ')||identity.genre||article.genre],['Платформы',(identity.platforms||article.platforms||[]).join?.(', ')||'']].filter(([,value])=>value);
  return `<aside class="article-right-rail"><section class="article-side-card article-side-score"><small>Оценка Игропоиска</small><strong>${esc(article.score)}</strong><span>/10</span></section><section class="article-side-card"><h3>Кратко об игре</h3>${rows.map(([label,value])=>`<div class="article-fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</section><section class="article-side-card"><h3>Материал</h3><div class="article-fact"><span>Источников</span><b>${(article.sources||[]).length}</b></div><div class="article-fact"><span>Слов</span><b>${stats.articleWords}</b></div><div class="article-fact"><span>Скриншотов</span><b>${stats.imageCount}</b></div></section><a class="article-game-return article-game-return--side" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/"><span>←</span><div><small>Страница игры</small><b>Вернуться к игре</b></div></a></aside>`;
}

function verdict(article){
  const best=article.verdict?.best_for||[];
  const notFor=article.verdict?.not_for||[];
  return `<section class="article-verdict"><div class="article-kicker">Вердикт</div><h2>${esc(article.score)} / 10</h2><p>${esc(article.verdict?.summary||'')}</p>${best.length||notFor.length?`<div class="article-verdict__grid">${best.length?`<div class="article-verdict__group"><h3>Подойдёт</h3><ul>${best.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:''}${notFor.length?`<div class="article-verdict__group"><h3>Не подойдёт</h3><ul>${notFor.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:''}</div>`:''}</section>`;
}

function page(article,stats){
  const sections=article.sections||[];
  return `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(article.dek||article.title)}"><title>${esc(article.title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/review-article.css"><link rel="stylesheet" href="/Igropoisk/article/_shared/review-shot-card.css"></head><body data-article="${esc(article.slug)}" id="top"><header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="/Igropoisk/">ИГРОПОИСК</a><nav class="article-nav"><a href="/Igropoisk/">Главная</a><a href="/Igropoisk/news/">Новости</a><a class="active" href="#top">Обзоры</a><a href="/Igropoisk/articles/">Статьи</a><a href="/Igropoisk/video/">Видео</a><a href="/Igropoisk/collections/">Подборки</a></nav><a class="article-nav__game" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/">← К игре</a></div></header><section class="article-hero" style="background-image:url(&quot;${esc(article.hero||'')}&quot;)"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(article.title)}</h1><div class="article-dek">${esc(article.dek)}</div><div class="article-meta"><span>${esc(article.author)}</span><span>${esc(article.reading_time_minutes)} мин</span><span>${(article.sources||[]).length} источников</span><strong class="article-score">${esc(article.score)} / 10</strong></div></div></div></section><main class="ig-container article-layout">${toc(sections)}<article class="article-body"><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/"><span>←</span><div><small>Страница игры</small><b>Открыть карточку игры</b></div></a><section class="article-quality"><div><strong>${(article.sources||[]).length}</strong><span>источников</span></div><div><strong>${stats.imageCount}</strong><span>уникальных кадров</span></div><div><strong>${stats.articleWords}</strong><span>слов</span></div></section><p class="article-lead">${esc(article.lead)}</p>${sections.map(sectionMarkup).join('')}${verdict(article)}<section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Источники</div><h2>Материалы, использованные при написании</h2></div><div class="article-sources__list">${(article.sources||[]).map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b><small>${esc(source.purpose||'')}</small></div><strong>↗</strong></a>`).join('')}</div></section><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(article.game_slug)}/"><span>←</span><div><small>Страница игры</small><b>Вернуться к игре</b></div></a></article>${rightRail(article,stats)}</main><script src="/Igropoisk/article/_shared/review-carousel.js" defer></script></body></html>`;
}

if(!fs.existsSync(articlesDir))process.exit(0);
let failed=false;
for(const name of fs.readdirSync(articlesDir).filter(name=>name.endsWith('.json'))){
  try{
    const article=read(path.join(articlesDir,name));
    const mediaPath=path.join(mediaDir,name);
    if(fs.existsSync(mediaPath)){
      const media=read(mediaPath);
      const map=new Map((media.sections||[]).map(section=>[section.id,section.images||[]]));
      article.sections=(article.sections||[]).map(section=>map.has(section.id)?{...section,images:map.get(section.id)}:section);
    }
    const stats=validate(article);
    const out=path.join(root,'article',article.slug,'index.html');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,page(article,stats));
    console.log(`Rendered ${article.slug}: ${stats.articleWords} words, ${stats.imageCount} unique images`);
  }catch(error){failed=true;console.error(error.message)}
}
if(failed)process.exit(2);
