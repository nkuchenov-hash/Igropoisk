#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog-visible.json'),'utf8'));
const outPath=path.join(root,'data/opencritic-game-ids.json');
const existing=fs.existsSync(outPath)?JSON.parse(fs.readFileSync(outPath,'utf8')):{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const headers={'user-agent':'Igropoisk/1.0 (game metadata resolver; https://github.com/nkuchenov-hash/Igropoisk)','accept':'application/json'};
async function json(url){try{const r=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(15000)});if(!r.ok)return null;return await r.json()}catch{return null}}
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
function yearFromEntity(e){const values=e?.claims?.P577||[];for(const c of values){const t=c?.mainsnak?.datavalue?.value?.time||'';const m=t.match(/[+-](\d{4})-/);if(m)return Number(m[1])}return null}
function openCriticId(e){const c=(e?.claims?.P2864||[])[0];return c?.mainsnak?.datavalue?.value?String(c.mainsnak.datavalue.value):null}
async function resolve(game){
  const q=encodeURIComponent(game.title);
  const search=await json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=en&uselang=en&type=item&limit=10&format=json&origin=*`);
  const rows=search?.search||[];
  const candidates=[];
  for(const row of rows){
    const data=await json(`https://www.wikidata.org/wiki/Special:EntityData/${row.id}.json`);
    const e=data?.entities?.[row.id];if(!e)continue;
    const oc=openCriticId(e);if(!oc)continue;
    const label=e.labels?.en?.value||row.label||'';
    const desc=e.descriptions?.en?.value||row.description||'';
    const y=yearFromEntity(e);
    let score=0;
    if(norm(label)===norm(game.title))score+=100;
    else if(norm(label).includes(norm(game.title))||norm(game.title).includes(norm(label)))score+=40;
    if(/video game|videogame/i.test(desc))score+=30;
    if(game.year&&y===Number(game.year))score+=25;
    else if(game.year&&y&&Math.abs(y-Number(game.year))<=1)score+=8;
    candidates.push({qid:row.id,label,description:desc,year:y,opencritic_id:oc,score});
    await sleep(60);
  }
  candidates.sort((a,b)=>b.score-a.score);
  return {best:candidates[0]||null,candidates:candidates.slice(0,5)};
}
const result={schema_version:1,generated_at:new Date().toISOString(),source:'Wikidata P2864',games:{...existing.games}};
for(const game of catalog){
  if(result.games?.[game.slug]?.opencritic_id)continue;
  const r=await resolve(game);
  result.games[game.slug]=r.best?{title:game.title,year:game.year||null,...r.best,status:r.best.score>=60?'resolved':'review'}:{title:game.title,year:game.year||null,status:'unresolved'};
  console.log(game.slug,result.games[game.slug].opencritic_id||'-',result.games[game.slug].status,result.games[game.slug].label||'');
  fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
  await sleep(100);
}
const resolved=Object.values(result.games).filter(x=>x.opencritic_id&&x.status==='resolved').length;
const review=Object.values(result.games).filter(x=>x.opencritic_id&&x.status==='review').length;
const unresolved=Object.values(result.games).filter(x=>!x.opencritic_id).length;
result.generated_at=new Date().toISOString();result.summary={total:catalog.length,resolved,review,unresolved};
fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.summary,null,2));
