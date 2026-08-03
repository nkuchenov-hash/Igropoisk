const root=document.documentElement;
const shell=document.body.dataset;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const join=value=>arr(value).filter(Boolean).join(', ');
const fallback={identity:{title:shell.title,slug:shell.slug},release:{date_text:shell.year},companies:{developers:[],publishers:[]},classification:{genres:[],platforms:[],categories:[]},editorial:{short_description:`${shell.title} — игра ${shell.year} года. Страница собрана для каталога Игропоиска на основе данных парсера и редакционной структуры сайта.`,integrated_description:''},media:{hero:'',cover:'',screenshots:[],videos:[]},ratings:{igropoisk:null,users:null,user_votes:0},sources:[]};

function similar(a,b){
  const x=String(a).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ');
  const y=String(b).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ');
  const meaningful=x.filter(token=>token.length>2);
  const hit=meaningful.filter(token=>y.includes(token)).length;
  return hit>=Math.max(1,Math.min(2,meaningful.length));
}

function ensureShell(){
  root.dataset.designSystem='igropoisk-v1';
  document.body.classList.add('ig-game-page');
  document.querySelector('.header')?.classList.add('ig-header');
  document.querySelector('.logo')?.classList.add('ig-logo');
  document.querySelector('.nav')?.classList.add('ig-nav');
  document.querySelector('.actions')?.classList.add('ig-actions');
  document.querySelectorAll('.btn').forEach(node=>node.classList.add('ig-button'));
  document.querySelectorAll('.wrap').forEach(node=>node.classList.add('ig-container'));
  document.querySelectorAll('.panel').forEach(node=>node.classList.add('ig-panel'));
  document.querySelectorAll('.tag').forEach(node=>node.classList.add('ig-pill'));
  document.querySelector('.tabs')?.classList.add('ig-tabs');
  const scorebox=document.querySelector('.scorebox');
  if(scorebox&&!document.querySelector('#userScore')){
    scorebox.innerHTML='<div class="score-grid"><div class="score-unit"><small>Игропоиск</small><strong id="score">—</strong><span id="scoreNote"></span></div><div class="score-unit"><small>Игроки</small><strong id="userScore">—</strong><span id="userScoreNote"></span></div></div><button class="favorite" id="favorite" type="button" aria-pressed="false">♡ В избранное</button>';
  }
  scorebox?.classList.add('ig-score-card');
  document.querySelector('.score-grid')?.classList.add('ig-score-grid');
  document.querySelectorAll('.score-unit').forEach(node=>node.classList.add('ig-score-unit'));
  document.querySelector('.favorite')?.classList.add('ig-favorite');
  document.querySelectorAll('.tab > .panel').forEach(node=>node.classList.add('tab-panel'));
  const tabs=document.querySelector('.tabs');
  const main=tabs?.parentElement;
  if(tabs&&main){
    [['reviews','Обзоры','Редакционные обзоры появятся после проверки материалов.'],['guides','Гайды','Гайды и полезные советы находятся в подготовке.']].forEach(([id,label,message])=>{
      if(!tabs.querySelector(`[data-tab="${id}"]`)){const button=document.createElement('button');button.textContent=label;button.dataset.tab=id;tabs.insertBefore(button,tabs.querySelector('[data-tab="sourcesTab"]'));}
      if(!document.getElementById(id)){
        const section=document.createElement('section');section.className='tab';section.id=id;section.innerHTML=`<div class="panel ig-panel tab-panel"><h2>${label}</h2><div class="empty ig-empty">${message}</div></div>`;main.appendChild(section);
      }
    });
  }
}

function formatScore(value){
  const number=Number(value);
  if(!Number.isFinite(number))return '—';
  return number>10?String(Math.round(number)):number.toFixed(1).replace('.0','');
}

function mediaUrl(item,preferThumbnail=false){if(typeof item==='string')return item;return preferThumbnail?(item?.thumbnail||item?.poster||item?.image||item?.url||item?.src||''):(item?.url||item?.src||item?.thumbnail||item?.poster||item?.image||'')}

function setFavorite(){
  const button=document.querySelector('#favorite');
  if(!button)return;
  const key=`igropoisk-favorite-${shell.slug||shell.title}`;
  const paint=()=>{const active=localStorage.getItem(key)==='1';button.setAttribute('aria-pressed',String(active));button.textContent=active?'♥ В избранном':'♡ В избранное'};
  button.onclick=()=>{localStorage.setItem(key,localStorage.getItem(key)==='1'?'0':'1');paint()};
  paint();
}

function bindTabs(){
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
    document.querySelectorAll('[data-tab]').forEach(node=>node.classList.toggle('active',node===button));
    document.querySelectorAll('.tab').forEach(node=>node.classList.toggle('active',node.id===button.dataset.tab));
  });
}

function bindTheme(){
  const button=document.querySelector('#theme');
  const paint=()=>{if(button)button.textContent=root.dataset.theme==='light'?'☾':'☀'};
  root.dataset.theme=localStorage.getItem('igropoisk-theme')||root.dataset.theme||'dark';
  paint();
  if(button)button.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igropoisk-theme',root.dataset.theme);paint()};
}

function renderMedia(g,title){
  const shots=arr(g.media?.screenshots).map(mediaUrl).filter(Boolean).slice(0,18);
  const videos=arr(g.media?.videos).map(item=>mediaUrl(item,true)).filter(Boolean);
  const hero=mediaUrl(g.media?.hero)||mediaUrl(g.media?.cover)||shots[0]||'';
  const heroNode=document.querySelector('.hero');
  if(heroNode)heroNode.style.backgroundImage=hero?`url("${hero.replace(/"/g,'%22')}")`:'';
  const items=[...(videos[0]?[{url:videos[0],video:true}]:[]),...shots.map(url=>({url}))];
  const visible=items.slice(0,6);
  const extra=Math.max(0,items.length-visible.length);
  const thumbs=document.querySelector('#thumbs');
  if(thumbs){
    thumbs.innerHTML=visible.map((item,index)=>`<button class="media-item${item.video?' primary':''}${extra&&index===visible.length-1?' more':''}"${extra&&index===visible.length-1?` data-more="+${extra}"`:''} type="button"><img src="${esc(item.url)}" alt="${item.video?'Видео':'Скриншот'} ${esc(title)}"></button>`).join('');
    thumbs.querySelectorAll('.media-item').forEach(node=>node.onclick=()=>document.querySelector('[data-tab="media"]')?.click());
  }
  const gallery=document.querySelector('#gallery');
  if(gallery)gallery.innerHTML=shots.map(url=>`<img src="${esc(url)}" alt="Скриншот ${esc(title)}" loading="lazy">`).join('')||'<div class="empty ig-empty">Медиа проверяется редакцией.</div>';
}

function render(g){
  ensureShell();
  const title=shell.title||g.identity?.title||'Игра';
  document.title=`${title} — Игропоиск`;
  document.querySelector('#title')?.replaceChildren(title);
  document.querySelector('#crumb')?.replaceChildren(title);
  document.querySelector('#meta')?.replaceChildren([shell.year||g.release?.date_text,join(g.classification?.genres),join(g.classification?.platforms)].filter(Boolean).join(' · '));
  document.querySelector('#lead')?.replaceChildren(g.editorial?.short_description||fallback.editorial.short_description);
  const editorial=g.ratings?.igropoisk;
  const users=g.ratings?.users;
  document.querySelector('#score')?.replaceChildren(formatScore(editorial));
  document.querySelector('#scoreNote')?.replaceChildren(editorial?'Сводная редакционная оценка.':'После редакционной проверки.');
  document.querySelector('#userScore')?.replaceChildren(formatScore(users));
  document.querySelector('#userScoreNote')?.replaceChildren(users?`${Number(g.ratings?.user_votes||0).toLocaleString('ru-RU')} оценок`:'Оценок пока нет.');
  renderMedia(g,title);
  const description=g.editorial?.integrated_description||g.editorial?.short_description||fallback.editorial.short_description;
  document.querySelector('#description')?.replaceChildren(description);
  const tags=document.querySelector('#tags');
  if(tags)tags.innerHTML=[...arr(g.classification?.genres),...arr(g.classification?.categories)].slice(0,10).map(value=>`<span class="tag ig-pill">${esc(value)}</span>`).join('');
  const details=document.querySelector('#details');
  if(details)details.innerHTML=`<dt>Дата выхода</dt><dd>${esc(g.release?.date_text||shell.year)}</dd><dt>Разработчик</dt><dd>${esc(join(g.companies?.developers)||'Уточняется')}</dd><dt>Издатель</dt><dd>${esc(join(g.companies?.publishers)||'Уточняется')}</dd><dt>Платформы</dt><dd>${esc(join(g.classification?.platforms)||'Уточняются')}</dd>`;
  const sources=arr(g.sources);
  const sourceNode=document.querySelector('#sources');
  if(sourceNode)sourceNode.innerHTML=sources.map(source=>`<div class="source"><b><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.source_name||source.domain)}</a></b><span>${esc(source.domain||'')}</span></div>`).join('')||'<div class="empty ig-empty">Источники находятся на редакционной проверке.</div>';
  document.querySelector('#sourceCount')?.replaceChildren(String(sources.length));
  bindTabs();bindTheme();setFavorite();
}

async function load(){
  let game=fallback;
  try{
    const response=await fetch(`../../data/drafts/${shell.draft}.json`,{cache:'no-store'});
    if(response.ok){
      const parsed=await response.json();
      if(similar(shell.title,parsed?.identity?.seed_title||parsed?.identity?.title||''))game={...fallback,...parsed,identity:{...fallback.identity,...parsed.identity},release:{...fallback.release,...parsed.release},companies:{...fallback.companies,...parsed.companies},classification:{...fallback.classification,...parsed.classification},editorial:{...fallback.editorial,...parsed.editorial},media:{...fallback.media,...parsed.media},ratings:{...fallback.ratings,...parsed.ratings}};
    }
  }catch(error){console.warn('Игропоиск: данные игры недоступны',error)}
  render(game);
}
load();
