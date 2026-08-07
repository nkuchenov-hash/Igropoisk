const state = {games: [], reviewQueue: [], apiWritable: false};
const el = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function load() {
  const candidates = ['/api/admin/game-registry', '../../data/game-registry/admin-snapshot.json', '../../data/game-registry/registry.transition.json', '../../data/content-pipeline/registry.json'];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {cache: 'no-store'}); if (!response.ok) continue;
      const data = await response.json();
      state.apiWritable = url.startsWith('/api/');
      state.games = normalize(data); state.reviewQueue = data.reviewQueue ?? [];
      el('mode').textContent = state.apiWritable ? 'Content API подключён: ручные решения сохраняются в каноническом реестре.' : 'Безопасный переходный режим: проверка доступна; изменения включатся после подключения Content API/PostgreSQL.';
      renderFilters(); render(); return;
    } catch {}
  }
  el('mode').textContent = 'Реестр ещё не материализован. Запустите scripts/orchestrate-content.mjs --finalize.';
}
function normalize(data) {
  if (Array.isArray(data.games)) return data.games;
  if (data.games && !Array.isArray(data.games)) return Object.values(data.games).map(game => ({
    id: game.id,title: game.identity?.canonicalTitle?.value,slug: game.identity?.slug?.value,kind: game.identity?.kind?.value,
    status: game.workflow?.status,statusReason: game.workflow?.statusReason,pageStatus: game.workflow?.pageStatus,
    researchStatus:game.workflow?.researchStatus,articleStatus:game.workflow?.articleStatus,reviewStatus:game.workflow?.igropoiskReviewStatus,
    completeness: ['developers','publishers','platforms','genres','description'].filter(key => game.fields?.[key]?.value).length / 5,
    priority: game.priority ?? {score:0,reasons:[]},conflicts: game.conflicts?.length ?? 0,possibleDuplicates:game.possibleDuplicates?.length ?? 0,
    sourceCount: game.discovery?.length ?? 0,lockedFields: Object.keys(game.editorial?.fieldLocks ?? {}),
    publicUrl: game.identity?.slug?.value ? `/game/${game.identity.slug.value}/` : null,published: game.workflow?.status === 'published',
    mergedIntoGameId:game.mergedIntoGameId,auditLog:[...(game.auditLog??[])].slice(-20).reverse()
  }));
  return (data.items ?? []).map(game => ({id: game.game_id ?? null,title: game.title,slug: game.slug,status: game.state,pageStatus: game.page?.gate_passed ? 'published' : game.page?.curated ? 'page_draft' : 'not_started',statusReason: (game.problems ?? []).join(', '),completeness: game.page?.gate_passed ? 1 : 0,priority:{score:0,reasons:[]},conflicts:(game.problems ?? []).length,possibleDuplicates:0,sourceCount:String(game.origin ?? '').split('+').filter(Boolean).length,lockedFields:[],publicUrl:`/game/${game.slug}/`,published:Boolean(game.page?.gate_passed),auditLog:[]}));
}
function renderFilters(){
  const statuses=[...new Set(state.games.map(game=>game.status).filter(Boolean))].sort(); el('status').innerHTML='<option value="">Все статусы</option>'+statuses.map(value=>`<option>${esc(value)}</option>`).join('');
  const pages=[...new Set(state.games.map(game=>game.pageStatus).filter(Boolean))].sort(); el('page').innerHTML='<option value="">Все страницы</option>'+pages.map(value=>`<option>${esc(value)}</option>`).join('');
}
function filtered(){const q=el('search').value.trim().toLowerCase();return state.games.filter(game=>(!q||[game.title,game.slug,game.id].some(value=>String(value??'').toLowerCase().includes(q)))&&(!el('status').value||game.status===el('status').value)&&(!el('page').value||game.pageStatus===el('page').value)&&(!el('conflict').value||(el('conflict').value==='yes'?game.conflicts>0:game.conflicts===0)));}
function render(){
  const games=filtered(); el('summary').innerHTML=[['Всего игр',state.games.length],['В очереди',state.games.filter(game=>!game.published&&!['rejected','merged_into_another_game'].includes(game.status)).length],['Конфликты',state.games.filter(game=>game.conflicts).length],['Неоднозначные',state.reviewQueue.length],['Опубликовано',state.games.filter(game=>game.published).length]].map(([label,value])=>`<article class="ig-card ig-admin-card"><div class="ig-kicker">${esc(label)}</div><h2>${value}</h2></article>`).join('');
  el('rows').innerHTML=games.map(game=>`<tr><td data-label="Игра"><strong>${esc(game.title)}</strong><br><code>${esc(game.id??'ID pending')}</code><br><small>${esc(game.slug)} · ${esc(game.kind??'game')}</small></td><td data-label="Статус"><strong>${esc(game.status)}</strong><div>${esc(game.pageStatus??'')} / ${esc(game.reviewStatus??'')}</div><div>${esc(game.statusReason??'')}</div></td><td data-label="Полнота"><span class="ig-pill">${Math.round((game.completeness??0)*100)}%</span></td><td data-label="Приоритет"><strong>${game.priority?.score??0}</strong><div>${esc((game.priority?.reasons??[]).slice(0,3).map(item=>item.signal).join(', '))}</div></td><td data-label="Источники / конфликты">${game.sourceCount??0} источн.<br>${game.conflicts??0} конфликт.<br>${game.possibleDuplicates??0} возможн. дублей<br>${game.lockedFields?.length??0} блокировок</td><td data-label="Действия"><div class="ig-toolbar games-actions"><a class="ig-button secondary" href="${esc(game.publicUrl??'#')}" target="_blank">Предпросмотр</a><button class="ig-button secondary" data-action="history" data-id="${esc(game.id)}">История</button><button class="ig-button secondary" data-action="reenrich" data-id="${esc(game.id)}" ${state.apiWritable?'':'disabled'}>Обогатить</button><button class="ig-button secondary" data-action="lock" data-id="${esc(game.id)}" ${state.apiWritable?'':'disabled'}>Блокировать поле</button><button class="ig-button secondary" data-action="merge" data-id="${esc(game.id)}" ${state.apiWritable?'':'disabled'}>Объединить</button>${game.status==='merged_into_another_game'?`<button class="ig-button secondary" data-action="undo-merge" data-id="${esc(game.id)}" ${state.apiWritable?'':'disabled'}>Отменить merge</button>`:''}<button class="ig-button" data-action="publish" data-id="${esc(game.id)}" ${state.apiWritable?'':'disabled'}>${game.published?'Снять':'Опубликовать'}</button></div></td></tr>`).join('');
}
for(const id of ['search','status','page','conflict']) el(id).addEventListener('input',render);
el('rows').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]'); if(!button)return;
  const game=state.games.find(item=>item.id===button.dataset.id); const action=button.dataset.action;
  if(action==='history'){alert((game?.auditLog??[]).map(item=>`${item.at??''} — ${item.action??''}: ${item.reason??''}`).join('\n')||'История пока пуста.');return;}
  if(!state.apiWritable)return;
  let body={};
  if(action==='lock'){const fieldPath=prompt('Путь поля для блокировки, например fields.description');if(!fieldPath)return;body={fieldPath};}
  if(action==='merge'){const targetGameId=prompt('ID канонической игры, в которую объединить запись');if(!targetGameId)return;body={targetGameId};}
  if(action==='publish')body={published:!game?.published};
  const response=await fetch(`/api/admin/game-registry/${encodeURIComponent(button.dataset.id)}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)alert('Операция отклонена validation gate или Content API.');else load();
});
load();
