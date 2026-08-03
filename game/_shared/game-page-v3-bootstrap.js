(()=>{
'use strict';
const sourceUrl='../_shared/game-page-v3.js?v=20260803-2';
fetch(sourceUrl,{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()})
  .then(source=>{
    const corrected=source.replace(
      "['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт']]",
      "['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт')] ]"
    );
    Function(corrected)();
  })
  .catch(error=>{
    console.error('Игропоиск: не удалось загрузить страницу игры v3',error);
    document.body.innerHTML='<main style="padding:40px;font:16px sans-serif">Не удалось загрузить страницу игры. Обновите страницу.</main>';
  });
})();
