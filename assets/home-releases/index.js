(()=>{
'use strict';
const rail=document.querySelector('#releaseHomeGrid');
if(!rail)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials=title=>String(title||'').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const primaryEvent=game=>(game.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
const dateValue=event=>event.date||event.date_start||null;
const dayDiff=value=>value?Math.ceil((Date.parse(`${value}T12:00:00Z`)-Date.now())/86400000):null;
const dateLabel=event=>{
  if(event.precision==='tbd')return 'Дата уточняется';
  const value=dateValue(event);
  if(!value)return 'Дата уточняется';
  if(event.precision==='year')return new Date(`${value}T12:00:00Z`).getUTCFullYear().toString();
  if(event.precision==='month')return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
  if(event.precision==='quarter'){const date=new Date(`${value}T12:00:00Z`);return `${Math.floor(date.getUTCMonth()/3)+1} квартал ${date.getUTCFullYear()}`}
  const diff=dayDiff(value);
  if(diff===0)return 'Сегодня';
  if(diff===1)return 'Завтра';
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)).replace('.','');
};
const candidates=game=>{
  const id=Number(game.external_ids?.steam);
  return [...new Set([
    game.image?.local_url,
    game.image?.source_url,
    ...(game.image_candidates||[]),
    id&&`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
    id&&`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    id&&`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`
  ].filter(Boolean))];
};
const card=game=>{
  const event=primaryEvent(game);
  const diff=dayDiff(dateValue(event));
  const image=candidates(game)[0]||'';
  const meta=[...(game.genres||[]).slice(0,1),...(event.platforms||[]).slice(0,1)].join(' · ');
  return `<article class="home-release-card" data-release="${esc(game.slug)}"><a class="home-release-card__link" href="calendar/#game=${encodeURIComponent(game.slug)}"><div class="home-release-card__media" data-initials="${esc(initials(game.title))}">${image?`<img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="eager" decoding="async" data-cover-index="0">`:''}<span class="home-release-card__date ${Number.isFinite(diff)&&diff>=0&&diff<=7?'is-near':''}">${esc(dateLabel(event))}</span></div><div class="home-release-card__body"><h3>${esc(game.title)}</h3><div class="home-release-card__meta">${esc(meta)}</div></div></a></article>`;
};
const bindFallbacks=(games)=>{
  rail.querySelectorAll('.home-release-card').forEach(cardElement=>{
    const game=games.find(item=>item.slug===cardElement.dataset.release);
    const image=cardElement.querySelector('img');
    if(!game||!image)return;
    const urls=candidates(game);
    image.addEventListener('error',()=>{
      const next=Number(image.dataset.coverIndex||0)+1;
      if(next<urls.length){image.dataset.coverIndex=String(next);image.src=urls[next];return}
      image.closest('.home-release-card__media')?.classList.add('is-broken');
      image.remove();
    });
  });
};
const bindRail=()=>{
  document.querySelectorAll('[data-release-rail]').forEach(button=>{
    button.onclick=()=>rail.scrollBy({left:Number(button.dataset.releaseRail)*Math.max(320,rail.clientWidth*.82),behavior:'smooth'});
  });
  rail.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;event.preventDefault();rail.scrollBy({left:event.deltaY,behavior:'auto'})},{passive:false});
};

Promise.all([
  fetch('data/releases/current.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}),
  fetch('features/home-releases/rules.json',{cache:'no-store'}).then(response=>response.ok?response.json():{})
]).then(([payload,rules])=>{
  const now=Date.now()-86400000;
  const maximum=Math.max(6,Number(rules.maximum_cards||12));
  const rows=(payload.releases||[]).filter(game=>{
    const event=primaryEvent(game);
    const end=event.date_end||event.date||event.date_start;
    return !end||Date.parse(`${end}T23:59:59Z`)>=now;
  }).sort((left,right)=>String(dateValue(primaryEvent(left))||'9999').localeCompare(String(dateValue(primaryEvent(right))||'9999'))||String(left.title).localeCompare(String(right.title),'ru')).slice(0,maximum);
  rail.innerHTML=rows.length?rows.map(card).join(''):'<div class="home-release-empty">Ближайшие релизы пока не найдены.</div>';
  bindFallbacks(rows);
  bindRail();
}).catch(error=>{
  console.warn('Home releases:',error);
  rail.innerHTML='<div class="home-release-empty">Календарь временно недоступен.</div>';
});
})();