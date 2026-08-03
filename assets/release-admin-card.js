(()=>{
'use strict';
const grid=document.querySelector('#parserCards');if(!grid)return;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
fetch('../data/parser-runs/releases.json',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(run=>{
  const status=run?.status==='success'?'ok':run?.status==='error'?'error':'pending';
  const label=run?.status==='success'?'Работает':run?.status==='error'?'Ошибка':'Частично';
  const card=document.createElement('article');card.className='ig-admin-card';card.id='release-parser';
  card.innerHTML=`<span class="ig-admin-status ${status}">${label}</span><h2>Календарь релизов</h2><p>Находит новые даты выхода, переносы и обложки, создаёт редакционные черновики и не перезаписывает заблокированные поля.</p><dl class="mini-stats"><dt>Найдено</dt><dd>${esc(run?.games_found??'—')}</dd><dt>Изменений</dt><dd>${esc(run?.changes_found??'—')}</dd><dt>Проверено</dt><dd>${esc(run?.checked_at||'—')}</dd></dl><div class="admin-card-actions"><a class="ig-button" href="parsers/releases/">Открыть центр →</a><a class="ig-button secondary" href="https://github.com/nkuchenov-hash/Igropoisk/actions/workflows/parser-scheduler.yml" target="_blank" rel="noopener noreferrer">Запуск ↗</a></div>`;
  grid.append(card);
}).catch(()=>{});
})();
