(()=>{
'use strict';
const rail=document.querySelector('#releaseHomeGrid');
if(!rail)return;
const heading=document.querySelector('.home-showcase-heading--split');
const calendarLink=heading?.querySelector('a[href="calendar/"]')||null;
if(calendarLink){calendarLink.classList.add('ig-button','ig-text-link');calendarLink.textContent='Открыть календарь'}
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const identity=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
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
let coverQuality={minimum_width:600,minimum_height:900,minimum_aspect_ratio:.62,maximum_aspect_ratio:.72};
const coverRatio=(width,height)=>height>0?width/height:0;
const steamPosterCandidates=game=>{
  const id=Number(game.external_ids?.steam);
  if(!id)return [];
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`
  ];
};
const candidates=game=>[...new Set([
  game.image?.local_url,
  ...(game.image?.candidate_urls||[]),
  ...(game.image_candidates||[]),
  game.image?.source_url,
  ...steamPosterCandidates(game)
].filter(Boolean))];
const loadedCoverApproved=image=>{
  const width=Number(image.naturalWidth||0);
  const height=Number(image.naturalHeight||0);
  const ratio=coverRatio(width,height);
  return width>=Number(coverQuality.minimum_width||600)
    &&height>=Number(coverQuality.minimum_height||900)
    &&ratio>=Number(coverQuality.minimum_aspect_ratio||.62)
    &&ratio<=Number(coverQuality.maximum_aspect_ratio||.72);
};
const loadFeed=async path=>{
  if(window.IgropoiskHomeFeeds?.load)return window.IgropoiskHomeFeeds.load(path);
  const response=await fetch(path,{cache:'no-store'});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.json();
};
let popularByIdentity=new Map();
const anticipation=game=>game.anticipation||{};
const popularEvidence=game=>popularByIdentity.get(identity(game.slug))||popularByIdentity.get(identity(game.title))||null;
const steamPosition=game=>Number(anticipation(game).steam_popular_upcoming_position||game.editorial_quality?.steam_popular_upcoming_position||0);
const popularIndex=game=>Number(anticipation(game).popular_index??popularEvidence(game)?.score??0);
const legacyAnticipationScore=game=>Number(game.editorial_quality?.anticipation_score||anticipation(game).anticipation_score||popularEvidence(game)?.score||0);
const rating100=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
const overallAnticipationRating=game=>{
  const expected=Number(game.expected_score?.score??game.significance?.score??0);
  if(expected>0)return rating100(expected);
  const legacy=legacyAnticipationScore(game);
  return legacy>0?rating100(legacy/1.22):null;
};
const playerAnticipationRating=game=>{
  const evidence=popularEvidence(game);
  const position=steamPosition(game);
  const signals=evidence?.signals||{};
  const families=new Set(evidence?.families||[]);
  const hasPlayerSignals=['reddit','youtube','twitch','steam_chart'].some(family=>families.has(family)||Number(signals[family]||0)>0);
  const live=hasPlayerSignals&&popularIndex(game)>0?rating100(popularIndex(game)*2.5):null;
  const steam=position>0?rating100(101-Math.min(100,position)):null;
  if(live!==null&&steam!==null)return rating100(live*.7+steam*.3);
  return live??steam;
};
const anticipationMeta=game=>{
  const overall=overallAnticipationRating(game);
  const players=playerAnticipationRating(game);
  return [overall!==null?`Ожидание ${overall}`:'',players!==null?`Игроки ${players}`:''].filter(Boolean);
};
const card=(game,kind)=>{
  const event=primaryEvent(game);
  const diff=dayDiff(dateValue(event));
  const image=candidates(game)[0];
  if(!image)throw new Error(`Public release has no cover candidate: ${game.slug}`);
  const meta=[...anticipationMeta(game),...(event.platforms||[]).slice(0,1)].filter(Boolean).join(' · ');
  return `<article class="ig-card ig-card--interactive home-release-card" data-release="${esc(game.slug)}" data-release-kind="${esc(kind)}"><a class="ig-card__part home-release-card__link" href="calendar/#game=${encodeURIComponent(game.slug)}"><div class="ig-card__media home-release-card__media"><img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="lazy" decoding="async" data-cover-index="0"><span class="home-release-card__date ${kind==='recent'||Number.isFinite(diff)&&diff>=0&&diff<=7?'is-near':''}">${esc(dateLabel(event))}</span></div><div class="ig-card__part home-release-card__body"><h3>${esc(game.title)}</h3>${meta?`<div class="ig-card__part home-release-card__meta">${esc(meta)}</div>`:''}</div></a></article>`;
};
const ensureControls=()=>{
  if(!heading)return {controls:null,buttons:[]};
  let actions=heading.querySelector('.home-showcase-heading__actions');
  if(!actions){
    actions=document.createElement('div');
    actions.className='home-showcase-heading__actions';
    const controls=document.createElement('div');
    controls.className='ig-control-group home-releases__controls';
    controls.hidden=true;
    controls.setAttribute('aria-label','Прокрутка релизов');
    controls.innerHTML='<button class="ig-icon-button" type="button" data-release-rail="-1" aria-label="Предыдущие релизы">←</button><button class="ig-icon-button" type="button" data-release-rail="1" aria-label="Следующие релизы">→</button>';
    actions.append(controls);
    if(calendarLink)actions.append(calendarLink);
    heading.append(actions);
  }
  return {controls:actions.querySelector('.home-releases__controls'),buttons:[...actions.querySelectorAll('[data-release-rail]')]};
};
const {controls:railControls,buttons:railButtons}=ensureControls();
railButtons.forEach(button=>button.addEventListener('click',()=>{
  const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
  const step=Math.max(320,rail.clientWidth*.82);
  const next=Math.max(0,Math.min(max,rail.scrollLeft+Number(button.dataset.releaseRail)*step));
  rail.scrollTo({left:next,behavior:'smooth'});
}));
const updateButtons=()=>{
  const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
  if(railControls)railControls.hidden=max<=2;
  railButtons.forEach(button=>{button.disabled=button.dataset.releaseRail==='-1'?rail.scrollLeft<=2:rail.scrollLeft>=max-2});
};
const bindFallbacks=games=>{
  rail.querySelectorAll('.home-release-card').forEach(cardElement=>{
    const game=games.find(item=>item.slug===cardElement.dataset.release);
    const image=cardElement.querySelector('img');
    const media=cardElement.querySelector('.home-release-card__media');
    if(!game||!image||!media)return;
    const urls=candidates(game);
    const nextCandidate=()=>{
      media.classList.remove('is-cover-ready');
      const next=Number(image.dataset.coverIndex||0)+1;
      if(next>=urls.length){
        media.dataset.coverContract='failed';
        console.error(`Homepage cover contract failed for ${game.slug}; the publication pipeline must repair this cover instead of dropping the card.`);
        return;
      }
      image.dataset.coverIndex=String(next);
      image.src=urls[next];
    };
    const verifyLoaded=()=>{
      if(loadedCoverApproved(image)){media.classList.add('is-cover-ready');media.dataset.coverContract='ready';return}
      nextCandidate();
    };
    image.addEventListener('load',verifyLoaded);
    image.addEventListener('error',nextCandidate);
    if(image.complete)queueMicrotask(()=>image.naturalWidth?verifyLoaded():nextCandidate());
  });
};
rail.addEventListener('scroll',updateButtons,{passive:true});
rail.addEventListener('wheel',event=>{
  const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
  if(max<=2)return;
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
  if(!delta)return;
  const next=Math.max(0,Math.min(max,rail.scrollLeft+delta));
  if(Math.abs(next-rail.scrollLeft)<1)return;
  event.preventDefault();
  rail.scrollLeft=next;
},{passive:false});
window.addEventListener('resize',updateButtons,{passive:true});

Promise.all([
  loadFeed('data/releases/public.json'),
  fetch('features/home-releases/rules.json',{cache:'no-store'}).then(response=>response.ok?response.json():{}),
  loadFeed('data/popular/current.json')
]).then(([payload,rules,popularPayload])=>{
  coverQuality={...coverQuality,...(rules.cover_quality||{})};
  popularByIdentity=new Map();
  for(const item of popularPayload.ranking||[]){
    for(const key of [identity(item.slug),identity(item.title)])if(key&&!popularByIdentity.has(key))popularByIdentity.set(key,item);
  }
  const maximum=Math.max(8,Number(rules.maximum_cards||12));
  const recentDays=Math.max(1,Number(rules.recent_release_days||14));
  const maximumRecent=Math.min(maximum,Math.max(0,Number(rules.maximum_recent_cards||4)));
  const classified=(payload.releases||[])
    .filter(game=>game&&game.slug&&game.title&&Array.isArray(game.events)&&game.events.length)
    .map(game=>({game,event:primaryEvent(game)}))
    .map(row=>({...row,kind:releaseKind(row.event,recentDays)}))
    .filter(row=>row.kind!=='expired');

  const recent=classified.filter(row=>row.kind==='recent')
    .sort((a,b)=>String(dateEndValue(b.event)||'').localeCompare(String(dateEndValue(a.event)||''))||(overallAnticipationRating(b.game)||0)-(overallAnticipationRating(a.game)||0))
    .slice(0,maximumRecent);
  const upcoming=classified.filter(row=>row.kind==='upcoming')
    .sort((a,b)=>String(dateValue(a.event)||'9999').localeCompare(String(dateValue(b.event)||'9999'))||(overallAnticipationRating(b.game)||0)-(overallAnticipationRating(a.game)||0));
  const selected=[...recent,...upcoming].slice(0,maximum);
  const rows=selected.map(row=>row.game);

  rail.innerHTML=selected.length?selected.map(row=>card(row.game,row.kind)).join(''):'<div class="home-release-empty">Сейчас нет опубликованных новых или ожидаемых релизов.</div>';
  bindFallbacks(rows);
  requestAnimationFrame(updateButtons);
}).catch(error=>{
  console.warn('Home releases:',error);
  rail.innerHTML='<div class="home-release-empty">Календарь временно недоступен.</div>';
  requestAnimationFrame(updateButtons);
});
})();
