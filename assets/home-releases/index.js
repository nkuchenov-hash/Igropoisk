(()=>{
'use strict';
const rail=document.querySelector('#releaseHomeGrid');
if(!rail)return;
document.querySelector('.home-showcase-heading--split a[href="calendar/"]')?.classList.add('ig-button');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
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
const loadFeed=async path=>{
  if(window.IgropoiskHomeFeeds?.load)return window.IgropoiskHomeFeeds.load(path);
  const response=await fetch(path,{cache:'no-store'});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const independentCount=game=>Math.max(
  Number(game.expected_score?.metrics?.independent_publications||0),
  Number(game.media_intersection?.overall_count||0),
  Number(game.editorial_quality?.independent_source_count||0),
  Number(game.anticipation?.independent_publication_count||0)
);
const expectedLabel=game=>{
  const publications=independentCount(game);
  if(publications>=5)return `${publications} независимых игровых изданий`;
  if(publications>=2)return `Подтверждено ${publications} изданиями`;
  const tier=String(game.expected_score?.tier||'');
  if(tier==='marquee')return 'Один из главных ожидаемых релизов';
  if(tier==='high')return 'Высокая ожидаемость';
  return '';
};
const card=(game,kind)=>{
  const event=primaryEvent(game);
  const diff=dayDiff(dateValue(event));
  const image=candidates(game)[0]||'';
  const meta=[expectedLabel(game),...(event.platforms||[]).slice(0,1)].filter(Boolean).join(' · ');
  const href=game.page_url||`calendar/#game=${encodeURIComponent(game.slug)}`;
  return `<article class="ig-card ig-card--interactive home-release-card" data-release="${esc(game.slug)}" data-release-kind="${esc(kind)}"><a class="ig-card__part home-release-card__link" href="${esc(href)}"><div class="ig-card__media home-release-card__media" data-initials="${esc(initials(game.title))}">${image?`<img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="lazy" decoding="async" data-cover-index="0">`:''}<span class="home-release-card__date ${kind==='recent'||Number.isFinite(diff)&&diff>=0&&diff<=7?'is-near':''}">${esc(dateLabel(event))}</span></div><div class="ig-card__part home-release-card__body"><h3>${esc(game.title)}</h3>${meta?`<div class="ig-card__part home-release-card__meta">${esc(meta)}</div>`:''}</div></a></article>`;
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
const chronologicalKey=game=>dateValue(primaryEvent(game))||'9999-12-31';

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
  loadFeed('data/releases/public.json'),
  fetch('features/home-releases/rules.json',{cache:'no-store'}).then(response=>response.ok?response.json():{})
]).then(([payload,rules])=>{
  const recentDays=Math.max(1,Number(rules.recent_release_days||14));
  const selected=(payload.releases||[])
    .map(game=>({game,event:primaryEvent(game)}))
    .map(row=>({...row,kind:releaseKind(row.event,recentDays)}))
    .filter(row=>row.kind!=='expired')
    .sort((a,b)=>chronologicalKey(a.game).localeCompare(chronologicalKey(b.game))||Number(b.game.expected_score?.score||0)-Number(a.game.expected_score?.score||0)||String(a.game.title||'').localeCompare(String(b.game.title||''),'ru'));
  const rows=selected.map(row=>row.game);
  rail.innerHTML=selected.length?selected.map(row=>card(row.game,row.kind)).join(''):'<div class="home-release-empty">Сейчас нет опубликованных новых или ожидаемых релизов.</div>';
  bindFallbacks(rows);
  requestAnimationFrame(updateButtons);
}).catch(error=>{
  console.warn('Home releases:',error);
  rail.innerHTML='<div class="home-release-empty">Календарь временно недоступен.</div>';
});
})();