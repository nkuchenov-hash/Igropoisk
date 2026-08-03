(function(){
'use strict';
document.querySelectorAll('.article-shot-card').forEach(function(card){
  var slides=card.querySelectorAll('.article-shot-card__slide');
  if(slides.length<2)return;
  var index=0;
  var track=card.querySelector('.article-shot-card__track');
  var caption=card.querySelector('.article-shot-card__caption');
  var source=card.querySelector('.article-shot-card__source');
  var counter=card.querySelector('.article-shot-card__counter span');
  var dots=card.querySelectorAll('.article-shot-card__dots button');
  var images=[];
  slides.forEach(function(slide){var img=slide.querySelector('img');images.push({alt:img?img.alt:'',caption:slide.getAttribute('data-caption')||'',sourceUrl:slide.getAttribute('data-source-url')||'',sourceName:slide.getAttribute('data-source-name')||''});});
  function show(next){index=(next+slides.length)%slides.length;track.style.transform='translateX(-'+index*100+'%)';if(counter)counter.textContent=String(index+1);for(var i=0;i<dots.length;i++)dots[i].classList.toggle('active',i===index);}
  var prev=card.querySelector('.prev');var next=card.querySelector('.next');if(prev)prev.onclick=function(){show(index-1);};if(next)next.onclick=function(){show(index+1);};for(var i=0;i<dots.length;i++)(function(n){dots[n].onclick=function(){show(n);};})(i);
});
})();
