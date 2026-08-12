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
      "function draftMatches(curated,draft){\n  if(!draft?.identity)return false;\n  const expectedId=Number(curated?.identity?.steam_appid),actualId=Number(draft.identity.steam_appid);\n  return expectedId&&actualId?expectedId===actualId:canonical(draft.identity.title)===canonical(curated?.identity?.title||seedTitle);\n}",
      "function draftMatches(curated,draft){\n  if(!draft)return false;\n  const draftSlug=canonical(first(draft.slug,draft.game_slug,draft.identity?.slug,''));\n  if(draftSlug&&draftSlug===canonical(slug))return true;\n  if(!draft.identity)return false;\n  const expectedId=Number(curated?.identity?.steam_appid),actualId=Number(draft.identity.steam_appid);\n  return expectedId&&actualId?expectedId===actualId:canonical(draft.identity.title)===canonical(curated?.identity?.title||seedTitle);\n}"
    );
    corrected=corrected.replace(
      "if(draftMatches(game,draftRaw)){",
      "if(draftMatches(game,draftRaw)||canonical(draftRaw?.identity?.slug)===canonical(slug)){"
    );
    corrected=corrected.replace(
      "const unique=list=>list.filter((value,index,items)=>value&&items.indexOf(value)===index);",
      "const unique=list=>list.filter((value,index,items)=>value&&items.indexOf(value)===index);\nconst badMedia=item=>{const url=mediaUrl(item);const source=String(item?.source_url||'');return /scribdassets\\.com|document_thumbnails/i.test(url)||/bing\\.com\\/images|google\\.[^/]+\\/search|yandex\\.[^/]+\\/images/i.test(source)};\nconst mediaKey=item=>{const raw=mediaUrl(item);if(!raw)return'';try{const url=new URL(raw,location.href);let path=url.pathname.toLowerCase();path=path.replace(/\\.(?:1920x1080|116x65|600x337)(?=\\.[a-z]+$)/,'');path=path.replace(/(?:[-_.](?:small|medium|large|thumb|thumbnail|1200x630|690|1080|1920|2048))(?=\\.[a-z]+$)/g,'');return url.hostname.toLowerCase()+path}catch{return raw.split(/[?#]/)[0].toLowerCase()}};\nconst uniqueMedia=list=>{const seen=new Set();return list.filter(item=>{const url=mediaUrl(item),key=mediaKey(item);if(!url||badMedia(item)||!key||seen.has(key))return false;seen.add(key);return true})};\nconst portraitCover=game=>{const appid=Number(game?.identity?.steam_appid||0);const current=mediaUrl(game?.media?.cover);if(appid&&(!current||/header\\.jpg|storepagebackground/i.test(current)))return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;return current};\nconst publicDisplayOverrides={'3-japan-stigmatized-property':{title:'Japan Stigmatized Property 3',developers:['Japan Stigmatized Property Association'],publishers:['Loxarc Inc.'],genres:['Приключение','Казуальная','Инди','Симулятор'],platforms:['Windows','macOS'],description:'Хоррор-наблюдение о реальных японских объектах: игрок следит за камерами, замечает аномалии и сообщает о них, пытаясь продержаться до рассвета.'}};\nconst applyDisplayOverride=game=>{const override=publicDisplayOverrides[slug];if(!override)return game;game.identity.title=override.title;game.companies.developers=override.developers;game.companies.publishers=override.publishers;game.classification.genres=override.genres;game.classification.platforms=override.platforms;game.editorial.short_description=override.description;game.editorial.integrated_description=override.description;return game};\nconst releasePresentation=game=>{const raw=first(game?.release?.date_text,game?.release?.date,'Уточняется');const status=canonical(game?.release?.status||'');const parsed=Date.parse(game?.release?.date||'');const upcoming=(Number.isFinite(parsed)&&parsed>Date.now())||/(upcoming|expected|announced|coming|tba|ожида)/i.test(status);return{raw,upcoming,label:upcoming?'Ожидается '+raw:raw}};"
    );
    corrected=corrected.replace(
      "screenshots:arr(game.media.screenshots).length?arr(game.media.screenshots):arr(draft.media?.screenshots),\n      videos:arr(game.media.videos).length?arr(game.media.videos):arr(draft.media?.videos),\n      artwork:arr(game.media.artwork).length?arr(game.media.artwork):arr(draft.media?.artwork)",
      "screenshots:uniqueMedia([...arr(draft.media?.screenshots),...arr(game.media.screenshots)]),\n      videos:uniqueMedia([...arr(draft.media?.videos),...arr(game.media.videos)]),\n      artwork:uniqueMedia([...arr(draft.media?.artwork),...arr(game.media.artwork)])"
    );
    corrected=corrected.replace(
      "game.requirements.platforms=arr(game.requirements.platforms).length?arr(game.requirements.platforms):arr(game.classification.platforms);\n  return game;",
      "game.requirements.platforms=arr(game.requirements.platforms).length?arr(game.requirements.platforms):arr(game.classification.platforms);\n  if(canonical(draftRaw?.identity?.slug)===canonical(slug)){game.media.screenshots=uniqueMedia([...arr(draftRaw.media?.screenshots),...arr(game.media.screenshots)]);game.media.videos=uniqueMedia([...arr(draftRaw.media?.videos),...arr(game.media.videos)]);game.media.artwork=uniqueMedia([...arr(draftRaw.media?.artwork),...arr(game.media.artwork)])}\n  game.media.cover=portraitCover(game)||game.media.cover;\n  return applyDisplayOverride(game);"
    );
    corrected=corrected.replace(
      '<div class="breadcrumbs"><a href="../../index.html">Главное</a> / <a href="../../index.html#search">Игры</a> / <span id="crumb"></span></div><div class="hero-copy">',
      '<div class="breadcrumbs"><a href="../../index.html">Главное</a> / <a href="../../index.html#search">Игры</a> / <span id="crumb"></span></div><div class="hero-poster" id="gameCover" aria-label="Обложка игры"></div><div class="hero-copy">'
    );
    corrected=corrected.replace(
      "setHero(hero,null);\n  document.querySelector('#gameTitle').textContent=title;document.querySelector('#crumb').textContent=title;",
      "setHero(hero,null);\n  const coverNode=document.querySelector('#gameCover');if(coverNode)coverNode.innerHTML=imageMarkup(portraitCover(game),title);\n  document.querySelector('#gameTitle').textContent=title;document.querySelector('#crumb').textContent=title;"
    );
    corrected=corrected.replace(
      "const items=[...videos.map(video=>({url:first(video.thumbnail,video.poster,video.image,video.url),video:true,label:first(video.title,'Видео')})),...shots.map((url,index)=>({url,label:`Скриншот ${index+1}`})),...unique([game.media.cover,game.media.hero]).filter(url=>url&&!shots.includes(url)).map(url=>({url,label:'Арт'}))].filter(item=>item.url);",
      "const items=(shots.length?shots.map((url,index)=>({url,label:`Скриншот ${index+1}`})):[...videos.map(video=>({url:first(video.thumbnail,video.poster,video.image,video.url),video:true,label:first(video.title,'Видео')})),...unique([game.media.cover,game.media.hero]).map(url=>({url,label:'Арт'}))]).filter(item=>item.url);"
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
