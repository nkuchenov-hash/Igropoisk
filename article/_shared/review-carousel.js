(function(){
'use strict';

function slugFromPath(){var match=location.pathname.match(/\/article\/([^/]+)\/?/);return match?decodeURIComponent(match[1]):'';}
function canonical(url){try{var value=new URL(url,location.href);value.hash='';value.search='';return value.origin+value.pathname;}catch(error){return String(url||'').split('?')[0].split('#')[0];}}
function make(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function createCard(images){
  if(!Array.isArray(images)||images.length<2)return null;
  var card=make('figure','article-shot-card');card.setAttribute('data-shot-card','');card.tabIndex=0;
  var viewport=make('div','article-shot-card__viewport'),track=make('div','article-shot-card__track');
  images.forEach(function(image,index){
    var slide=make('div','article-shot-card__slide');slide.dataset.caption=image.caption||'';slide.dataset.sourceName=image.source_name||'Источник';slide.dataset.sourceUrl=image.source_url||'#';
    var img=document.createElement('img');img.src=image.url;img.alt=image.alt||image.caption||'Скриншот игры';img.loading=index===0?'eager':'lazy';img.decoding='async';if(image.width)img.width=Number(image.width);if(image.height)img.height=Number(image.height);slide.appendChild(img);track.appendChild(slide);
  });
  viewport.appendChild(track);
  var prev=make('button','article-shot-card__arrow prev','‹');prev.type='button';prev.setAttribute('aria-label','Предыдущий скриншот');
  var next=make('button','article-shot-card__arrow next','›');next.type='button';next.setAttribute('aria-label','Следующий скриншот');viewport.appendChild(prev);viewport.appendChild(next);
  var counter=make('div','article-shot-card__counter');counter.innerHTML='<span>1</span> / '+images.length;viewport.appendChild(counter);card.appendChild(viewport);
  var figcaption=document.createElement('figcaption');figcaption.appendChild(make('div','article-shot-card__caption',images[0].caption||''));
  var footer=make('div','article-shot-card__footer'),dots=make('div','article-shot-card__dots');
  images.forEach(function(_,index){var dot=document.createElement('button');dot.type='button';dot.dataset.index=String(index);dot.className=index===0?'active':'';dot.setAttribute('aria-label','Скриншот '+(index+1));dots.appendChild(dot);});footer.appendChild(dots);
  var source=make('a','article-shot-card__source',(images[0].source_name||'Источник')+' ↗');source.href=images[0].source_url||'#';source.target='_blank';source.rel='noopener';footer.appendChild(source);figcaption.appendChild(footer);card.appendChild(figcaption);return card;
}
function install(card){
  var slides=card.querySelectorAll('.article-shot-card__slide');if(slides.length<2)return;
  var index=0,startX=0,track=card.querySelector('.article-shot-card__track'),caption=card.querySelector('.article-shot-card__caption'),source=card.querySelector('.article-shot-card__source'),counter=card.querySelector('.article-shot-card__counter span'),dots=card.querySelectorAll('.article-shot-card__dots button'),viewport=card.querySelector('.article-shot-card__viewport');
  function show(next){index=(next+slides.length)%slides.length;track.style.transform='translateX(-'+index*100+'%)';var slide=slides[index];if(counter)counter.textContent=String(index+1);if(caption)caption.textContent=slide.dataset.caption||'';if(source){source.href=slide.dataset.sourceUrl||'#';source.textContent=(slide.dataset.sourceName||'Источник')+' ↗';}for(var i=0;i<dots.length;i++)dots[i].classList.toggle('active',i===index);var following=slides[(index+1)%slides.length].querySelector('img');if(following)following.loading='eager';}
  var prev=card.querySelector('.prev'),next=card.querySelector('.next');if(prev)prev.addEventListener('click',function(){show(index-1);});if(next)next.addEventListener('click',function(){show(index+1);});for(var i=0;i<dots.length;i++)(function(n){dots[n].addEventListener('click',function(){show(n);});})(i);
  card.addEventListener('keydown',function(event){if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}else if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}});
  if(viewport){viewport.addEventListener('pointerdown',function(event){startX=event.clientX;});viewport.addEventListener('pointerup',function(event){var delta=event.clientX-startX;if(Math.abs(delta)>45)show(index+(delta<0?1:-1));});}show(0);
}
function sideCard(title,className){var section=make('section','article-side-card '+(className||''));section.appendChild(make('h3','',title));return section;}
function enhanceArticle(){
  var body=document.querySelector('.article-body,.article-main');if(!body||document.documentElement.dataset.articleEnhanced)return;document.documentElement.dataset.articleEnhanced='1';
  var sections=[].slice.call(document.querySelectorAll('.article-section'));
  sections.forEach(function(section,index){var heading=section.querySelector('h2');if(heading&&!heading.querySelector('.ig-section-number')&&!heading.querySelector(':scope > span')){var number=make('span','ig-section-number',String(index+1).padStart(2,'0'));heading.insertBefore(number,heading.firstChild);}});
  if(sections[1]&&!document.querySelector('.ig-article-quote')){var quote=document.createElement('blockquote');quote.className='ig-article-quote';quote.appendChild(document.createTextNode('Игропоиск сопоставляет тексты и факты из разных профессиональных источников, но итоговый обзор собирается как единый редакционный материал, а не как пересказ одной публикации.'));quote.appendChild(make('footer','','— Методика Игропоиска'));sections[1].appendChild(quote);}
  var left=document.querySelector('.article-toc,.side-toc');if(left&&!left.querySelector('.ig-reading-progress')){
    var progress=make('div','ig-reading-progress');var label=make('div','ig-reading-progress__label');label.innerHTML='<span>Вы прочитали</span><b>0%</b>';var track=make('div','ig-reading-progress__track');track.appendChild(make('span','ig-reading-progress__bar'));progress.appendChild(label);progress.appendChild(track);left.insertBefore(progress,left.querySelector('ol'));
    var actions=make('div','ig-article-actions');actions.innerHTML='<div><h4>Понравился обзор?</h4><div class="ig-reaction-row"><button class="ig-article-action" type="button" data-reaction="like">♡ Полезно</button><button class="ig-article-action" type="button" data-reaction="comment">💬 Обсудить</button></div></div><div><h4>Поделиться</h4><div class="ig-share-row"><button class="ig-article-action" type="button" data-share="native">Поделиться</button><button class="ig-article-action" type="button" data-share="copy">Ссылка</button></div></div><button class="ig-article-action ig-back-top" type="button">Наверх ↑</button>';left.appendChild(actions);
    var bar=progress.querySelector('.ig-reading-progress__bar'),value=progress.querySelector('b');function updateProgress(){var article=document.querySelector('.article-body,.article-main');if(!article)return;var rect=article.getBoundingClientRect(),total=Math.max(1,article.offsetHeight-window.innerHeight),passed=Math.min(total,Math.max(0,-rect.top+120)),percent=Math.round(passed/total*100);bar.style.width=percent+'%';value.textContent=percent+'%';}window.addEventListener('scroll',updateProgress,{passive:true});window.addEventListener('resize',updateProgress);updateProgress();
    left.querySelector('.ig-back-top').addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
    left.querySelector('[data-reaction="like"]').addEventListener('click',function(event){event.currentTarget.classList.toggle('is-active');event.currentTarget.textContent=event.currentTarget.classList.contains('is-active')?'♥ Полезно':'♡ Полезно';});
    left.querySelector('[data-reaction="comment"]').addEventListener('click',function(){var target=document.querySelector('.article-sources,.article-verdict');if(target)target.scrollIntoView({behavior:'smooth'});});
    left.querySelector('[data-share="native"]').addEventListener('click',function(){if(navigator.share)navigator.share({title:document.title,url:location.href});else navigator.clipboard&&navigator.clipboard.writeText(location.href);});
    left.querySelector('[data-share="copy"]').addEventListener('click',function(event){if(navigator.clipboard)navigator.clipboard.writeText(location.href);event.currentTarget.textContent='Скопировано';setTimeout(function(){event.currentTarget.textContent='Ссылка';},1400);});
  }
  var right=document.querySelector('.article-right-rail,.article-side--right');if(right){
    if(!right.querySelector('.ig-related-card')){var related=sideCard('Похожие материалы','ig-related-card');related.innerHTML+='<div class="ig-related-list"><a class="ig-related-item" href="/Igropoisk/"><img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/40990/header.jpg" alt="Mafia"><div><b>Все материалы об игре</b><span>Новости, обзоры и страницы</span></div></a><a class="ig-related-item" href="/Igropoisk/"><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/292030/header.jpg" alt="Обзоры"><div><b>Другие большие обзоры</b><span>Редакционные материалы</span></div></a></div>';right.appendChild(related);}
    if(!right.querySelector('.ig-author-card')){var author=sideCard('Об авторе','ig-author-card');author.innerHTML+='<div class="ig-author-head"><div class="ig-author-mark">ИП</div><div><strong>Редакция Игропоиска</strong></div></div><p>Материал подготовлен агрегатором Игропоиска: система анализирует профессиональные источники, проверяет факты и собирает самостоятельный структурированный обзор.</p>';right.appendChild(author);}
  }
}
async function hydrate(){
  var slug=slugFromPath();
  if(slug){try{
    var response=await fetch('/Igropoisk/data/article-media/'+encodeURIComponent(slug)+'.json?v='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('media '+response.status);
    var data=await response.json(),sections=Array.isArray(data.sections)?data.sections:[],used=Object.create(null),count=0;
    sections.forEach(function(entry){var section=document.getElementById(entry.id);if(!section||!Array.isArray(entry.images))return;var images=entry.images.filter(function(image){var key=canonical(image.url);if(!key||used[key])return false;used[key]=true;return true;});if(images.length<2)return;section.querySelectorAll('.article-shot-card').forEach(function(node){node.remove();});var card=createCard(images);if(!card)return;var paragraphs=section.querySelectorAll(':scope > p');if(paragraphs.length>1)paragraphs[1].insertAdjacentElement('afterend',card);else section.appendChild(card);install(card);count+=images.length;});
    var quality=document.querySelector('.article-quality');if(quality&&count){var cells=quality.querySelectorAll('div');if(cells[1])cells[1].innerHTML='<strong>'+count+'</strong><span>уникальных скриншотов</span>';}
  }catch(error){document.querySelectorAll('[data-shot-card],.article-shot-card').forEach(install);}}
  else document.querySelectorAll('[data-shot-card],.article-shot-card').forEach(install);
  enhanceArticle();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hydrate);else hydrate();
})();
