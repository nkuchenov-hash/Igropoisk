(()=>{
'use strict';
const rail=document.querySelector('#releaseHomeGrid');
if(!rail)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials=title=>String(title||'').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const primaryEvent=game=>(game.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
const dateValue=event=>event.date||event.date_start||null;
const dateEndValue=event=>event.date_end||event.date||event.date_start||null;
const utcDay=value=>value?Date.parse(`${value}T12:00:00Z`):null;
const todayUtc=()=>{const now=new Date();return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())};
const dayDiff=value=>{const time=utcDay(value);return Number.isFinite(time)?Math.round((time-todayUtc())/86400000):null};
const formattedDate=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)).replace('.','');
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
  if(diff===-1)return 'Релиз вчера';
  if(Number.isFinite(diff)&&diff<0)return `Релиз ${formattedDate(value)}`;
  return formattedDate(value);
};
const releaseKind=(event,recentDays)=>{
  const start=utcDay(dateValue(event));
  const end=utcDay(dateEndValue(event));
  const today=todayUtc();
  if(!Number.isFinite(start)&&!Number.isFinite(end))return 'upcoming';
  if(Number.isFinite(end)&&end<today&&end>=today-recentDays*86400000)return 'recent';
  if((Number.isFinite(start)&&start>=today)||(Number.isFinite(end)&&end>=today))return 'upcoming';
  return 'expired';
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
const card=(game,kind)=>{
  const event=primaryEvent(game);
  const diff=dayDiff(dateValue(event));
  const image=candidates(game)[0]||'';
  const meta=[...(game.genres||[]).slice(0,1),...(event.platforms||[]).slice(0,1)].join(' · ');
  return `<article class="ig-card ig-card--interactive home-release-card" data-release="${esc(game.slug)}" data-release-kind="${esc(kind)}" data-release-quality="${esc(game.home?.category||'legacy')}"><a class="ig-card__part home-release-card__link" href="calendar/#game=${encodeURIComponent(game.slug)}"><div class="ig-card__media home-release-card__media" data-initials="${esc(initials(game.title))}">${image?`<img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="eager" decoding="async" data-cover-index="0">`:''}<span class="home-release-card__date ${kind==='recent'||Number.isFinite(diff)&&diff>=0&&diff<=7?'is-near':''}">${esc(dateLabel(event))}</span></div><div class="ig-card__part home-release-card__body"><h3>${esc(game.title)}</h3><div class="ig-card__part home-release-card__meta">${esc(meta)}</div></div></a></article>`;
};
const bindFallbacks=games=>{
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
  const maximum=Math.max(6,Number(rules.maximum_cards||12));
  const recentDays=Math.max(1,Number(rules.recent_release_days||7));
  const maximumRecent=Math.min(maximum,Math.max(0,Number(rules.maximum_recent_cards||4)));
  const sourceRows=payload.releases||[];
  const qualityReady=sourceRows.some(game=>game.home&&typeof game.home.selected==='boolean');
  const classified=sourceRows.map(game=>({game,event:primaryEvent(game)}))
    .map(row=>({...row,kind:releaseKind(row.event,recentDays)}))
    .filter(row=>row.kind!=='expired'&&(!qualityReady||row.game.home?.selected===true));

  const recent=classified.filter(row=>row.kind==='recent')
    .sort((left,right)=>String(dateEndValue(right.event)||'').localeCompare(String(dateEndValue(left.event)||''))||String(left.game.title).localeCompare(String(right.game.title),'ru'))
    .slice(0,maximumRecent);
  const upcoming=classified.filter(row=>row.kind==='upcoming')
    .sort((left,right)=>String(dateValue(left.event)||'9999').localeCompare(String(dateValue(right.event)||'9999'))||String(left.game.title).localeCompare(String(right.game.title),'ru'));
  const selected=[...recent,...upcoming].slice(0,maximum);
  const rows=selected.map(row=>row.game);

  rail.dataset.releaseQuality=qualityReady?'ready':'legacy';
  rail.innerHTML=selected.length?selected.map(row=>card(row.game,row.kind)).join(''):'<div class="home-release-empty">Новые и ожидаемые релизы пока не найдены.</div>';
  bindFallbacks(rows);
  bindRail();
}).catch(error=>{
  console.warn('Home releases:',error);
  rail.innerHTML='<div class="home-release-empty">Календарь временно недоступен.</div>';
});
})();
