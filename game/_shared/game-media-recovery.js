(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
if(!slug)return;
const badSource=value=>/bing\.com\/images|google\.[^/]+\/search|yandex\.[^/]+\/images/i.test(String(value||''));
const badUrl=value=>/scribdassets\.com|document_thumbnails/i.test(String(value||''));
const urlOf=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||'');
const valid=item=>{const url=urlOf(item);return (/^https?:\/\//i.test(url)||url.startsWith('/Igropoisk/'))&&!badUrl(url)&&!badSource(item?.source_url)};
const unique=items=>{const out=[];const seen=new Set();for(const item of items){if(!valid(item))continue;const url=urlOf(item);if(seen.has(url))continue;seen.add(url);out.push(item)}return out};
const fetchJson=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const makeCard=(item,label)=>{const url=urlOf(item);const card=document.createElement('article');card.className='ig-media-card';const media=document.createElement('div');media.className='ig-media-card__image';const image=document.createElement('img');image.src=url;image.alt=String(item?.caption||item?.alt||label||'Скриншот игры');image.loading='lazy';media.appendChild(image);const body=document.createElement('div');body.className='ig-media-card__body';const title=document.createElement('b');title.textContent=label;body.appendChild(title);card.append(media,body);return card};
async function enhance(){
  const screenshots=document.querySelector('#mediaScreenshots');
  const screenshotGroup=document.querySelector('#screenshotGroup');
  const screenshotCount=document.querySelector('#screenshotCount');
  const art=document.querySelector('#mediaArt');
  const artGroup=document.querySelector('#artGroup');
  const artCount=document.querySelector('#artCount');
  if(!screenshots||!screenshotGroup||!art||!artGroup)return false;
  const [draft,articleMedia,article,override]=await Promise.all([
    fetchJson(`../../data/drafts/${encodeURIComponent(slug)}.json`),
    fetchJson(`../../data/article-media/${encodeURIComponent(slug)}.json`),
    fetchJson(`../../data/articles/${encodeURIComponent(slug)}.json`),
    fetchJson(`../../data/game-media/${encodeURIComponent(slug)}.json`)
  ]);
  const articleMediaImages=(articleMedia?.sections||[]).flatMap(section=>section.images||[]);
  const articleImages=(article?.sections||[]).flatMap(section=>section.images||[]);
  const shots=unique([...(override?.screenshots||[]),...(draft?.media?.screenshots||[]),...articleMediaImages,...articleImages]).slice(0,18);
  const rendered=new Set([...screenshots.querySelectorAll('img')].map(img=>img.currentSrc||img.src));
  for(const item of shots){const url=urlOf(item);if(rendered.has(url))continue;screenshots.appendChild(makeCard(item,String(item?.caption||item?.alt||'Скриншот')));rendered.add(url)}
  if(rendered.size){screenshotGroup.hidden=false;screenshotCount.textContent=String(rendered.size)}

  const artItems=unique([
    ...(override?.artwork||[]),
    override?.cover&&{url:override.cover,caption:'Обложка'},
    override?.hero&&{url:override.hero,caption:'Ключевой арт'},
    ...(draft?.media?.artwork||[]),
    draft?.media?.cover&&{url:draft.media.cover,caption:'Обложка'},
    draft?.media?.hero&&{url:draft.media.hero,caption:'Арт'},
    article?.hero&&{url:article.hero,caption:'Ключевой арт'}
  ].filter(Boolean));
  const renderedArt=new Set([...art.querySelectorAll('img')].map(img=>img.currentSrc||img.src));
  for(const item of artItems){const url=urlOf(item);if(renderedArt.has(url))continue;art.appendChild(makeCard(item,String(item?.caption||'Арт')));renderedArt.add(url)}
  if(renderedArt.size){artGroup.hidden=false;artCount.textContent=String(renderedArt.size)}
  return true;
}
let attempts=0;
const run=()=>{enhance().then(done=>{if(!done&&attempts++<40)setTimeout(run,100)});};
run();
})();
