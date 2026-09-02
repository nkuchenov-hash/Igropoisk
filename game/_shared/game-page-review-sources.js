(()=>{
'use strict';
const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
if(!slug)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const canonical=value=>{try{const u=new URL(value,location.href);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const scoreText=item=>{const score=Number(item?.score),scale=Number(item?.scale);if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)return `${score}/${scale}`;if(item?.original_score?.display)return item.original_score.display;if(item?.grade)return String(item.grade);if(Number.isFinite(Number(item?.normalized_10)))return `${Number(item.normalized_10).toFixed(1)}/10`;return '—'};
const reviewName=item=>String(item?.publication||item?.name||item?.source_name||item?.source||item?.domain||'Источник');
const reviewUrl=item=>String(item?.resolved_url||item?.url||item?.source_url||'');
const keyFor=item=>canonical(reviewUrl(item))||`${reviewName(item).toLowerCase()}|${scoreText(item)}`;
const unique=list=>{const seen=new Set();return list.filter(item=>{const key=keyFor(item);if(!key||seen.has(key))return false;seen.add(key);return true})};
const fetchJson=async u=>{try{const r=await fetch(u,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
const isReview=item=>item?.professional===true||String(item?.kind||'')==='professional-review'||arr(item?.roles).includes('review');
function unifiedReviews(reviews,scoreSources){return unique([...arr(reviews),...arr(scoreSources)]).filter(item=>reviewUrl(item))}
function row(item){const href=reviewUrl(item);const content=`<span class="quality-review-source">${esc(reviewName(item))}</span><b>${esc(item?.title||`Обзор ${document.body.dataset.title||slug}`)}</b><strong>${esc(scoreText(item))}</strong><span aria-hidden="true">${href?'↗':'—'}</span>`;return href?`<a class="quality-review-row" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${content}</a>`:`<div class="quality-review-row quality-review-row--no-link">${content}</div>`}
function renderReviewsTab(reviews,scoreSources){const grid=document.querySelector('#reviewGrid');if(!grid)return;const all=unifiedReviews(reviews,scoreSources);grid.classList.add('quality-review-table');grid.innerHTML=all.map(row).join('')||'<div class="ig-empty-state empty-state">Подтверждённые обзоры ещё собираются.</div>';const count=document.querySelector('#externalReviewCount');if(count)count.textContent=`${all.length} источников`;const heading=grid.previousElementSibling?.querySelector?.('h2');if(heading)heading.textContent='Обзоры и оценки изданий'}
async function main(){
  const [feed,ratings,corpus]=await Promise.all([fetchJson(`../../data/reviews/${encodeURIComponent(slug)}.json`),fetchJson(`../../data/ratings/${encodeURIComponent(slug)}.json`),fetchJson(`../../data/game-sources/${encodeURIComponent(slug)}.json`)]);
  for(let i=0;i<100&&!document.querySelector('#reviewGrid');i++)await new Promise(r=>setTimeout(r,100));
  const ratingByUrl=new Map(arr(ratings?.sources).map(item=>[canonical(item.url),item]));
  const corpusReviews=arr(corpus?.sources).filter(isReview).map(item=>{const rating=ratingByUrl.get(canonical(item.url));return rating?{...item,publication:rating.publication,score:rating.original_score?.score,scale:rating.original_score?.scale,grade:rating.original_score?.grade,normalized_10:rating.normalized_10}:item});
  const reviews=unique([...corpusReviews,...arr(feed?.reviews)]);
  renderReviewsTab(reviews,arr(ratings?.sources));
  setTimeout(()=>renderReviewsTab(reviews,arr(ratings?.sources)),700);
  setTimeout(()=>renderReviewsTab(reviews,arr(ratings?.sources)),1800);
}
main().catch(error=>console.warn('Игропоиск: review sources',error));
})();
