(function(){
'use strict';
function parse(card){
  var node=card.querySelector('.article-shot-card__data');
  if(!node)return[];
  try{return JSON.parse(node.textContent||'[]');}catch(error){return[];}
}
function install(card){
  var slides=card.querySelectorAll('.article-shot-card__slide');
  var images=parse(card);
  if(slides.length<2||images.length!==slides.length)return;
  var index=0;
  var track=card.querySelector('.article-shot-card__track');
  var caption=card.querySelector('.article-shot-card__caption');
  var source=card.querySelector('.article-shot-card__source');
  var counter=card.querySelector('.article-shot-card__counter span');
  var dots=card.querySelectorAll('.article-shot-card__dots button');
  var viewport=card.querySelector('.article-shot-card__viewport');
  var startX=0;
  function show(next){
    index=(next+slides.length)%slides.length;
    track.style.transform='translateX(-'+index*100+'%)';
    if(counter)counter.textContent=String(index+1);
    if(caption)caption.textContent=images[index].caption||'';
    if(source){source.href=images[index].source_url||'#';source.textContent=(images[index].source_name||'Источник')+' ↗';}
    for(var i=0;i<dots.length;i++)dots[i].classList.toggle('active',i===index);
    var following=slides[(index+1)%slides.length].querySelector('img');
    if(following&&following.loading==='lazy')following.loading='eager';
  }
  var prev=card.querySelector('.prev');
  var next=card.querySelector('.next');
  if(prev)prev.addEventListener('click',function(){show(index-1);});
  if(next)next.addEventListener('click',function(){show(index+1);});
  for(var i=0;i<dots.length;i++)(function(n){dots[n].addEventListener('click',function(){show(n);});})(i);
  card.addEventListener('keydown',function(event){if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}});
  if(viewport){
    viewport.addEventListener('pointerdown',function(event){startX=event.clientX;});
    viewport.addEventListener('pointerup',function(event){var delta=event.clientX-startX;if(Math.abs(delta)>45)show(index+(delta<0?1:-1));});
  }
  show(0);
}
var cards=document.querySelectorAll('[data-shot-card]');
for(var i=0;i<cards.length;i++)install(cards[i]);
})();
