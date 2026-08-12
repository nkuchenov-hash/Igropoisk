(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
if(!slug)return;
const fetchJSON=async url=>{try{const r=await fetch(url,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const wait=async()=>{for(let i=0;i<100;i++){const node=document.querySelector('#featuredReview');if(node)return node;await new Promise(resolve=>setTimeout(resolve,100))}return null};
const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value};
async function main(){
  const [feed,rating]=await Promise.all([fetchJSON(`../../data/reviews/${encodeURIComponent(slug)}.json`),fetchJSON(`../../data/ratings/${encodeURIComponent(slug)}.json`)]);
  const reviewStatus=String(feed?.publication_gate?.status||''),ratingStatus=String(rating?.status||'');
  const green=reviewStatus==='green'&&ratingStatus==='green'&&Number.isFinite(Number(rating?.calculation?.score_10));
  if(green)return;
  const explicitRed=reviewStatus==='red-needs-revision'||ratingStatus==='red-needs-revision';
  const enforce=()=>{
    const featured=document.querySelector('#featuredReview');if(!featured)return;
    setText(featured.querySelector('.ig-review-feature__score'),'—');
    const meta=featured.querySelector('.ig-review-feature__meta span');
    if(!explicitRed){setText(meta,'Рейтинг пересчитывается по новой системе');return}
    featured.querySelectorAll('.ig-review-link').forEach(link=>link.remove());
    setText(meta,'Идёт повторный поиск и проверка профессиональных рецензий');
    let note=featured.querySelector('.article-source-note');
    if(!note){note=document.createElement('div');note.className='article-source-note';featured.querySelector('.ig-review-feature__body')?.appendChild(note)}
    setText(note,'Материал автоматически пересобирается и появится здесь после зелёной проверки качества.');
  };
  await wait();enforce();
  if(explicitRed){
    const observer=new MutationObserver(enforce);
    observer.observe(document.body,{subtree:true,childList:true});
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }
}
main().catch(error=>console.warn('Игропоиск: review publication control',error));
})();