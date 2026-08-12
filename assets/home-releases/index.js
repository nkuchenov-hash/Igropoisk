(()=>{
'use strict';
const rail=document.querySelector('#releaseHomeGrid');
if(!rail)return;
document.querySelector('.home-showcase-heading--split a[href="calendar/"]')?.classList.add('ig-button');
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
  if(diff===-1)return 'Вышла вчера';
  if(Number.isFinite(diff)&&diff<0)return `Вышла ${formattedDate(value)}`;
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
    id&&`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`
  ].filter(Boolean))];
};
const anticipation=game=>game.anticipation||{};
const independentCount=game=>Number(anticipation(game).independent_publication_count||game.editorial_quality?.independent_source_count||0);
const steamPosition=game=>Number(anticipation(game).steam_popular_upcoming_position||game.editorial_quality?.steam_popular_upcoming_position||0);
const crossSiteEligible=game=>{
  const info=anticipation(game);
  if(info.homepage_eligible===true)return true;
  if(info.homepage_eligible===false)return false;
  const publications=independentCount(game);
  const popularIndex=Number(info.popular_index||0);
  const confidence=Number(info.popular_confidence||0);
  const nonSteamFamilies=(info.evidence_families||[]).filter(family=>family&&family!=='steam_chart');
  const crossSite=publications>=2&&popularIndex>=10&&confidence>=0.5&&nonSteamFamilies.length>0;
  const strongSteam=steamPosition(game)>0&&steamPosition(game)<=20&&publications>=1;
  return crossSite||strongSteam||game.editorial_quality?.manual_anticipated===true;
};
const anticipationScore=game=>Number(game.editorial_quality?.anticipation_score||anticipation(game).anticipation_score||0);
const anticipationLabel=game=>{
  const info=anticipation(game);
  if(info.cross_site_coverage===true||independentCount(game)>=2&&Number(info.popular_index||0)>=10)return 'Ожидаемость подтверждена несколькими площадками';
  const position=steamPosition(game);
  if(position>0&&independentCount(game)>0)return `Steam Popular Upcoming #${position} · есть независимое освещение`;
  return '';
};
const card=(game,kind)=>{
  const event=primaryEvent(game);
  const diff=dayDiff(dateValue(event));
  const image=candidates(game)[0]||'';
  const relevance=anticipationLabel(game);
  const meta=[relevance,...(event.platforms||[]).slice(0,1)].filter(Boolean).join(' · ');
  return `<article class="ig-card ig-card--interactive home-release-card" data-release="${esc(game.slug)}" data-release-kind="${esc(kind)}"><a class="ig-card__part home-release-card__link" href="calendar/#game=${encodeURIComponent(game.slug)}"><div class="ig-card__media home-release-card__media" data-initials="${esc(initials(game.title))}">${image?`<img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="lazy" decoding="async" data-cover-index="0">`:''}<span class="home-release-card__date ${kind==='recent'||Number.isFinite(diff)&&diff>=0&&diff<=7?'is-near':''}">${esc(dateLabel(event))}</span></div><div class="ig-card__part home-release-card__body"><h3>${esc(game.title)}</h3>${meta?`<div class="ig-card__part home-release-card__meta">${esc(meta)}</div>`:''}</div></a></article>`;
};
const bindFallbacks=games=>{
  rail.querySelectorAll('.home-release-card').forEach(cardElement=>{
    const game=games.find(item=>item.slug===cardElement.dataset.release);
    const image=cardElement.querySelector('img');
    if(!game)return;
    if(!image){cardElement.querySelector('.home-release-card__media')?.classList.add('is-broken');return}
    const urls=candidates(game);
    image.addEventListener('error',()=>{
      const next=Number(image.dataset.coverIndex||0)+1;
      if(next<urls.length){image.dataset.coverIndex=String(next);image.src=urls[next];return}
      image.closest('.home-release-card__media')?.classList.add('is-broken');
      image.remove();
    });
  });
};

const railButtons=[...document.querySelectorAll('[data-release-rail]')];
railButtons.forEach(button=>{
  button.classList.add('ig-icon-button');
  button.addEventListener('click',()=>{
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    const next=Math.max(0,Math.min(max,rail.scrollLeft+Number(button.dataset.releaseRail)*Math.max(320,rail.clientWidth*.82)));
    rail.scrollTo({left:next,behavior:'smooth'});
  });
});
const updateButtons=()=>{
  const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
  railButtons.forEach(button=>button.disabled=button.dataset.releaseRail==='-1'?rail.scrollLeft<=2:rail.scrollLeft>=max-2);
};
rail.addEventListener('scroll',updateButtons,{passive:true});
window.addEventListener('resize',updateButtons,{passive:true});

Promise.all([
  fetch('data/releases/current.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}),
  fetch('features/home-releases/rules.json',{cache:'no-store'}).then(response=>response.ok?response.json():{})
]).then(([payload,rules])=>{
  const maximum=Math.max(8,Number(rules.maximum_cards||12));
  const recentDays=Math.max(1,Number(rules.recent_release_days||7));
  const maximumRecent=Math.min(maximum,Math.max(0,Number(rules.maximum_recent_cards||4)));
  const classified=(payload.releases||[])
    .filter(crossSiteEligible)
    .map(game=>({game,event:primaryEvent(game)}))
    .map(row=>({...row,kind:releaseKind(row.event,recentDays)}))
    .filter(row=>row.kind!=='expired');

  const recent=classified.filter(row=>row.kind==='recent')
    .sort((a,b)=>anticipationScore(b.game)-anticipationScore(a.game)||String(dateEndValue(b.event)||'').localeCompare(String(dateEndValue(a.event)||'')))
    .slice(0,maximumRecent);
  const upcoming=classified.filter(row=>row.kind==='upcoming')
    .sort((a,b)=>anticipationScore(b.game)-anticipationScore(a.game)||String(dateValue(a.event)||'9999').localeCompare(String(dateValue(b.event)||'9999')));
  const selected=[...recent,...upcoming].slice(0,maximum);
  const rows=selected.map(row=>row.game);

  rail.innerHTML=selected.length?selected.map(row=>card(row.game,row.kind)).join(''):'<div class="home-release-empty">Сейчас нет релизов, у которых ожидаемость подтверждена несколькими независимыми сигналами.</div>';
  bindFallbacks(rows);
  requestAnimationFrame(updateButtons);
}).catch(error=>{
  console.warn('Home releases:',error);
  rail.innerHTML='<div class="home-release-empty">Календарь временно недоступен.</div>';
});
})();
