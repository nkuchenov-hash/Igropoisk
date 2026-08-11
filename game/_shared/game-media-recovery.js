(()=>{
'use strict';
const slug=document.body.dataset.slug||location.pathname.split('/').filter(Boolean).at(-1)||'';
const title=document.body.dataset.title||slug.replace(/-/g,' ');
if(!slug)return;
const badSource=value=>/bing\.com\/images|google\.[^/]+\/search|yandex\.[^/]+\/images/i.test(String(value||''));
const badUrl=value=>/scribdassets\.com|document_thumbnails/i.test(String(value||''));
const urlOf=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||'');
const valid=item=>{const url=urlOf(item);return (/^https?:\/\//i.test(url)||url.startsWith('/Igropoisk/'))&&!badUrl(url)&&!badSource(item?.source_url)};
const mediaKey=item=>{const raw=urlOf(item);if(!raw)return'';try{const url=new URL(raw,location.href);let pathname=url.pathname.toLowerCase();pathname=pathname.replace(/\.(?:1920x1080|116x65|600x337)(?=\.[a-z]+$)/,'');pathname=pathname.replace(/(?:[-_.](?:small|medium|large|thumb|thumbnail|1200x630|690|1080|1920|2048))(?=\.[a-z]+$)/g,'');return url.hostname.toLowerCase()+pathname}catch{return raw.split(/[?#]/)[0].toLowerCase()}};
const unique=items=>{const out=[];const seen=new Set();for(const item of items){if(!valid(item))continue;const key=mediaKey(item);if(!key||seen.has(key))continue;seen.add(key);out.push(item)}return out};
const fetchJson=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const makeCard=(item,index,label='Скриншот')=>{const url=urlOf(item);const card=document.createElement('article');card.className='ig-media-card';const media=document.createElement('div');media.className='ig-media-card__image';const image=document.createElement('img');image.src=url;image.alt=`${title} — ${label.toLowerCase()} ${index+1}`;image.loading='lazy';media.appendChild(image);const body=document.createElement('div');body.className='ig-media-card__body';const caption=document.createElement('small');caption.textContent=`${title} — ${label.toLowerCase()} ${index+1}`;body.appendChild(caption);card.append(media,body);return card};
async function enhance(){
  const screenshots=document.querySelector('#mediaScreenshots');
  const screenshotGroup=document.querySelector('#screenshotGroup');
  const screenshotCount=document.querySelector('#screenshotCount');
  const art=document.querySelector('#mediaArt');
  const artGroup=document.querySelector('#artGroup');
  const artCount=document.querySelector('#artCount');
  if(!screenshots||!screenshotGroup||!art||!artGroup)return false;
  const [draft,override]=await Promise.all([
    fetchJson(`../../data/drafts/${encodeURIComponent(slug)}.json`),
    fetchJson(`../../data/game-media/${encodeURIComponent(slug)}.json`)
  ]);
  const shots=unique([...(override?.screenshots||[]),...(draft?.media?.screenshots||[])]).slice(0,18);
  const existing=[...screenshots.querySelectorAll('img')];
  const rendered=new Set(existing.map(img=>mediaKey(img.src)));
  let nextIndex=rendered.size;
  for(const item of shots){const key=mediaKey(item);if(rendered.has(key))continue;screenshots.appendChild(makeCard(item,nextIndex++,'Скриншот'));rendered.add(key)}
  if(rendered.size){screenshotGroup.hidden=false;screenshotCount.textContent=String(rendered.size)}

  const artItems=unique([
    ...(override?.artwork||[]),
    override?.cover&&{url:override.cover},
    override?.hero&&{url:override.hero},
    ...(draft?.media?.artwork||[]),
    draft?.media?.cover&&{url:draft.media.cover},
    draft?.media?.hero&&{url:draft.media.hero}
  ].filter(Boolean));
  const renderedArt=new Set([...art.querySelectorAll('img')].map(img=>mediaKey(img.src)));
  let artIndex=renderedArt.size;
  for(const item of artItems){const key=mediaKey(item);if(renderedArt.has(key))continue;art.appendChild(makeCard(item,artIndex++,'Арт'));renderedArt.add(key)}
  if(renderedArt.size){artGroup.hidden=false;artCount.textContent=String(renderedArt.size)}
  return true;
}
let attempts=0;
const run=()=>{enhance().then(done=>{if(!done&&attempts++<40)setTimeout(run,100)});};
run();
})();
