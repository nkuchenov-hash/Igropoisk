(function(){
'use strict';
var body=document.body,slug=body.dataset.articleSlug||location.pathname.split('/').filter(Boolean).pop();
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function arr(v){return Array.isArray(v)?v:[]}
function score(v){return Number(v).toFixed(1).replace('.',',')}
function loadScript(src){return new Promise(function(resolve,reject){var s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.appendChild(s)})}
function sourceRow(item,index){return '<a class="article-source-row" href="'+esc(item.url)+'" target="_blank" rel="noopener"><span>'+String(index+1).padStart(2,'0')+'</span><div><b>'+esc(item.name)+'</b><small>'+esc(item.note||'')+'</small></div><strong>↗</strong></a>'}
function list(items){return arr(items).map(function(item){return '<li>'+esc(item)+'</li>'}).join('')}

async function gunzipBase64(value){
  var bytes=Uint8Array.from(atob(value),function(char){return char.charCodeAt(0)});
  var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
async function loadEmbeddedBuild(){
  var chunks=[];
  for(var index=0;index<32;index++){
    var part=await fetch('/Igropoisk/data/manual-review-builds/'+encodeURIComponent(slug)+'.parts/'+String(index).padStart(3,'0')+'.b64part?v='+Date.now(),{cache:'no-store'});
    if(!part.ok){if(index===0)throw new Error('Embedded article build not found');break}
    chunks.push((await part.text()).trim());
  }
  var source=atob(chunks.join(''));
  var articleMatch=source.match(/write\('data\/articles\/[^']+\.json',gun\('([^']+)'\)\)/);
  var mediaMatch=source.match(/write\('data\/article-media\/[^']+\.json',gun\('([^']+)'\)\)/);
  if(!articleMatch)throw new Error('Embedded article payload is invalid');
  return {article:JSON.parse(await gunzipBase64(articleMatch[1])),media:mediaMatch?JSON.parse(await gunzipBase64(mediaMatch[1])):null};
}
async function boot(){
  try{
    var response=await fetch('/Igropoisk/data/articles/'+encodeURIComponent(slug)+'.json?v='+Date.now(),{cache:'no-store'});
    var embedded=null,a=null,media=null;
    if(response.ok)a=await response.json();else{embedded=await loadEmbeddedBuild();a=embedded.article;media=embedded.media}
    var sections=arr(a.sections),sources=arr(a.sources);
    document.title=a.title+' — обзор Игропоиска';
    var toc=sections.map(function(s,i){return '<li><a href="#'+esc(s.id)+'"><span>'+String(i+1).padStart(2,'0')+'</span><b>'+esc(s.heading)+'</b></a></li>'}).join('');
    var content=sections.map(function(s){return '<section class="article-section" id="'+esc(s.id)+'"><h2>'+esc(s.heading)+'</h2>'+arr(s.paragraphs).map(function(p){return '<p>'+esc(p)+'</p>'}).join('')+'</section>'}).join('');
    var facts=a.facts||{};
    body.innerHTML=
    '<header class="article-header"><div class="ig-container article-header__inner"><a class="article-logo" href="/Igropoisk/">ИГРОПОИСК</a><nav class="article-nav"><a href="/Igropoisk/">Главное</a><a href="/Igropoisk/#search">Поиск игр</a><a href="/Igropoisk/#news">Новости</a><a class="article-nav__game" href="/Igropoisk/game/'+esc(a.game_slug||slug)+'/">← К игре</a></nav></div></header>'+
    '<section class="article-hero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>'+esc(a.title)+'</h1><div class="article-dek">'+esc(a.dek)+'</div><div class="article-meta"><span>'+esc(a.author)+'</span><span>'+esc(a.reading_time_minutes)+' минут</span><span>'+sources.length+' источников</span><strong class="article-score">'+score(a.score)+' / 10</strong></div></div></div></section>'+
    '<div class="ig-container article-layout"><aside class="article-left-rail"><nav class="article-toc side-toc"><div class="article-kicker">Оглавление</div><ol>'+toc+'<li><a href="#verdict"><span>'+String(sections.length+1).padStart(2,'0')+'</span><b>Итог</b></a></li></ol><a class="article-toc__top" href="#top">Наверх</a></nav></aside>'+
    '<main class="article-body" id="top"><a class="article-game-return" href="/Igropoisk/game/'+esc(a.game_slug||slug)+'/"><span>←</span><div><small>Страница игры</small><b>Вернуться к '+esc(facts.short_title||a.game_title||slug)+'</b></div></a>'+
    '<section class="article-quality"><div><strong>'+sources.length+'</strong><span>профессиональных источников</span></div><div><strong>'+sections.length+'</strong><span>подробных разделов</span></div><div><strong>'+esc(a.media_gate&&a.media_gate.unique_found||'—')+'</strong><span>уникальных официальных кадров</span></div></section>'+
    '<p class="article-lead">'+esc(a.lead)+'</p>'+content+
    '<section class="article-verdict" id="verdict"><div class="article-kicker">Вердикт</div><h2>'+esc(a.verdict&&a.verdict.heading||'Итог')+'</h2><p>'+esc(a.verdict&&a.verdict.summary||'')+'</p><div class="article-verdict__grid"><div class="article-verdict__group"><h3>Подойдёт</h3><ul>'+list(a.verdict&&a.verdict.best_for)+'</ul></div><div class="article-verdict__group"><h3>Не подойдёт</h3><ul>'+list(a.verdict&&a.verdict.not_for)+'</ul></div></div></section>'+
    '<section class="article-sources"><div class="article-sources__head"><div class="article-kicker">Методология</div><h2>Источники обзора</h2><p>'+esc(a.methodology||'')+'</p></div><div class="article-sources__list">'+sources.map(sourceRow).join('')+'</div></section>'+
    '<a class="article-game-return" href="/Igropoisk/game/'+esc(a.game_slug||slug)+'/"><span>←</span><div><small>Страница игры</small><b>Вернуться к '+esc(facts.short_title||a.game_title||slug)+'</b></div></a></main>'+
    '<aside class="article-right-rail"><section class="article-side-card article-side-score"><small>Оценка Игропоиска</small><strong>'+score(a.score)+'</strong><span>/ 10</span></section><section class="article-side-card"><h3>Кратко об игре</h3>'+
    '<div class="article-fact"><span>Год</span><b>'+esc(facts.year||'—')+'</b></div><div class="article-fact"><span>Разработчик</span><b>'+esc(facts.developer||'—')+'</b></div><div class="article-fact"><span>Жанр</span><b>'+esc(facts.genre||'—')+'</b></div><div class="article-fact"><span>Мир</span><b>'+esc(facts.world||'—')+'</b></div><div class="article-fact"><span>Платформы</span><b>'+esc(facts.platforms||'—')+'</b></div>'+
    '<a class="article-game-return article-game-return--side" href="/Igropoisk/game/'+esc(a.game_slug||slug)+'/"><span>←</span><div><small>Карточка игры</small><b>'+esc(facts.short_title||a.game_title||slug)+'</b></div></a></section></aside></div>';
    var hero=document.querySelector('.article-hero');if(hero&&a.hero)hero.style.backgroundImage='url("'+String(a.hero).replace(/"/g,'%22')+'")';
    if(media){var nativeFetch=window.fetch.bind(window);window.fetch=function(input,options){var url=String(input&&input.url||input);if(url.indexOf('/data/article-media/'+slug+'.json')!==-1)return Promise.resolve(new Response(JSON.stringify(media),{status:200,headers:{'content-type':'application/json'}}));return nativeFetch(input,options)}}
    await loadScript('/Igropoisk/article/_shared/review-carousel.js?v=20260804-3');
  }catch(error){
    console.error(error);body.innerHTML='<main class="ig-container" style="padding:60px 0;font:16px sans-serif"><h1>Статья временно недоступна</h1><p>'+esc(error.message)+'</p></main>';
  }
}
boot();
})();