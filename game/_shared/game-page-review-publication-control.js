(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
if(!slug)return;
const fetchJSON=async url=>{try{const r=await fetch(url,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const wait=async()=>{for(let i=0;i<100;i++){const node=document.querySelector('#featuredReview');if(node)return node;await new Promise(resolve=>setTimeout(resolve,100))}return null};
async function main(){
  const [feed,rating]=await Promise.all([fetchJSON(`../../data/reviews/${encodeURIComponent(slug)}.json`),fetchJSON(`../../data/ratings/${encodeURIComponent(slug)}.json`)]);
  const reviewStatus=String(feed?.publication_gate?.status||''),ratingStatus=String(rating?.status||'');
  const green=reviewStatus==='green'&&ratingStatus==='green'&&Number.isFinite(Number(rating?.calculation?.score_10));
  if(green)return;
  const featured=await wait();if(!featured)return;
  const score=featured.querySelector('.ig-review-feature__score');if(score)score.textContent='—';
  const explicitRed=reviewStatus==='red-needs-revision'||ratingStatus==='red-needs-revision';
  if(!explicitRed){const meta=featured.querySelector('.ig-review-feature__meta span');if(meta)meta.textContent='Рейтинг пересчитывается по новой системе';return}
  featured.querySelector('.ig-review-link')?.remove();
  const meta=featured.querySelector('.ig-review-feature__meta span');if(meta)meta.textContent='Идёт повторный поиск и проверка профессиональных рецензий';
  let note=featured.querySelector('.article-source-note');if(!note){note=document.createElement('div');note.className='article-source-note';featured.querySelector('.ig-review-feature__body')?.appendChild(note)}
  note.textContent='Материал автоматически пересобирается и появится здесь после зелёной проверки качества.';
}
main().catch(error=>console.warn('Игропоиск: review publication control',error));
})();