(()=>{
  'use strict';
  const auth=window.IgropoiskAuth;
  const session=auth?.requireAuth({role:'admin',returnTo:location.href});
  if(!session)return;
  const root=document.querySelector('[data-home-feeds-health-admin]');
  const base=location.pathname.startsWith('/Igropoisk/')?'/Igropoisk/':'/';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels={healthy:'Работает',degraded:'Есть предупреждения',error:'Публикация заблокирована',pending:'Ожидает первого запуска'};
  const parsed=value=>Date.parse(value||'');
  const ageHours=value=>Number.isFinite(parsed(value))?Math.max(0,(Date.now()-parsed(value))/3600000):Infinity;
  const age=value=>{
    const hours=ageHours(value);
    if(!Number.isFinite(hours))return '—';
    if(hours<1)return `${Math.round(hours*60)} мин`;
    if(hours<24)return `${Math.floor(hours)} ч ${Math.round((hours%1)*60)} мин`;
    return `${Math.floor(hours/24)} д ${Math.floor(hours%24)} ч`;
  };
  const date=value=>Number.isFinite(parsed(value))?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'medium'}).format(parsed(value)):'—';
  const theme=()=>{
    const button=document.querySelector('#theme');
    const documentRoot=document.documentElement;
    documentRoot.dataset.theme=localStorage.getItem('igroTheme')||documentRoot.dataset.theme||'dark';
    const paint=()=>{button.textContent=documentRoot.dataset.theme==='light'?'☾':'☀'};
    paint();
    button.addEventListener('click',()=>{documentRoot.dataset.theme=documentRoot.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',documentRoot.dataset.theme);paint()});
  };
  const chip=value=>`<span class="ig-chip">${esc(labels[value]||value||'Нет данных')}</span>`;
  const list=(items,empty)=>items.length?items.join(''):`<div class="ig-empty-state">${esc(empty)}</div>`;
  const popularRows=items=>list((items||[]).map(item=>`<article class="parser-family"><b>${esc(item.rank)}. ${esc(item.title)}</b><span>${esc(item.score)}</span><small>${esc(item.reason)}</small><small>${esc((item.families||[]).join(', '))} · изданий: ${esc(item.independent_news_sources)}</small></article>`),'Нет опубликованных позиций.');
  const releaseRows=items=>list((items||[]).map(item=>`<article class="parser-family"><b>${esc(item.title)}</b><span>${esc(item.category)}</span><small>${esc(item.reason)}</small></article>`),'Нет отобранных релизов.');
  const exclusionRows=items=>list((items||[]).map(item=>`<article class="parser-family"><b>${esc(item.title)}</b><small>${esc(item.reason||'Исключено правилом качества.')}${item.duplicate_of?` · дубль: ${esc(item.duplicate_of)}`:''}</small></article>`),'Исключённых записей нет.');
  function render(health){
    const staleLimit=Number(health?.thresholds?.stale_after_hours||12);
    const liveWarnings=[...(health?.warnings||[])];
    if(ageHours(health?.popular?.generated_at)>staleLimit)liveWarnings.push(`Рейтинг популярности старше ${staleLimit} часов.`);
    if(ageHours(health?.releases?.generated_at)>staleLimit)liveWarnings.push(`Релизы старше ${staleLimit} часов.`);
    const blocking=health?.blocking_errors||[];
    const liveStatus=blocking.length?'error':liveWarnings.length?'degraded':health?.status||'pending';
    root.dataset.homeFeedsHealthStatus=liveStatus;
    root.innerHTML=`
      <section class="parser-card ig-card ig-panel">
        <div class="parser-result-head"><div><b>Состояние блоков главной</b><small>Snapshot: ${esc(date(health?.generated_at))}</small></div>${chip(liveStatus)}</div>
        <div class="parser-family-grid">
          <article class="parser-family"><b>Популярное</b><span>${esc(health?.popular?.selected??0)}</span><small>Возраст: ${esc(age(health?.popular?.generated_at))} · отклонено: ${esc(health?.popular?.rejected??0)}</small></article>
          <article class="parser-family"><b>Релизы главной</b><span>${esc(health?.releases?.selected_home??0)}</span><small>Полный календарь: ${esc(health?.releases?.total_calendar??0)}</small></article>
          <article class="parser-family"><b>Дубли релизов</b><span>${esc(health?.releases?.duplicates??0)}</span><small>Не удаляются из полного календаря</small></article>
          <article class="parser-family"><b>Предупреждения</b><span>${esc(liveWarnings.length)}</span><small>${liveWarnings.map(esc).join('<br>')||'Нет'}</small></article>
        </div>
      </section>
      <section class="parser-card ig-card ig-panel"><h2>Почему игры сейчас популярны</h2><div class="parser-family-grid">${popularRows(health?.popular?.items||[])}</div></section>
      <section class="parser-card ig-card ig-panel"><h2>Релизы, выбранные для главной</h2><div class="parser-family-grid">${releaseRows(health?.releases?.selected||[])}</div></section>
      <section class="parser-card ig-card ig-panel"><h2>Исключения и дубли</h2><div class="parser-family-grid">${exclusionRows(health?.releases?.exclusions||[])}</div></section>
      <section class="parser-card ig-card ig-panel"><h2>Диагностика</h2><div class="parser-family-grid"><article class="parser-family"><b>Блокирующие ошибки</b><span>${esc(blocking.length)}</span><small>${blocking.map(esc).join('<br>')||'Нет'}</small></article></div><div class="source-actions"><a class="ig-button" href="https://github.com/nkuchenov-hash/Igropoisk/actions/workflows/parser-scheduler.yml" target="_blank" rel="noopener noreferrer">Запуски scheduler ↗</a><a class="ig-button" href="${base}data/home-feeds-health.json" target="_blank" rel="noopener noreferrer">Открыть JSON ↗</a></div></section>`;
  }
  async function load(){
    theme();
    try{
      const response=await fetch(`${base}data/home-feeds-health.json`,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    }catch(error){
      root.dataset.homeFeedsHealthStatus='error';
      root.innerHTML=`<section class="parser-card ig-card ig-panel"><div class="ig-empty-state">Не удалось загрузить read-only snapshot: ${esc(error.message)}</div></section>`;
    }
  }
  load();
})();
