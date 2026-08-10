(()=>{
'use strict';
const sourceUrl='../_shared/game-page-v3.js?v=20260803-2';
fetch(sourceUrl,{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()})
  .then(source=>{
    let corrected=source.replace(
      "['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт']]",
      "['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт')] ]"
    );
    corrected=corrected.replace(
      "const unique=list=>list.filter((value,index,items)=>value&&items.indexOf(value)===index);",
      "const unique=list=>list.filter((value,index,items)=>value&&items.indexOf(value)===index);\nconst uniqueMedia=list=>{const seen=new Set();return list.filter(item=>{const url=mediaUrl(item);if(!url||seen.has(url))return false;seen.add(url);return true})};\nconst releasePresentation=game=>{const raw=first(game?.release?.date_text,game?.release?.date,'Уточняется');const status=canonical(game?.release?.status||'');const parsed=Date.parse(game?.release?.date||'');const upcoming=(Number.isFinite(parsed)&&parsed>Date.now())||/(upcoming|expected|announced|coming|tba|ожида)/i.test(status);return{raw,upcoming,label:upcoming?'Ожидается '+raw:raw}};"
    );
    corrected=corrected.replace(
      "screenshots:arr(game.media.screenshots).length?arr(game.media.screenshots):arr(draft.media?.screenshots),\n      videos:arr(game.media.videos).length?arr(game.media.videos):arr(draft.media?.videos),\n      artwork:arr(game.media.artwork).length?arr(game.media.artwork):arr(draft.media?.artwork)",
      "screenshots:uniqueMedia([...arr(game.media.screenshots),...arr(draft.media?.screenshots)]),\n      videos:uniqueMedia([...arr(game.media.videos),...arr(draft.media?.videos)]),\n      artwork:uniqueMedia([...arr(game.media.artwork),...arr(draft.media?.artwork)])"
    );
    corrected=corrected.replace(
      "document.querySelector('#gameMeta').textContent=[game.release.date_text,join(game.classification.genres),join(game.companies.developers)].filter(Boolean).join(' · ');\n  document.querySelector('#editorialScore').textContent=formatScore(game.ratings.igropoisk);\n  document.querySelector('#editorialNote').textContent=game.rating_method?.method?.name||'Сводная редакционная оценка';",
      "const releaseInfo=releasePresentation(game);document.querySelector('#gameMeta').textContent=[releaseInfo.label,join(game.classification.genres),join(game.companies.developers)].filter(Boolean).join(' · ');\n  document.querySelector('#editorialScore').textContent=releaseInfo.upcoming?'—':formatScore(game.ratings.igropoisk);\n  document.querySelector('#editorialNote').textContent=releaseInfo.upcoming?'Рейтинг появится после выхода':game.rating_method?.method?.name||'Сводная редакционная оценка';"
    );
    corrected=corrected.replace(
      "document.querySelector('#details').innerHTML=`<dt>Дата выхода</dt><dd>${esc(game.release.date_text)}</dd><dt>Разработчик</dt>",
      "const releaseInfo=releasePresentation(game);document.querySelector('#details').innerHTML=`<dt>Статус</dt><dd>${releaseInfo.upcoming?'Ожидается':'Вышла'}</dd><dt>Дата выхода</dt><dd>${esc(releaseInfo.raw)}</dd><dt>Разработчик</dt>"
    );
    Function(corrected)();
  })
  .catch(error=>{
    console.error('Игропоиск: не удалось загрузить страницу игры v3',error);
    document.body.innerHTML='<main style="padding:40px;font:16px sans-serif">Не удалось загрузить страницу игры. Обновите страницу.</main>';
  });
})();
