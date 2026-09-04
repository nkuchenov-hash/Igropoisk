import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const inputRoot=path.join(root,'benchmarks/editorial-five-games/results');
const outRoot=path.join(root,'benchmark/five-games-models');
fs.rmSync(outRoot,{recursive:true,force:true});
fs.mkdirSync(outRoot,{recursive:true});

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');}
function markdown(text){
  const lines=String(text||'').replace(/\r/g,'').split('\n');let html='',para=[];
  const flush=()=>{if(para.length){html+=`<p>${inline(para.join(' ').trim())}</p>`;para=[];}};
  for(const raw of lines){const t=raw.trim();if(!t){flush();continue}const m=t.match(/^(#{1,4})\s+(.+)$/);if(m){flush();const n=Math.min(4,m[1].length+1);html+=`<h${n}>${inline(m[2])}</h${n}>`;}else if(/^[-*]\s+/.test(t)){flush();html+=`<p>• ${inline(t.replace(/^[-*]\s+/,''))}</p>`;}else para.push(t);}flush();return html;
}
function shell(title,body,depth=0){
  const up='../'.repeat(depth);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | Игропоиск</title><link rel="stylesheet" href="${up}../../assets/design-system.css"><link rel="stylesheet" href="${up}styles.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body><main class="wrap">${body}</main></body></html>`;
}
function parseResultMd(file){
  const text=fs.readFileSync(file,'utf8');
  const title=(text.match(/^#\s+(.+)$/m)||[])[1]||path.basename(file,'.md');
  const provider=(text.match(/\*\*Provider:\*\*\s*([^\n]+)/)||[])[1]?.trim()||'';
  const model=(text.match(/\*\*Model:\*\*\s*`([^`]+)`/)||[])[1]||'';
  const status=(text.match(/\*\*Status:\*\*\s*([^\n]+)/)||[])[1]?.trim()||'';
  const reviewMeta=text.match(/\*\*Review:\*\*\s*(\d+)\s+слов,\s*(\d+)\s+разделов/);
  const latency=(text.match(/\*\*Latency:\*\*\s*([^\n]+)/)||[])[1]?.trim()||'';
  const short=(text.match(/## Короткое описание\s+([\s\S]*?)(?=\n## Полный обзор|$)/)||[])[1]?.trim()||'';
  const review=(text.match(/## Полный обзор\s+([\s\S]*)$/)||[])[1]?.trim()||'';
  return {title,provider,model,status,review_words:Number(reviewMeta?.[1]||0),sections:Number(reviewMeta?.[2]||0),latency,short,review};
}
function parseGameReadme(file){
  const text=fs.readFileSync(file,'utf8');
  const title=(text.match(/^#\s+(.+)$/m)||[])[1]||path.basename(path.dirname(file));
  const rows=[];
  for(const line of text.split('\n')){
    const m=line.match(/^\|\s*([^|]+?)\s*\|\s*(ok|partial|error)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(?:\[открыть\]\(\.\/([^\)]+)\)|—)\s*\|$/);
    if(m)rows.push({label:m[1].trim(),status:m[2],words:Number(m[3]),sections:Number(m[4]),file:m[5]||null});
  }
  return {title,rows};
}

const gameDirs=fs.readdirSync(inputRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
const games=[];
for(const slug of gameDirs){
  const dir=path.join(inputRoot,slug); const info=parseGameReadme(path.join(dir,'README.md'));
  const outDir=path.join(outRoot,slug);fs.mkdirSync(outDir,{recursive:true});
  const available=[];
  for(const row of info.rows){
    if(row.file&&fs.existsSync(path.join(dir,row.file))){
      const data=parseResultMd(path.join(dir,row.file));
      const id=path.basename(row.file,'.md');
      available.push({...row,id,data});
      const statusClass=row.status==='ok'?'ig-rating':'ig-muted';
      const body=`<div class="topbar"><a class="ig-button" href="index.html">← ${esc(info.title)}</a><a class="ig-button" href="../index.html">Все игры</a></div><header class="hero"><div class="ig-kicker">${esc(data.provider||'model benchmark')}</div><h1 class="ig-page-title ig-display">${esc(info.title)} — ${esc(row.label)}</h1><div class="chips"><span class="ig-chip">${esc(data.model)}</span><span class="ig-chip"><span class="${statusClass}">${esc(row.status)}</span></span><span class="ig-chip">${row.words} слов</span><span class="ig-chip">${row.sections} разделов</span><span class="ig-chip">${esc(data.latency)}</span></div></header><div class="bench-article-layout"><article class="article"><section class="ig-card copy-block"><div class="ig-kicker">Короткое описание страницы</div><h2>Описание</h2><p class="short-copy">${inline(data.short)}</p></section><section class="copy review-copy"><div class="ig-kicker">Полный обзор</div>${markdown(data.review)}</section></article><aside class="ig-panel sidebar"><b>Условия теста</b><p class="ig-muted">Текст получен после source assembly. Одинаковый frozen evidence pack для всех моделей этой игры. Никакой редакторской правки другой моделью.</p><div class="row"><span>Статус</span><b>${esc(row.status)}</b></div><div class="row"><span>Слов</span><b>${row.words}</b></div><div class="row"><span>Разделов</span><b>${row.sections}</b></div></aside></div>`;
      fs.writeFileSync(path.join(outDir,`${id}.html`),shell(`${info.title} — ${row.label}`,body,1));
    }
  }
  const cards=info.rows.map(row=>{
    const hit=available.find(x=>x.label===row.label);
    const status=row.status==='ok'?'<span class="ig-rating">ok</span>':row.status==='partial'?'<span class="ig-muted">partial</span>':'<span class="bench-error">error</span>';
    return `<article class="ig-card bench-card"><div class="ig-kicker">${status}</div><h2>${esc(row.label)}</h2><div class="metrics"><div class="ig-panel metric"><b>${row.words}</b><span>слов</span></div><div class="ig-panel metric"><b>${row.sections}</b><span>разделов</span></div></div>${hit?`<p class="ig-muted excerpt">${esc(hit.data.short).slice(0,240)}${hit.data.short.length>240?'…':''}</p><a class="ig-button" href="${hit.id}.html">Открыть результат</a>`:`<p class="ig-muted excerpt">Модель не дала пригодный результат в этом запуске. Технический сбой/лимит не подменён чужим текстом.</p>`}</article>`;
  }).join('');
  const opts=available.map(x=>`<option value="${x.id}.html">${esc(x.label)}</option>`).join('');
  const compare=available.length?`<section class="section"><div class="ig-kicker">Side-by-side</div><h2>Сравнить две модели</h2><div class="compare"><div class="ig-card compare-pane"><select id="left">${opts}</select><iframe class="frame" id="leftFrame" title="Левая модель"></iframe></div><div class="ig-card compare-pane"><select id="right">${opts}</select><iframe class="frame" id="rightFrame" title="Правая модель"></iframe></div></div></section><script>const l=document.getElementById('left'),r=document.getElementById('right'),lf=document.getElementById('leftFrame'),rf=document.getElementById('rightFrame');if(r.options.length>1)r.selectedIndex=1;function go(){lf.src=l.value;rf.src=r.value}l.onchange=go;r.onchange=go;go();</script>`:'';
  const body=`<div class="topbar"><a class="ig-button" href="../index.html">← Все 5 игр</a><div class="ig-logo brand">ИГРО<b>ПОИСК</b></div></div><header class="hero"><div class="ig-kicker">Production-realistic editorial benchmark</div><h1 class="ig-page-title ig-display">${esc(info.title)}</h1><p>Короткое описание страницы + обзор после реальной сборки source corpus. Сырые ответы моделей, без cross-model rewriting.</p><div class="chips"><span class="ig-chip">15 моделей</span><span class="ig-chip">${available.length} текстов</span><span class="ig-chip">noindex</span></div></header><section class="grid">${cards}</section>${compare}`;
  fs.writeFileSync(path.join(outDir,'index.html'),shell(info.title,body,1));
  games.push({slug,title:info.title,available:available.length,total:info.rows.length,best:available.sort((a,b)=>b.words-a.words)[0]});
}
const gameCards=games.map(g=>`<article class="ig-card bench-card"><div class="ig-kicker">${g.available}/${g.total} результатов</div><h2>${esc(g.title)}</h2><p class="ig-muted excerpt">Открыть все модели для этой игры и сравнить любые две рядом.</p><a class="ig-button" href="${g.slug}/index.html">Открыть игру</a></article>`).join('');
const body=`<div class="topbar"><div class="ig-logo brand">ИГРО<b>ПОИСК</b></div><a class="ig-button" href="../wolfenstein-3d-models/index.html">Wolfenstein 3D benchmark</a></div><header class="hero"><div class="ig-kicker">Временный редакционный benchmark</div><h1 class="ig-page-title ig-display">5 игр × 15 AI-моделей</h1><p>Реальные тексты после source assembly Игропоиска: короткое описание страницы и полный обзор. Для каждой игры модели получают один и тот же frozen evidence pack.</p><div class="chips"><span class="ig-chip">Mafia</span><span class="ig-chip">The Haunted Mansion</span><span class="ig-chip">Far Cry</span><span class="ig-chip">Jack Orlando</span><span class="ig-chip">Mass Effect</span><span class="ig-chip">noindex</span></div></header><section class="grid">${gameCards}</section>`;
fs.writeFileSync(path.join(outRoot,'index.html'),shell('5 игр × 15 AI-моделей',body,0));
fs.writeFileSync(path.join(outRoot,'styles.css'),`.wrap{max-width:1280px;margin:0 auto;padding:42px 24px 88px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:28px}.hero{padding:28px 0 34px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:14px;margin:30px 0}.bench-card{padding:20px;display:flex;flex-direction:column;min-height:245px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:15px 0}.metric{padding:9px}.metric span{display:block}.excerpt{flex:1}.section{padding:35px 0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.compare-pane{padding:18px}.compare select{width:100%;margin-bottom:14px}.frame{width:100%;height:760px;border:0}.bench-article-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:36px;margin-top:32px}.article{max-width:830px}.sidebar{position:sticky;top:18px;height:max-content}.sidebar .row{display:flex;justify-content:space-between;gap:12px;padding:8px 0}.copy-block{padding:22px;margin-bottom:32px}.short-copy{font-size:1.18rem}.review-copy h2,.review-copy h3,.review-copy h4{margin-top:34px}.bench-error{color:#d86b6b}@media(max-width:900px){.compare,.bench-article-layout{grid-template-columns:1fr}.sidebar{position:static}.frame{height:600px}}\n`);
console.log(`Built ${games.length} games into ${outRoot}`);
