(()=>{
'use strict';
const grid=document.querySelector('#releaseHomeGrid');

function ensureReleaseNav(){
  const nav=document.querySelector('.ig-site-header__nav');
  if(!nav||nav.querySelector('[data-ig-release-nav]'))return Boolean(nav);
  const link=document.createElement('a');
  link.href='/Igropoisk/calendar/';
  link.textContent='Календарь релизов';
  link.dataset.igReleaseNav='true';
  const news=nav.querySelector('[data-page="news"]');
  nav.insertBefore(link,news||null);
  return true;
}
const releaseNavObserver=new MutationObserver(()=>{if(ensureReleaseNav())releaseNavObserver.disconnect()});
releaseNavObserver.observe(document.documentElement,{subtree:true,childList:true});
ensureReleaseNav();
if(!grid)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials=title=>String(title||'').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const primaryEvent=game=>(game.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{};
const dateValue=event=>event.date||event.date_start||null;
const dayDiff=value=>value?Math.ceil((Date.parse(`${value}T12:00:00Z`)-Date.now())/86400000):null;
const dateLabel=event=>{
  if(event.precision==='tbd')return 'Дата уточняется';
  const value=dateValue(event);if(!value)return 'Дата уточняется';
  if(event.precision==='year')return new Date(`${value}T12:00:00Z`).getUTCFullYear().toString();
  if(event.precision==='month')return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
  if(event.precision==='quarter'){const d=new Date(`${value}T12:00:00Z`);return `${Math.floor(d.getUTCMonth()/3)+1} квартал ${d.getUTCFullYear()}`}
  const diff=dayDiff(value);if(diff===0)return 'Сегодня';if(diff===1)return 'Завтра';
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)).replace('.','');
};
const imageUrl=game=>game.image?.local_url||game.image?.source_url||'';
const card=game=>{
  const event=primaryEvent(game);const diff=dayDiff(dateValue(event));
  const dateClass=diff===0?'is-today':Number.isFinite(diff)&&diff>0&&diff<=7?'is-near':'';
  const platforms=(event.platforms||[]).slice(0,2).join(' · ');
  const genres=(game.genres||[]).slice(0,2).join(' · ');
  const image=imageUrl(game);
  return `<article class="release-home-card"><a class="release-home-card__link" href="calendar/#game=${encodeURIComponent(game.slug)}" aria-label="${esc(game.title)} — ${esc(dateLabel(event))}"><div class="release-home-card__media" data-initials="${esc(initials(game.title))}">${image?`<img src="${esc(image)}" alt="Обложка ${esc(game.title)}" loading="lazy" decoding="async">`:''}<span class="release-home-date ${dateClass}">${esc(dateLabel(event))}</span></div><div class="release-home-card__body"><h3>${esc(game.title)}</h3><div class="release-home-meta">${genres?`<span>${esc(genres)}</span>`:''}${platforms?`<span>${esc(platforms)}</span>`:''}</div><div class="release-home-status ${event.status==='confirmed'?'confirmed':''}">${event.status==='confirmed'?'Дата подтверждена':'Ожидает подтверждения'}</div></div></a></article>`;
};
fetch('data/releases/current.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}).then(data=>{
  const rows=(data.releases||[]).filter(game=>{const event=primaryEvent(game);const value=event.date_end||event.date||event.date_start;if(!value)return true;return Date.parse(`${value}T23:59:59Z`)>=Date.now()-86400000}).sort((a,b)=>String(dateValue(primaryEvent(a))||'9999').localeCompare(String(dateValue(primaryEvent(b))||'9999'))).slice(0,6);
  grid.innerHTML=rows.length?rows.map(card).join(''):'<div class="release-home-empty">Ближайшие релизы пока не найдены.</div>';
  grid.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.closest('.release-home-card__media')?.classList.add('is-broken'),{once:true}));
}).catch(error=>{console.warn('Release block:',error);grid.innerHTML='<div class="release-home-empty">Календарь временно недоступен.</div>'});
})();