(()=>{
'use strict';
const slug=document.body.dataset.slug||decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)||'');
const draftSlug=document.body.dataset.draft||slug;
if(!slug)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arr=value=>Array.isArray(value)?value:[];
const fetchJSON=async url=>{try{const response=await fetch(url,{cache:'no-store'});return response.ok?await response.json():null}catch{return null}};
const waitFor=async selector=>{for(let i=0;i<120;i++){const node=document.querySelector(selector);if(node)return node;await new Promise(resolve=>setTimeout(resolve,100))}return null};
function removeRatingControls(){for(const selector of ['#rateGame','#rateInline','#ratingDialog'])document.querySelector(selector)?.remove()}
function installRatingRemoval(){removeRatingControls();const observer=new MutationObserver(removeRatingControls);observer.observe(document.body,{childList:true,subtree:true})}
const platformLabel=value=>({windows:'Windows',win:'Windows',mac:'macOS',macos:'macOS',linux:'Linux',ps5:'PlayStation 5',ps4:'PlayStation 4',xboxseries:'Xbox Series X|S',xboxone:'Xbox One',switch:'Nintendo Switch'}[String(value||'').toLowerCase()]||String(value||''));
function parseRequirementRaw(raw){
  if(!raw)return[];
  const doc=new DOMParser().parseFromString(`<div>${raw}</div>`,'text/html');
  const rows=[];
  doc.querySelectorAll('li').forEach(li=>{const strong=li.querySelector('strong');let key=strong?.textContent?.replace(/:\s*$/,'').trim()||'';let value=li.textContent.trim();if(strong)value=value.slice(strong.textContent.length).replace(/^:\s*/,'').trim();if(!key){key='Требование';value=li.textContent.trim()}if(value)rows.push([key,value])});
  if(!rows.length){const text=doc.body.textContent.replace(/\s+/g,' ').trim();if(text)rows.push(['Требования',text])}
  return rows;
}
function requirementRows(value){
  if(!value)return[];
  if(typeof value==='string')return parseRequirementRaw(value);
  if(value.raw)return parseRequirementRaw(value.raw);
  return Object.entries(value).filter(([key,item])=>key!=='raw'&&item!==null&&item!==undefined&&item!=='').map(([key,item])=>[key,Array.isArray(item)?item.join(', '):String(item)]);
}
function renderRequirementList(target,rows){if(!target)return;target.innerHTML=rows.length?rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join(''):'<dt>Данные</dt><dd>Точные характеристики пока не получены из официального источника.</dd>'}
function renderRequirements(parser){
  if(!parser?.requirements)return;
  const minimum=parser.requirements.minimum||parser.requirements.pc?.minimum;
  const recommended=parser.requirements.recommended||parser.requirements.pc?.recommended;
  renderRequirementList(document.querySelector('#minimumRequirements'),requirementRows(minimum));
  renderRequirementList(document.querySelector('#recommendedRequirements'),requirementRows(recommended));
  const platforms=[...new Set([...arr(parser.requirements.platforms),...arr(parser.classification?.platforms)].filter(Boolean))];
  const target=document.querySelector('#platformRequirements');
  if(target&&platforms.length)target.innerHTML=platforms.map(platform=>`<div><b>${esc(platformLabel(platform))}</b><small>Подтверждено источником данных игры</small></div>`).join('');
}
function renderFranchise(data,title){
  const games=arr(data?.games).filter(game=>game?.title&&String(game.title).toLowerCase()!==String(title||'').toLowerCase());
  if(!data?.name||!games.length)return;
  const overview=document.querySelector('#overview .lower-grid');if(!overview)return;
  let panel=document.querySelector('#franchisePanel');if(!panel){panel=document.createElement('section');panel.id='franchisePanel';panel.className='ig-panel game-panel franchise-panel';overview.appendChild(panel)}
  panel.innerHTML=`<div class="ig-toolbar franchise-panel__head"><div><h2>Игры серии</h2><span>${esc(data.name)}</span></div></div><div class="franchise-row">${games.map(game=>{const gameSlug=game.slug||String(game.title).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'-').replace(/^-|-$/g,'');return `<a class="ig-card franchise-game" href="../${encodeURIComponent(gameSlug)}/"><b>${esc(game.title)}</b><span>${esc(game.release_year||game.year||'')}</span></a>`}).join('')}</div>`;
}
function renderGuides(payload,title,hero){
  const guides=arr(payload?.guides||payload?.items).filter(item=>item?.title&&item?.url);
  if(!guides.length)return;
  const featured=document.querySelector('#featuredGuide'),grid=document.querySelector('#guideGrid'),quick=document.querySelector('#guideQuickLinks'),updated=document.querySelector('#guideUpdated');
  const first=guides[0];
  if(featured)featured.innerHTML=`${hero?`<img src="${esc(hero)}" alt="${esc(title)}" loading="lazy">`:''}<div><small>${esc(first.category||'ГАЙД')}</small><h2><a href="${esc(first.url)}" target="_blank" rel="noopener noreferrer">${esc(first.title)}</a></h2><p>${esc(first.description||'')}</p></div>`;
  if(grid)grid.innerHTML=guides.slice(1).map(item=>`<article class="game-panel guide-card"><div><small>${esc(item.publication||item.source||item.category||'Гайд')}</small><h3><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h3><p>${esc(item.description||'')}</p></div></article>`).join('');
  if(quick)quick.innerHTML=[...new Set(guides.map(item=>item.category).filter(Boolean))].slice(0,6).map(category=>`<span>${esc(category)}</span>`).join('');
  if(updated)updated.innerHTML=`<div class="updated-guide"><span>Проверено</span><b>${esc(String(payload.checked_at||payload.updated_at||'').slice(0,10))}</b></div>`;
}
async function main(){
  installRatingRemoval();
  await waitFor('#gameTitle');
  await new Promise(resolve=>setTimeout(resolve,250));
  const [parser,franchiseFile,draft,guides]=await Promise.all([
    fetchJSON(`../../data/parser-output/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/franchises/${encodeURIComponent(slug)}.json`),
    fetchJSON(`../../data/drafts/${encodeURIComponent(draftSlug)}.json`),
    fetchJSON(`../../data/guides/${encodeURIComponent(slug)}.json`)
  ]);
  renderRequirements(parser||draft);
  const title=document.querySelector('#gameTitle')?.textContent?.trim()||draft?.identity?.title||parser?.identity?.title||slug;
  renderFranchise(franchiseFile||draft?.relations?.franchise,title);
  const hero=document.querySelector('.game-hero__preview')?.src||parser?.media?.hero||draft?.media?.hero||'';
  renderGuides(guides,title,hero);
}
main().catch(error=>console.warn('Игропоиск: materialized game data layer',error));
})();
