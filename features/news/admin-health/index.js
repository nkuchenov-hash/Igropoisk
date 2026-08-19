(()=>{
  'use strict';

  const auth=window.IgropoiskAuth;
  const session=auth?.requireAuth({role:'admin',returnTo:location.href});
  if(!session)return;

  const root=document.querySelector('[data-news-health-admin]');
  const base=location.pathname.startsWith('/Igropoisk/')?'/Igropoisk/':'/';
  const manifestUrl='https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json';
  let activeHealthUrl=`${base}data/news-pipeline-health.json`;
  let activeBackend='repository-fallback';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels={healthy:'Работает',degraded:'Есть предупреждения',error:'Публикация заблокирована',pending:'Ожидает первого запуска'};
  const date=value=>{
    const parsed=Date.parse(value||'');
    return Number.isFinite(parsed)?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'medium'}).format(parsed):'—';
  };
  const age=value=>{
    const parsed=Date.parse(value||'');
    if(!Number.isFinite(parsed))return '—';
    const minutes=Math.max(0,Math.round((Date.now()-parsed)/60000));
    if(minutes<60)return `${minutes} мин`;
    if(minutes<1440)return `${Math.floor(minutes/60)} ч ${minutes%60} мин`;
    return `${Math.floor(minutes/1440)} д ${Math.floor((minutes%1440)/60)} ч`;
  };
  const percent=value=>`${(Number(value||0)*100).toFixed(1)}%`;
  const metricTitle=file=>({
    'data/news.json':'Новости СМИ',
    'data/publisher-news.json':'Официальные публикации',
    'data/youtube-signals.json':'YouTube-сигналы',
    'data/news-events.json':'Объединённые события',
    'data/news-home-ru.json':'Карточки главной'
  })[file]||file;

  function theme(){
    const button=document.querySelector('#theme');
    const documentRoot=document.documentElement;
    documentRoot.dataset.theme=localStorage.getItem('igroTheme')||documentRoot.dataset.theme||'dark';
    const paint=()=>{button.textContent=documentRoot.dataset.theme==='light'?'☾':'☀'};
    paint();
    button.addEventListener('click',()=>{
      documentRoot.dataset.theme=documentRoot.dataset.theme==='light'?'dark':'light';
      localStorage.setItem('igroTheme',documentRoot.dataset.theme);
      paint();
    });
  }

  function statusChip(status){
    return `<span class="ig-chip">${esc(labels[status]||status||'Нет данных')}</span>`;
  }

  function metrics(data){
    return Object.entries(data||{}).map(([file,metric])=>`
      <article class="parser-family">
        <b>${esc(metricTitle(file))}</b>
        <span>${esc(metric.count??0)}</span>
        <small>Минимум: ${esc(metric.minimum??0)} · возраст: ${esc(age(metric.generated_at))}</small>
      </article>`).join('');
  }

  function sourceRows(sources){
    const rows=(sources||[]).map(source=>`
      <article class="parser-family">
        <b>${esc(source.id)}</b>
        <small>${esc(source.error||source.status)} · подряд: ${esc(source.consecutive_failures||0)}</small>
        <small>Последняя ошибка: ${esc(date(source.last_failure_at))}</small>
      </article>`).join('');
    return rows||'<div class="ig-empty-state">Систематически неработающих источников нет.</div>';
  }

  function render(health){
    const pending=health?.status==='pending';
    const warnings=Array.isArray(health?.warnings)?health.warnings:[];
    const blocking=Array.isArray(health?.blocking_errors)?health.blocking_errors:[];
    root.dataset.newsHealthStatus=health?.status||'missing';
    root.dataset.newsHealthBackend=activeBackend;
    root.innerHTML=`
      <section class="parser-card ig-card ig-panel">
        <div class="parser-result-head">
          <div><b>Состояние автономных новостей</b><small>Последний успешный запуск: ${esc(date(health?.last_successful_run_at))}</small></div>
          ${statusChip(health?.status)}
        </div>
        <div class="parser-family-grid">
          <article class="parser-family"><b>Health snapshot</b><span>${esc(age(health?.generated_at))}</span><small>Создан: ${esc(date(health?.generated_at))}</small></article>
          <article class="parser-family"><b>Источник данных</b><span>${activeBackend==='object-storage'?'Облако':'Резерв'}</span><small>${activeBackend==='object-storage'?'Yandex Object Storage':'Копия из GitHub'}</small></article>
          <article class="parser-family"><b>Источники</b><span>${esc(health?.sources?.successful??0)} / ${esc(health?.sources?.total??0)}</span><small>Успешность: ${esc(percent(health?.sources?.success_ratio))}</small></article>
          <article class="parser-family"><b>Изображения</b><span>${esc(health?.images?.referenced??0)}</span><small>Отсутствуют: ${esc(health?.images?.missing??0)}</small></article>
          <article class="parser-family"><b>Проверенные группы</b><span>${esc(health?.due_groups?.length??0)}</span><small>${esc((health?.due_groups||[]).join(', ')||'—')}</small></article>
        </div>
        ${pending?'<div class="ig-empty-state">Первый автономный запуск ещё не создал рабочий health snapshot.</div>':''}
      </section>

      <section class="parser-card ig-card ig-panel">
        <h2>Объём и свежесть данных</h2>
        <div class="parser-family-grid">${metrics(health?.data)}</div>
      </section>

      <section class="parser-card ig-card ig-panel">
        <h2>Систематические ошибки источников</h2>
        <p>Источник попадает сюда после ${esc(health?.thresholds?.persistent_failure_runs??3)} последовательных неудачных проверок.</p>
        <div class="parser-family-grid">${sourceRows(health?.sources?.persistent_failures)}</div>
      </section>

      <section class="parser-card ig-card ig-panel">
        <h2>Диагностика</h2>
        <div class="parser-family-grid">
          <article class="parser-family"><b>Предупреждения</b><span>${esc(warnings.length)}</span><small>${warnings.map(esc).join('<br>')||'Нет'}</small></article>
          <article class="parser-family"><b>Блокирующие ошибки</b><span>${esc(blocking.length)}</span><small>${blocking.map(esc).join('<br>')||'Нет'}</small></article>
        </div>
        <div class="source-actions">
          <a class="ig-button" href="https://github.com/nkuchenov-hash/Igropoisk/actions/workflows/news-pipeline.yml" target="_blank" rel="noopener noreferrer">Запуски pipeline ↗</a>
          <a class="ig-button" href="${esc(activeHealthUrl)}" target="_blank" rel="noopener noreferrer">Открыть JSON ↗</a>
        </div>
      </section>`;
  }

  async function fetchJson(url){
    const target=new URL(url,location.href);
    target.searchParams.set('v',Date.now());
    const response=await fetch(target,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadRemoteHealth(){
    const manifest=await fetchJson(manifestUrl);
    if(![1,2].includes(Number(manifest?.schemaVersion))||manifest?.channel!=='news')throw new Error('Некорректный manifest');
    const candidate=manifest?.files?.['data/news-pipeline-health.json']?.url;
    if(!candidate)throw new Error('Health snapshot отсутствует в manifest');
    const url=new URL(candidate);
    if(url.origin!=='https://storage.yandexcloud.net'||!url.pathname.startsWith(`/igropoisk-content/news/snapshots/${manifest.version}/`))throw new Error('Недоверенный health URL');
    activeHealthUrl=url.href;
    activeBackend='object-storage';
    return fetchJson(url);
  }

  async function load(){
    theme();
    try{
      let health;
      try{
        health=await loadRemoteHealth();
      }catch(remoteError){
        console.warn('Remote news health unavailable; using repository fallback.',remoteError);
        activeHealthUrl=`${base}data/news-pipeline-health.json`;
        activeBackend='repository-fallback';
        health=await fetchJson(activeHealthUrl);
      }
      render(health);
    }catch(error){
      root.dataset.newsHealthStatus='error';
      root.innerHTML=`<section class="parser-card ig-card ig-panel"><div class="ig-empty-state">Не удалось загрузить read-only health snapshot: ${esc(error.message)}</div></section>`;
    }
  }

  load();
})();
