#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const src=path.join(root,'short-artifacts');
const out=path.join(root,'benchmark','five-games-short-descriptions');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const rows=[];
for(const dir of fs.readdirSync(src)){
  const f=path.join(src,dir,'result.json');
  if(!fs.existsSync(f)) continue;
  try{rows.push(JSON.parse(fs.readFileSync(f,'utf8')))}catch{}
}
const valid=rows.filter(r=>r.status==='ok'&&r.short_contract_ok===true&&String(r.short_description||'').trim());
const gameOrder=['mafia','dangerous-dave-in-the-haunted-mansion','far-cry','jack-orlando-a-cinematic-adventure-1997','mass-effect-2007'];
const titleMap={
  mafia:'Mafia: The City of Lost Heaven',
  'dangerous-dave-in-the-haunted-mansion':'Dangerous Dave in the Haunted Mansion',
  'far-cry':'Far Cry',
  'jack-orlando-a-cinematic-adventure-1997':'Jack Orlando: A Cinematic Adventure',
  'mass-effect-2007':'Mass Effect'
};
const shell=(title,body,depth='..')=>`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | Игропоиск</title><link rel="stylesheet" href="/Igropoisk/assets/design-system.css"><link rel="stylesheet" href="${depth}/five-games-models/styles.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body><main class="wrap">${body}</main><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>`;

let cards='';
for(const slug of gameOrder){
  const rs=valid.filter(r=>r.game_slug===slug).sort((a,b)=>a.label.localeCompare(b.label,'ru'));
  const gdir=path.join(out,slug);fs.mkdirSync(gdir,{recursive:true});
  const modelCards=rs.map(r=>`<article class="ig-card bench-card"><div class="ig-kicker">${esc(r.label)}</div><h2>${esc(r.label)}</h2><p>${esc(r.short_description)}</p><div class="chips"><span class="ig-chip">${r.short_chars} знаков</span><span class="ig-chip">${r.short_sentences} предлож.</span><span class="ig-chip">макс. фраза ${r.max_sentence_chars}</span></div></article>`).join('');
  const body=`<div class="topbar"><div class="ig-logo brand">ИГРО<b>ПОИСК</b></div><a class="ig-button" href="../index.html">Все игры</a></div><header class="hero"><div class="ig-kicker">Short-description benchmark</div><h1 class="ig-page-title ig-display">${esc(titleMap[slug])}</h1><p>Только пригодные результаты нового readability-first прогона. Failed, quota errors, пустые ответы и тексты вне контракта исключены.</p><div class="chips"><span class="ig-chip">${rs.length} пригодных моделей</span><span class="ig-chip">100–320 знаков</span><span class="ig-chip">число предложений свободное</span></div></header><section class="grid">${modelCards||'<article class="ig-card bench-card"><p class="ig-muted">Пригодных результатов нет.</p></article>'}</section>`;
  fs.writeFileSync(path.join(gdir,'index.html'),shell(`${titleMap[slug]} — короткие описания`,body,'../..'));
  cards+=`<article class="ig-card bench-card"><div class="ig-kicker">${rs.length} пригодных результатов</div><h2>${esc(titleMap[slug])}</h2><p class="ig-muted excerpt">Все успешные короткие описания нового прогона показаны целиком на одной странице.</p><a class="ig-button" href="${slug}/index.html">Открыть игру</a></article>`;
}
const indexBody=`<div class="topbar"><div class="ig-logo brand">ИГРО<b>ПОИСК</b></div><a class="ig-button" href="../five-games-models/index.html">Полные обзоры</a></div><header class="hero"><div class="ig-kicker">Новый readability-first benchmark</div><h1 class="ig-page-title ig-display">5 игр × AI-модели: короткие описания</h1><p>Повторный прогон только короткого текста после source assembly. Для каждой игры все модели получили один frozen source pack. В публикации оставлены только валидные результаты: 100–320 знаков, число предложений не фиксировано.</p><div class="chips"><span class="ig-chip">${valid.length} пригодных текстов</span><span class="ig-chip">5 игр</span><span class="ig-chip">failed исключены</span><span class="ig-chip">noindex</span></div></header><section class="grid">${cards}</section>`;
fs.writeFileSync(path.join(out,'index.html'),shell('5 игр × короткие описания',indexBody,'..'));
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(valid,null,2)+'\n');
console.log(JSON.stringify({total_rows:rows.length,valid_rows:valid.length,output:path.relative(root,out)},null,2));
