(()=>{
'use strict';
const type=document.body.dataset.homeWidget;
if(!type)return;
const root=document.documentElement;
const base='../../../';
const rulesPath=`${base}features/${type}/rules.json`;
const dataPath=type==='home-releases'?`${base}data/releases/current.json`:`${base}data/home-widgets/reviews-of-day.json`;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fetchJSON=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()};
const storageKey=`igropoisk-home-widget-${type}`;

function stats(type,rules,data){
  if(type==='home-releases'){
    const releases=data.releases||[];
    const dated=releases.filter(item=>(item.events||[]).some(event=>event.date||event.date_start)).length;
    return [['Релизов в источнике',releases.length],['С датой',dated],['Карточек на главной',rules.maximum_cards],['Источник','current.json']];
  }
  const items=data.items||[];
  const published=items.filter(item=>item.publication_status==='published'&&item.source_gate_passed!==false).length;
  return [['Кандидатов',items.length],['Допущено',published],['Ротация',`${rules.rotation_hours} ч`],['Приоритет','Новые игры']];
}
function render(rules,data){
  document.querySelector('#widgetTitle').textContent=rules.title;
  document.querySelector('#widgetStatus').textContent=rules.status;
  document.querySelector('#widgetStatus').className=`ig-admin-status ${rules.status==='active'?'ok':'pending'}`;
  document.querySelector('#widgetRules').innerHTML=(rules.editorial_rules||[]).map(rule=>`<li>${esc(rule)}</li>`).join('');
  document.querySelector('#widgetStats').innerHTML=stats(type,rules,data).map(([label,value])=>`<div class="home-widget-admin__stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
  const saved=localStorage.getItem(storageKey);
  document.querySelector('#rulesEditor').value=saved||JSON.stringify(rules,null,2);
  document.querySelector('#draftStatus').textContent=saved?'Загружен локальный черновик':'Загружены правила из репозитория';
}
function bind(rules){
  const editor=document.querySelector('#rulesEditor');
  document.querySelector('#saveDraft').onclick=()=>{
    try{JSON.parse(editor.value);localStorage.setItem(storageKey,editor.value);document.querySelector('#draftStatus').textContent='Черновик сохранён в этом браузере'}
    catch(error){document.querySelector('#draftStatus').textContent=`JSON не сохранён: ${error.message}`}
  };
  document.querySelector('#resetDraft').onclick=()=>{localStorage.removeItem(storageKey);editor.value=JSON.stringify(rules,null,2);document.querySelector('#draftStatus').textContent='Возвращены правила из репозитория'};
  document.querySelector('#exportDraft').onclick=()=>{
    try{
      const value=JSON.stringify(JSON.parse(editor.value),null,2)+'\n';
      const blob=new Blob([value],{type:'application/json'});
      const link=document.createElement('a');
      link.href=URL.createObjectURL(blob);
      link.download='rules.json';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    }catch(error){document.querySelector('#draftStatus').textContent=`Экспорт отменён: ${error.message}`}
  };
  const theme=document.querySelector('#theme');
  root.dataset.theme=localStorage.getItem('igroTheme')||root.dataset.theme||'dark';
  const paint=()=>theme.textContent=root.dataset.theme==='light'?'☾':'☀';
  paint();
  theme.onclick=()=>{root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('igroTheme',root.dataset.theme);paint()};
}
Promise.all([fetchJSON(rulesPath),fetchJSON(dataPath)]).then(([rules,data])=>{render(rules,data);bind(rules)}).catch(error=>{
  document.querySelector('#widgetTitle').textContent='Инструмент недоступен';
  document.querySelector('#draftStatus').textContent=error.message;
});
})();