import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const artifactRoot = process.env.WOLF3D_ARTIFACT_ROOT || '/tmp/wolf3d-artifacts';
const outRoot = process.env.WOLF3D_PUBLIC_OUT || '/tmp/wolf3d-final/benchmark/wolfenstein-3d-models';
const sourcePack = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/wolfenstein-3d-1992/source-pack.json'), 'utf8'));

const ORDER = [
  'gigachat-3-ultra','gemini-3-8-flash','gemini-3-7-flash','qwen3-8-27b','qwen3-6-27b',
  'gpt-oss-120b','gpt-oss-20b','glm-5-2-free','nemotron-3-ultra-free','nemotron-3-super-free',
  'minimax-m2-7-free','minimax-m3-free','dots3-note-free','gemma-4-31b-free','gemma-4-26b-a4b-free',
  'qwen2-5-3b-local'
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wc = s => (String(s || '').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) || []).length;

function findFiles(dir, name) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...findFiles(p, name));
    else if (ent.name === name) out.push(p);
  }
  return out;
}
function firstSiblingTxt(resultPath, id) {
  const dir = path.dirname(resultPath);
  const direct = path.join(dir, `${id}.txt`);
  if (fs.existsSync(direct)) return direct;
  const candidates = fs.readdirSync(dir).filter(x => x.endsWith('.txt')).map(x => path.join(dir,x));
  return candidates[0] || null;
}
function recoverMalformedSections(txtPath) {
  if (!txtPath || !fs.existsSync(txtPath)) return null;
  const text = fs.readFileSync(txtPath,'utf8');
  const m = text.match(/=== DESCRIPTION ===\n([\s\S]*?)\n\n=== REVIEW ===/);
  if (!m) return null;
  const body = m[1].trim();
  const marker = body.match(/<<<REVIEW>+/i);
  if (!marker || marker.index == null) return null;
  let description = body.slice(0, marker.index).trim().replace(/\s*<<<END_DESCRIPTION>>>\s*$/i,'').trim();
  let review = body.slice(marker.index + marker[0].length).trim().replace(/\s*<<<END_REVIEW>>>\s*$/i,'').trim();
  return description && review ? {description,review} : null;
}
function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r/g,'').split('\n');
  let html = '', para = [];
  const flush = () => { if (para.length) { html += `<p>${esc(para.join(' ').trim())}</p>`; para=[]; } };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    const h = t.match(/^(#{1,4})\s+(.+)$/);
    if (h) { flush(); const n=Math.min(4,h[1].length+1); html += `<h${n}>${esc(h[2])}</h${n}>`; }
    else para.push(t);
  }
  flush(); return html;
}

const results = new Map();
for (const p of findFiles(artifactRoot,'result.json')) {
  try {
    const r = JSON.parse(fs.readFileSync(p,'utf8'));
    if (r?.id && ORDER.includes(r.id)) {
      // If duplicate exists, prefer the result from the parallel all-remote or local baseline artifact.
      if (!results.has(r.id) || p.includes('parallel') || p.includes('local')) results.set(r.id,{...r,__resultPath:p});
    }
  } catch {}
}

for (const id of ['gigachat-3-ultra','nemotron-3-ultra-free']) {
  const r = results.get(id);
  if (!r) continue;
  if ((!r.review || r.status !== 'ok') && r.description) {
    const recovered = recoverMalformedSections(firstSiblingTxt(r.__resultPath,id));
    if (recovered) {
      r.description = recovered.description;
      r.review = recovered.review;
      r.description_words = wc(r.description);
      r.review_words = wc(r.review);
      r.status = 'ok';
      r.error = null;
      r.format_recovered = true;
      r.format_note = 'Модель написала обе секции, но нарушила технический маркер. Граница восстановлена автоматически; сам текст не редактировался.';
    }
  }
}

for (const id of ORDER) {
  if (!results.has(id)) results.set(id,{id,label:id,provider:'unknown',model:'unknown',status:'unavailable',description:'',review:'',description_words:0,review_words:0,error:'Artifact/result missing.'});
  const r=results.get(id);
  r.description_words = Number(r.description_words || wc(r.description));
  r.review_words = Number(r.review_words || wc(r.review));
  r.description_target_ok = r.description_words >= 300 && r.description_words <= 450;
  r.review_target_ok = r.review_words >= 1300 && r.review_words <= 1800;
}

fs.rmSync(path.dirname(outRoot),{recursive:true,force:true});
fs.mkdirSync(path.join(outRoot,'models'),{recursive:true});

const CSS = `:root{color-scheme:dark;--bg:#090b10;--panel:#11141d;--line:#292e3c;--text:#f3f5fa;--muted:#9da5b7;--accent:#c7ff43;--bad:#ff8d8d;--warn:#ffd479}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 82% 0,#2a1f42 0,transparent 34%),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.64}.wrap{max-width:1280px;margin:auto;padding:42px 24px 88px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:28px}.brand{font-weight:900;letter-spacing:-.03em}.brand b{color:var(--accent)}a{color:inherit}.hero{padding:28px 0 34px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-weight:900}.hero h1{font-size:clamp(38px,7vw,78px);line-height:.97;letter-spacing:-.055em;margin:10px 0 18px;max-width:1100px}.hero p{max-width:900px;color:#cbd0dc;font-size:18px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.chip{font-size:12px;padding:6px 10px;border:1px solid var(--line);background:#10131b;border-radius:999px;color:#cbd1df}.ok{color:var(--accent)}.bad{color:var(--bad)}.warn{color:var(--warn)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:14px;margin:30px 0}.card{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,#151925,#0f1219);padding:20px;display:flex;flex-direction:column;min-height:270px}.card h2{font-size:21px;line-height:1.15;margin:7px 0}.meta{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:15px 0}.metric{border:1px solid #242937;border-radius:10px;background:#0d1017;padding:9px}.metric b{display:block;font-size:17px}.metric span{font-size:11px;color:var(--muted)}.excerpt{font-size:14px;color:#c9ceda;flex:1}.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;font-weight:850;background:var(--accent);color:#0b0d10;border-radius:10px;padding:9px 13px;margin-top:12px}.btn.secondary{background:#222737;color:#eef0f6}.section{padding:35px 0;border-top:1px solid var(--line)}.section h2{font-size:32px;letter-spacing:-.03em;margin:0 0 10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.compare-pane{background:#0f1219;border:1px solid var(--line);border-radius:16px;padding:18px}.compare select{width:100%;background:#171b26;color:#fff;border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:14px}.frame{width:100%;height:760px;border:1px solid var(--line);border-radius:12px;background:#090b10}.article-shell{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:36px;margin-top:32px}.article{max-width:830px}.article h2{font-size:30px;margin-top:44px}.article h3{font-size:23px;margin-top:32px}.article p{font-size:17px;color:#e2e5ed}.sidebar{position:sticky;top:18px;height:max-content;background:#0f1219;border:1px solid var(--line);border-radius:16px;padding:18px}.sidebar .row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #242937;padding:8px 0;font-size:13px}.sidebar .row span:first-child{color:var(--muted)}.nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.nav a{text-decoration:none;font-size:12px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;color:#d5d9e5}.notice{padding:14px 16px;border:1px solid #4f4531;background:#19160f;border-radius:12px;color:#f3dfb7;margin:20px 0}.errorbox{border:1px solid #4f2929;background:#190e10;padding:18px;border-radius:14px}.small{font-size:12px;color:var(--muted)}.source-list{display:grid;gap:8px}.source-list a{color:#d9d1ff}@media(max-width:900px){.compare,.article-shell{grid-template-columns:1fr}.sidebar{position:static}.frame{height:600px}}`;
fs.writeFileSync(path.join(outRoot,'styles.css'),CSS);

const sourceFacts = sourcePack.facts || [];
const sourceLinks = sourcePack.sources || [];
fs.writeFileSync(path.join(outRoot,'source-pack.html'),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wolfenstein 3D — единый source pack</title><link rel="stylesheet" href="styles.css"></head><body><main class="wrap"><div class="topbar"><div class="brand">ИГРО<b>ПОИСК</b></div><a class="btn secondary" href="index.html">← К сравнению</a></div><header class="hero"><div class="eyebrow">Benchmark source pack</div><h1>Один вход для всех моделей</h1><p>Все модели получили одинаковый набор фактов и одинаковое редакционное задание. Описание: 300–450 слов. Обзор: 1300–1800 слов. Чужие тексты моделям не передавались.</p></header><section class="section"><h2>Фактическая база</h2><ul>${sourceFacts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="section"><h2>Источники корпуса</h2><ul class="source-list">${sourceLinks.map(x=>`<li><a href="${esc(x.url)}" rel="noreferrer">${esc(x.title)}</a></li>`).join('')}</ul></section></main></body></html>`);

const nav = ORDER.map(id=>`<a href="${id}.html">${esc(results.get(id).label)}</a>`).join('');
for (const id of ORDER) {
  const r=results.get(id);
  const good=r.status==='ok' && r.description && r.review;
  const note=r.format_recovered?`<div class="notice">${esc(r.format_note)}</div>`:'';
  const body=good?`${note}<div class="article-shell"><article class="article"><h2>Описание игры</h2>${renderMarkdown(r.description)}<h2>Обзор</h2>${renderMarkdown(r.review)}</article><aside class="sidebar"><b>Результат</b><div class="row"><span>Описание</span><b>${r.description_words} слов</b></div><div class="row"><span>Цель</span><b class="${r.description_target_ok?'ok':'warn'}">300–450</b></div><div class="row"><span>Обзор</span><b>${r.review_words} слов</b></div><div class="row"><span>Цель</span><b class="${r.review_target_ok?'ok':'warn'}">1300–1800</b></div><div class="row"><span>Другие модели правили?</span><b>Нет</b></div><p><a href="../source-pack.html">Единый source pack</a></p></aside></div>`:`<section class="section"><div class="errorbox"><h2>Сравнимый текст не получен</h2><p>${esc(r.error || 'Модель не выполнила обязательный формат ответа.')}</p><p class="small">Результат сохранён как технический провал текущего endpoint/runtime. Другая модель его не заменяла.</p></div></section>`;
  const chips=[`<span class="chip">${esc(r.provider)}</span>`,`<span class="chip">${esc(r.model)}</span>`,`<span class="chip ${good?'ok':'bad'}">${esc(good?'готово':r.status)}</span>`,r.format_recovered?'<span class="chip warn">format deviation recovered</span>':'',Number.isFinite(r.elapsed_ms)?`<span class="chip">${Math.round(r.elapsed_ms/100)/10} сек.</span>`:''].join('');
  fs.writeFileSync(path.join(outRoot,'models',`${id}.html`),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(r.label)} — Wolfenstein 3D benchmark</title><link rel="stylesheet" href="../styles.css"></head><body><main class="wrap"><div class="topbar"><div class="brand">ИГРО<b>ПОИСК</b></div><a class="btn secondary" href="../index.html">← Все модели</a></div><header class="hero"><div class="eyebrow">Wolfenstein 3D (1992) · временный benchmark</div><h1>${esc(r.label)}</h1><p>Одна модель самостоятельно написала и описание игры, и обзор по тому же входному корпусу, что получили остальные.</p><div class="chips">${chips}</div></header><nav class="nav">${nav}</nav>${body}</main></body></html>`);
}

const cards=ORDER.map(id=>{const r=results.get(id),good=r.status==='ok'&&r.description&&r.review,ex=r.description?String(r.description).replace(/\s+/g,' ').slice(0,220)+'…':String(r.error||'Нет сравнимого результата').slice(0,220),fmt=r.format_recovered?'<span class="warn">marker fixed</span>':good?'<span class="ok">OK</span>':'<span class="bad">FAIL</span>';return `<article class="card"><div class="eyebrow">${esc(r.provider)}</div><h2>${esc(r.label)}</h2><div class="meta">${esc(r.model)}</div><div class="metrics"><div class="metric"><b>${r.description_words}</b><span>описание · 300–450</span></div><div class="metric"><b>${r.review_words}</b><span>обзор · 1300–1800</span></div></div><div class="meta">Формат: ${fmt}</div><p class="excerpt">${esc(ex)}</p><a class="btn" href="models/${id}.html">Открыть результат</a></article>`}).join('');
const opts=ORDER.map(id=>{const r=results.get(id);return `<option value="models/${id}.html">${esc(r.label)}${r.status==='ok'?'':` — ${esc(r.status)}`}</option>`}).join('');
fs.writeFileSync(path.join(outRoot,'index.html'),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wolfenstein 3D — сравнение AI-моделей | Игропоиск</title><link rel="stylesheet" href="styles.css"></head><body><main class="wrap"><div class="topbar"><div class="brand">ИГРО<b>ПОИСК</b></div><a class="btn secondary" href="source-pack.html">Единый source pack</a></div><header class="hero"><div class="eyebrow">Временный редакционный benchmark</div><h1>Wolfenstein 3D (1992): 16 моделей</h1><p>Один source pack, одно задание. Каждая модель самостоятельно пишет описание и полный обзор. Никакого cross-model rewriting.</p><div class="chips"><span class="chip">16 моделей</span><span class="chip">единый prompt</span><span class="chip">noindex</span><span class="chip">сырые тексты</span></div></header><section class="grid">${cards}</section><section class="section"><div class="eyebrow">Side-by-side</div><h2>Сравнить две модели рядом</h2><div class="compare"><div class="compare-pane"><select id="left">${opts}</select><iframe class="frame" id="leftFrame" loading="lazy"></iframe></div><div class="compare-pane"><select id="right">${opts}</select><iframe class="frame" id="rightFrame" loading="lazy"></iframe></div></div></section><section class="section"><h2>Как читать результат</h2><p>Зелёный status означает только наличие обеих секций, а не высокое качество. GigaChat 3 Ultra и Nemotron 3 Ultra написали обе секции, но ошиблись в техническом маркере; граница восстановлена автоматически без редактирования текста. Ошибки 429/503 показаны как есть.</p></section></main><script>const l=document.getElementById('left'),r=document.getElementById('right'),lf=document.getElementById('leftFrame'),rf=document.getElementById('rightFrame');l.value='models/glm-5-2-free.html';r.value='models/gigachat-3-ultra.html';function go(){lf.src=l.value;rf.src=r.value}l.onchange=go;r.onchange=go;go();</script></body></html>`);

const summary=ORDER.map(id=>{const r=results.get(id);return `${r.label}: ${r.status}; description=${r.description_words}; review=${r.review_words}${r.format_recovered?' [marker recovered]':''}`}).join('\n');
fs.writeFileSync(path.join(outRoot,'SUMMARY.txt'),summary+'\n');
console.log(summary);
console.log(`PUBLIC_OUT=${outRoot}`);
