#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const catalog=read('data/catalog-visible.json',[]);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const technical=(title,slug)=>{const raw=String(title||'').trim();if(!raw)return true;const norm=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();return norm(raw)===norm(slug)&&(/[-_]/.test(raw)||raw===raw.toLowerCase())};
const yearFrom=value=>Number(String(value||'').match(/(?:19|20)\d{2}/)?.[0]||0);
let written=0,created=0,updated=0;
for(const game of catalog){
  const slug=String(game?.slug||'').trim();if(!slug)continue;
  const draft=read(`data/drafts/${slug}.json`,null);
  const title=!technical(draft?.identity?.title,slug)?draft.identity.title:!technical(game?.title,slug)?game.title:slug.replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
  const year=Number(game?.year)||yearFrom(draft?.release?.date)||yearFrom(draft?.release?.date_text)||0;
  const gameId=String(game?.game_id||draft?.game_id||draft?.identity?.game_id||'').trim();
  const pagePath=path.join(root,'game',slug,'index.html');
  const existed=fs.existsSync(pagePath);
  const gameIdAttr=gameId?` data-game-id="${esc(gameId)}"`:'';
  const yearAttr=year?` data-year="${year}"`:'';
  const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css?v=20260813-1"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body data-title="${esc(title)}"${yearAttr} data-slug="${esc(slug)}" data-draft="${esc(slug)}"${gameIdAttr}><script src="../_shared/game-shell.js?v=20260813-1"></script><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>\n`;
  fs.mkdirSync(path.dirname(pagePath),{recursive:true});
  const previous=existed?fs.readFileSync(pagePath,'utf8'):'';
  if(previous!==html){fs.writeFileSync(pagePath,html);written++;if(existed)updated++;else created++}
}
console.log(JSON.stringify({catalog_games:catalog.length,shells_written:written,created,updated},null,2));
