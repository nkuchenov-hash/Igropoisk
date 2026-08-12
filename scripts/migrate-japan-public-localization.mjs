import fs from 'node:fs';

const file='game/_shared/game-page-v3.js';
let text=fs.readFileSync(file,'utf8');

const brokenMedia="['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт']];";
const fixedMedia="['artGroup','mediaArt','artCount',art,(url,index)=>mediaCard(url,title,index===0?'Обложка':'Арт')]];";
if(text.includes(brokenMedia))text=text.replace(brokenMedia,fixedMedia);
else if(!text.includes(fixedMedia))throw new Error('renderMedia syntax anchor not found');

const anchor="async function load(){\n  shellHTML();root.dataset.designSystem='igropoisk-game-v3';const chunk=chunkForYear(seedYear);";
if(!text.includes(anchor))throw new Error('load() anchor not found');
const helper=`function applyPublicLocalization(game,draft){
  if(slug!=='3-japan-stigmatized-property')return game;
  const localized={...game};
  localized.identity={...game.identity,title:'Japan Stigmatized Property 3'};
  localized.release={...game.release,date_text:'6 августа 2026'};
  localized.companies={developers:['Japan Stigmatized Property Association'],publishers:['Japan Stigmatized Property Association','Loxarc Inc.']};
  localized.classification={...game.classification,genres:['Приключения','Казуальная','Инди','Симулятор'],platforms:['Windows','macOS'],categories:['Одиночная игра','Мультиплеер','Достижения Steam','Steam Cloud']};
  localized.editorial={...game.editorial,
    short_description:draft?.editorial?.short_description||'Хоррор-наблюдение: игрок следит за камерами в реальных японских объектах, замечает аномалии и сообщает о них, пытаясь продержаться до рассвета.',
    integrated_description:draft?.editorial?.integrated_description||'Japan Stigmatized Property 3 строится вокруг наблюдения за камерами в реальных японских объектах. Нужно замечать изменения и аномалии, вовремя сообщать о них и не пропустить слишком много событий до наступления рассвета.',
    features:['Наблюдение за камерами','Поиск аномалий','Реальные японские локации','Одиночная и совместная игра']
  };
  localized.sources=arr(game.sources).map(source=>({
    ...source,
    name:String(source?.name||'').includes('日本')?'Steam — Japan Stigmatized Property 3':source?.name,
    source_name:String(source?.source_name||'').includes('日本')?'Steam — Japan Stigmatized Property 3':source?.source_name,
    title:String(source?.title||'').includes('日本')?'Japan Stigmatized Property 3':source?.title
  }));
  return localized;
}

`;
if(!text.includes('function applyPublicLocalization(game,draft){'))text=text.replace(anchor,helper+anchor);
const oldLine="  const game=mergeGame(curatedFile?.games?.[slug]||null,draft,awards,reviews,rating,news);document.title=`${game.identity.title} — Игропоиск`;";
const newLine="  const game=applyPublicLocalization(mergeGame(curatedFile?.games?.[slug]||null,draft,awards,reviews,rating,news),draft);document.title=`${game.identity.title} — Игропоиск`;";
if(text.includes(oldLine))text=text.replace(oldLine,newLine);
else if(!text.includes(newLine))throw new Error('game merge line not found');
fs.writeFileSync(file,text);
console.log('Repaired shared game runtime syntax and applied public localization for Japan Stigmatized Property 3 only.');
