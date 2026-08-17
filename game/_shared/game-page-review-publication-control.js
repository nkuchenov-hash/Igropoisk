(()=>{'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
if(!slug)return;
const json=async u=>{try{const r=await fetch(u,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(1).replace(/\.0$/,''):'—';
const released=d=>{const s=String(d?.release?.status||'').toLowerCase();if(/upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида/i.test(s))return false;const x=Date.parse(String(d?.release?.date||''));if(Number.isFinite(x)&&x>Date.now())return false;const y=Number(String(d?.release?.date_text||document.body.dataset.year||'').match(/(?:19|20)\d{2}/)?.[0]||0);return !y||y<=new Date().getFullYear()};
const decisionPromise=Promise.all([
  json(`../../data/reviews/${encodeURIComponent(slug)}.json`),
  json(`../../data/articles/${encodeURIComponent(slug)}.json`),
  json(`../../data/drafts/${encodeURIComponent(slug)}.json`)
]).then(([feed,article,draft])=>{
  const canonical=Number(feed?.review_score?.calculation?.score_10);
  const green=feed?.publication_gate?.status==='green'
    &&feed?.review_score?.status==='green'
    &&Number.isFinite(canonical)
    &&String(article?.publication_status||'').toLowerCase()==='published'
    &&String(article?.game_slug||article?.slug||'')===slug
    &&Number(article?.score)===canonical;
  return{feed,article,draft,canonical,green,isReleased:released(draft)};
});
let observer=null,scheduled=false,applying=false;
const set=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value};
function suppressUnpublishedReviewRows(){
  const grid=document.querySelector('#reviewGrid');
  if(grid&&grid.querySelector('.quality-review-row'))grid.innerHTML='';
  set(document.querySelector('#externalReviewCount'),'');
}
function schedule(){if(scheduled||applying)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enforce().catch(e=>console.warn('Игропоиск: canonical review publication control',e))})}
async function enforce(){
  if(applying)return;
  const node=document.querySelector('#featuredReview');
  if(!node)return;
  applying=true;
  if(observer)observer.disconnect();
  try{
    const{feed,canonical,green,isReleased}=await decisionPromise;
    const score=node.querySelector('.ig-review-feature__score');
    const meta=node.querySelector('.ig-review-feature__meta span');
    const body=node.querySelector('.ig-review-feature__body');
    node.querySelectorAll('.article-source-note').forEach(n=>n.remove());
    if(!isReleased){
      suppressUnpublishedReviewRows();
      set(score,'—');
      set(meta,'Оценка появится после выхода игры');
      node.querySelectorAll('.ig-review-link').forEach(n=>n.remove());
      return;
    }
    if(!green){
      suppressUnpublishedReviewRows();
      set(score,'—');
      set(meta,'Канонический обзор проходит обязательную проверку');
      node.querySelectorAll('.ig-review-link').forEach(n=>n.remove());
      if(body){const note=document.createElement('div');note.className='article-source-note';note.textContent='Вышедшая игра не получает отдельную или предварительную оценку: цифра появляется только вместе с проверенным обзором.';body.appendChild(note)}
      return;
    }
    set(score,fmt(canonical));
    set(meta,`Среднее ${feed.review_score.sources?.length||0} независимых профессиональных оценок`);
    let link=node.querySelector('.ig-review-link');
    if(!link&&body){link=document.createElement('a');link.className='ig-review-link';body.appendChild(link)}
    if(link){link.href=`../../article/${encodeURIComponent(slug)}/`;link.textContent='Читать обзор Игропоиска'}
  }finally{
    applying=false;
    if(observer){const root=document.querySelector('#reviewsTabContent')||document.body;observer.observe(root,{childList:true,subtree:true,characterData:true})}
  }
}
async function boot(){
  await decisionPromise;
  observer=new MutationObserver(schedule);
  const root=document.querySelector('#reviewsTabContent')||document.body;
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  schedule();
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,100));if(document.querySelector('#featuredReview')){schedule();break}}
  setTimeout(schedule,500);
  setTimeout(schedule,1500);
}
boot().catch(e=>console.warn('Игропоиск: canonical review publication control',e));
})();