(()=>{
'use strict';

const slug=decodeURIComponent(document.body?.dataset?.slug||location.pathname.split('/').filter(Boolean).at(-1)||'');
const draftUrl=slug?`../../data/drafts/${encodeURIComponent(slug)}.json`:'';
const waitFor=(selector,attempts=100,delay=100)=>new Promise(resolve=>{
  let count=0;
  const tick=()=>{
    const node=document.querySelector(selector);
    if(node||count++>=attempts)return resolve(node||null);
    setTimeout(tick,delay);
  };
  tick();
});
const first=(...values)=>values.find(value=>value!==null&&value!==undefined&&value!=='');
const arr=value=>Array.isArray(value)?value:[];

function youtubeId(value){
  const raw=String(value||'').trim();
  if(!raw)return'';
  if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
  try{
    const url=new URL(raw,location.href);
    if(/(?:^|\.)youtu\.be$/i.test(url.hostname))return url.pathname.split('/').filter(Boolean)[0]||'';
    if(/(?:^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname)||/(?:^|\.)youtube\.com$/i.test(url.hostname)){
      return first(url.searchParams.get('v'),url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1],'')||'';
    }
  }catch{}
  return'';
}

function normalizeVideo(item){
  if(!item)return null;
  const object=typeof item==='string'?{url:item}:item;
  const id=first(
    youtubeId(object.video_id),
    youtubeId(object.youtube_id),
    youtubeId(object.youtubeId),
    youtubeId(object.id),
    youtubeId(object.url),
    youtubeId(object.embed_url),
    youtubeId(object.source_url)
  );
  if(!id)return null;
  return{
    id,
    title:String(first(object.title,object.name,'Трейлер')),
    kind:String(first(object.type,object.kind,object.category,'')),
    thumbnail:String(first(object.thumbnail,object.poster,object.image,`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`))
  };
}

function chooseTrailer(videos){
  const list=arr(videos).map(normalizeVideo).filter(Boolean);
  if(!list.length)return null;
  const score=video=>{
    const text=`${video.kind} ${video.title}`.toLowerCase();
    if(/official.*launch|launch.*official|релизн.*официал|официал.*релизн/.test(text))return 50;
    if(/launch|релизн/.test(text))return 40;
    if(/official.*trailer|trailer.*official|официал.*трейлер/.test(text))return 30;
    if(/trailer|трейлер/.test(text))return 20;
    if(/gameplay|геймплей/.test(text))return 10;
    return 0;
  };
  return list.sort((a,b)=>score(b)-score(a))[0];
}

function backgroundEmbed(id){
  const params=new URLSearchParams({
    autoplay:'1',mute:'1',controls:'0',loop:'1',playlist:id,playsinline:'1',rel:'0',modestbranding:'1',iv_load_policy:'3',disablekb:'1',fs:'0'
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}
function foregroundEmbed(id){
  const params=new URLSearchParams({autoplay:'1',controls:'1',playsinline:'1',rel:'0',modestbranding:'1'});
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}

function buildTrailerDialog(video,title){
  let dialog=document.querySelector('#gameTrailerDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='gameTrailerDialog';
  dialog.className='game-trailer-dialog';
  dialog.setAttribute('aria-label',`Трейлер: ${title}`);
  dialog.innerHTML=`<div class="game-trailer-dialog__panel"><button class="game-trailer-dialog__close" type="button" aria-label="Закрыть трейлер">×</button><div class="game-trailer-dialog__frame" data-trailer-frame></div></div>`;
  document.body.appendChild(dialog);
  const close=()=>dialog.close();
  dialog.querySelector('.game-trailer-dialog__close')?.addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target===dialog)close()});
  dialog.addEventListener('close',()=>{const frame=dialog.querySelector('[data-trailer-frame]');if(frame)frame.replaceChildren()});
  dialog.openTrailer=()=>{
    const frame=dialog.querySelector('[data-trailer-frame]');
    if(!frame)return;
    const iframe=document.createElement('iframe');
    iframe.src=foregroundEmbed(video.id);
    iframe.title=`${title} — ${video.title}`;
    iframe.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen=true;
    iframe.referrerPolicy='strict-origin-when-cross-origin';
    frame.replaceChildren(iframe);
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  };
  return dialog;
}

async function install(){
  if(!draftUrl)return;
  let draft;
  try{
    const response=await fetch(draftUrl,{cache:'no-store'});
    if(!response.ok)return;
    draft=await response.json();
  }catch{return}
  const trailer=chooseTrailer(draft?.media?.videos);
  if(!trailer)return;

  const hero=await waitFor('#gameHero');
  const actions=await waitFor('#gameHero .hero-actions');
  if(!hero||!actions)return;

  const title=String(first(draft?.identity?.title,document.body.dataset.title,document.querySelector('#gameTitle')?.textContent,slug));
  hero.classList.add('game-hero--cinematic');
  hero.dataset.cinematicProvider='youtube';

  if(!hero.querySelector('.game-hero__cinematic-layer')){
    const layer=document.createElement('div');
    layer.className='game-hero__cinematic-layer';
    layer.setAttribute('aria-hidden','true');
    hero.prepend(layer);

    const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const saveData=Boolean(navigator.connection?.saveData||navigator.mozConnection?.saveData||navigator.webkitConnection?.saveData);
    if(!reducedMotion&&!saveData){
      setTimeout(()=>{
        if(!layer.isConnected||document.visibilityState==='hidden')return;
        const iframe=document.createElement('iframe');
        iframe.className='game-hero__cinematic-video';
        iframe.src=backgroundEmbed(trailer.id);
        iframe.title='';
        iframe.tabIndex=-1;
        iframe.setAttribute('aria-hidden','true');
        iframe.allow='autoplay; encrypted-media';
        iframe.referrerPolicy='strict-origin-when-cross-origin';
        iframe.addEventListener('load',()=>hero.classList.add('game-hero--cinematic-playing'),{once:true});
        layer.appendChild(iframe);
      },850);
    }
  }

  if(!actions.querySelector('[data-game-trailer]')){
    const button=document.createElement('button');
    button.type='button';
    button.className='state-button game-trailer-button';
    button.dataset.gameTrailer='';
    button.innerHTML='<span class="game-trailer-button__icon" aria-hidden="true">▶</span> Трейлер';
    const dialog=buildTrailerDialog(trailer,title);
    button.addEventListener('click',()=>dialog.openTrailer?.());
    actions.prepend(button);
  }
}

install().catch(error=>console.warn('Игропоиск: cinematic hero',error));
})();