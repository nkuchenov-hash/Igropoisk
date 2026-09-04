import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'benchmarks/wolfenstein-3d-1992');
const sourcePath = path.join(outDir, 'source-pack.json');
const sourcePack = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const MODELS = [
  {id:'gigachat-3-ultra', label:'GigaChat 3 Ultra', provider:'gigachat', model:'GigaChat-3-Ultra', tier:'Freemium'},
  {id:'gemini-3-8-flash', label:'Gemini 3.8 Flash', provider:'gemini', model:'gemini-3.8-flash', tier:'Free Tier'},
  {id:'gemini-3-7-flash', label:'Gemini 3.7 Flash', provider:'gemini', model:'gemini-3.7-flash', tier:'Free Tier'},
  {id:'qwen3-8-27b', label:'Qwen 3.8 27B', provider:'groq', model:'qwen/qwen3.8-27b', tier:'Groq Free Plan'},
  {id:'gpt-oss-120b', label:'GPT-OSS 120B', provider:'groq', model:'openai/gpt-oss-120b', tier:'Groq Free Plan'},
  {id:'glm-5-2-free', label:'GLM 5.2 Free', provider:'openrouter', model:'z-ai/glm-5.2:free', tier:'OpenRouter Free'},
  {id:'nemotron-3-ultra-free', label:'Nemotron 3 Ultra Free', provider:'openrouter', model:'nvidia/nemotron-3-ultra-550b-a55b:free', tier:'OpenRouter Free'},
  {id:'nemotron-3-super-free', label:'Nemotron 3 Super Free', provider:'openrouter', model:'nvidia/nemotron-3-super-120b-a12b:free', tier:'OpenRouter Free'},
  {id:'minimax-m2-7-free', label:'MiniMax M2.7 Free', provider:'openrouter', model:'minimax/minimax-m2.7:free', tier:'OpenRouter Free'},
  {id:'dots3-note-free', label:'Dots3-Note Preview Free', provider:'openrouter', model:'dots-studio/dots-3-note-preview:free', tier:'OpenRouter Free'},
  {id:'qwen2-5-3b-local', label:'Qwen 2.5 3B Local', provider:'ollama', model:'qwen2.5:3b', tier:'Local baseline'}
];

const EXCLUDED = [
  {label:'Kimi', reason:'Free endpoint unavailable during the current benchmark window.'},
  {label:'Thinking Machines Inkling Free', reason:'Free endpoint terms restrict it to agentic harness use; excluded from this editorial-only comparison.'}
];

const SYSTEM = `Ты — выпускающий редактор Игропоиска. Пиши по-русски как сильный живой игровой автор, а не как рекламный текст и не как нейросеть.

Правила:
- опирайся только на факты и оценочные основания из SOURCE PACK;
- не выдумывай детали, даты, механики, цитаты, оценки или источники;
- не упоминай SOURCE PACK, промпт, модель, ИИ или процесс генерации;
- не объясняй, что текст является сравнительным тестом;
- не делай демографических предположений;
- избегай канцелярита, пустых вводных, повторов, «это не просто X, а Y», «погружает в атмосферу», «по сей день остается» и других шаблонных AI-оборотов;
- историческое значение не должно автоматически означать, что игра хороша сегодня: разделяй влияние и текущую играбельность;
- никакой числовой оценки Игропоиска: рейтинг должен рассчитываться отдельно из профессиональных оценок;
- названия и факты должны оставаться точными.`;

const PROMPT = `Сделай ДВА законченных редакционных материала об Wolfenstein 3D (оригинал 1992 года) из одного и того же материала ниже.

1) DESCRIPTION — описание для страницы игры Игропоиска, примерно 300–450 русских слов. Это не рецензия. Быстро объясни центральную игровую фантазию, что игрок делает, как устроен темп/исследование/стрельба, чем игра исторически важна и какие особенности дизайна нужно понимать современному игроку. Пиши цельным живым текстом, без списка характеристик.

2) REVIEW — полноценный редакционный обзор примерно 1300–1800 русских слов. Нужен собственный заголовок и 5–7 содержательных разделов с естественными подзаголовками. Разбери игру как игру в 2026 году: стрельбу и движение, лабиринты и секреты, темп и обратную связь, повторяемость и ограничения, исторический контекст без музейного восторга, то, что реально работает сейчас, и то, что устарело. Заверши ясным текстовым вердиктом без цифровой оценки.

Очень важно: одну и ту же работу полностью выполняешь ты. Никакой передачи текста другой модели и никакого «исправления» чужого черновика.

Формат ответа строго такой:
<<<DESCRIPTION>>>
[текст]
<<<REVIEW>>>
# [заголовок обзора]
[обзор]
<<<END>>>

SOURCE PACK:
${JSON.stringify(sourcePack, null, 2)}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const envFirst = (...names) => names.map(n => process.env[n]).find(v => String(v || '').trim()) || '';

async function fetchJson(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
    if (!response.ok) {
      const err = new Error(`${response.status} ${response.statusText}: ${text.slice(0,1200)}`);
      err.status = response.status;
      err.headers = Object.fromEntries(response.headers.entries());
      throw err;
    }
    return {data, headers:Object.fromEntries(response.headers.entries())};
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); }
    catch (error) {
      last = error;
      const transient = [408,409,425,429,500,502,503,504].includes(Number(error?.status)) || error?.name === 'AbortError' || /fetch failed|timeout|socket|ECONNRESET/i.test(String(error?.message||''));
      if (!transient || i === attempts - 1) break;
      const retryAfter = Number(error?.headers?.['retry-after'] || 0);
      await sleep(Math.max(retryAfter * 1000, 2500 * (i + 1)));
    }
  }
  throw last;
}

function openAIText(data) {
  const msg = data?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(x => typeof x === 'string' ? x : (x?.text || '')).join('\n');
  if (typeof data?.output_text === 'string') return data.output_text;
  return '';
}

async function callOpenRouter(def) {
  const key = envFirst('OPENROUTER_API_KEY','OPEN_ROUTER_API_KEY');
  if (!key) throw Object.assign(new Error('OPENROUTER_API_KEY is not available to the workflow'), {code:'missing_secret'});
  const payload = {
    model:def.model,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],
    max_tokens:6500,
    temperature:0.72,
    top_p:0.9,
    reasoning:{effort:'low',exclude:true}
  };
  const {data,headers} = await withRetry(() => fetchJson('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${key}`,
      'Content-Type':'application/json',
      'HTTP-Referer':'https://nkuchenov-hash.github.io/Igropoisk/',
      'X-Title':'Igropoisk Wolfenstein 3D editorial benchmark'
    },
    body:JSON.stringify(payload)
  }));
  const text = openAIText(data);
  if (!text.trim()) throw new Error(`OpenRouter returned no text for ${def.model}`);
  return {text,usage:data?.usage||null,headers};
}

async function callGroq(def) {
  const key = envFirst('GROQ_API_KEY');
  if (!key) throw Object.assign(new Error('GROQ_API_KEY is not available to the workflow'), {code:'missing_secret'});
  const payload = {
    model:def.model,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],
    max_completion_tokens:6500,
    temperature:0.72,
    top_p:0.9,
    reasoning_effort:def.model.includes('qwen') ? 'none' : 'low',
    reasoning_format:'hidden'
  };
  const {data,headers} = await withRetry(() => fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  }));
  const text = openAIText(data);
  if (!text.trim()) throw new Error(`Groq returned no text for ${def.model}`);
  return {text,usage:data?.usage||null,headers};
}

async function callGemini(def) {
  const key = envFirst('GEMINI_API_KEY','GOOGLE_AI_API_KEY','GOOGLE_GEMINI_API_KEY');
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not available to the workflow'), {code:'missing_secret'});
  const body = {
    systemInstruction:{parts:[{text:SYSTEM}]},
    contents:[{role:'user',parts:[{text:PROMPT}]}],
    generationConfig:{maxOutputTokens:6500}
  };
  const {data,headers} = await withRetry(() => fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(def.model)}:generateContent`, {
    method:'POST',
    headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  }));
  const text = (data?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('\n');
  if (!text.trim()) throw new Error(`Gemini returned no text for ${def.model}: ${JSON.stringify(data).slice(0,1000)}`);
  return {text,usage:data?.usageMetadata||null,headers};
}

function curlJson(args) {
  const raw = execFileSync('curl', args, {encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});
  return JSON.parse(raw);
}

async function gigachatToken() {
  const credential = envFirst('GIGACHAT_AUTH_KEY','GIGACHAT_CREDENTIALS','GIGACHAT_API_KEY','GIGACHAT_AUTHORIZATION_KEY','GIGACHAT_KEY');
  if (!credential) throw Object.assign(new Error('GigaChat authorization secret is not available to the workflow'), {code:'missing_secret'});
  const auth = /^Basic\s+/i.test(credential) ? credential : `Basic ${credential}`;
  const rq = crypto.randomUUID();
  try {
    const body = new URLSearchParams({scope:'GIGACHAT_API_PERS'}).toString();
    const {data} = await fetchJson('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','RqUID':rq,'Authorization':auth},body
    }, 60000);
    if (data?.access_token) return data.access_token;
  } catch {}
  const data = curlJson(['-skL','-X','POST','https://ngw.devices.sberbank.ru:9443/api/v2/oauth','-H','Content-Type: application/x-www-form-urlencoded','-H','Accept: application/json','-H',`RqUID: ${rq}`,'-H',`Authorization: ${auth}`,'--data-urlencode','scope=GIGACHAT_API_PERS']);
  if (!data?.access_token) throw new Error(`GigaChat OAuth did not return access_token: ${JSON.stringify(data).slice(0,800)}`);
  return data.access_token;
}

async function callGigaChat(def) {
  const token = await gigachatToken();
  const body = {
    model:def.model,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],
    stream:false,
    temperature:0.72,
    top_p:0.9,
    max_tokens:6500
  };
  const {data,headers} = await withRetry(() => fetchJson('https://api.giga.chat/v1/chat/completions', {
    method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)
  }, 240000));
  const text = openAIText(data);
  if (!text.trim()) throw new Error(`GigaChat returned no text for ${def.model}`);
  return {text,usage:data?.usage||null,headers};
}

async function ensureOllama(def) {
  const base = envFirst('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';
  try { await fetchJson(`${base}/api/tags`,{},4000); }
  catch {
    try { execFileSync('ollama',['--version'],{stdio:'ignore',timeout:5000}); }
    catch { throw Object.assign(new Error('Ollama is not installed in this benchmark runner'),{code:'missing_runtime'}); }
    const child = spawn('ollama',['serve'],{detached:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});child.unref();
    for (let i=0;i<20;i++){await sleep(1000);try{await fetchJson(`${base}/api/tags`,{},2500);break}catch{}}
  }
  const tags = (await fetchJson(`${base}/api/tags`,{},8000)).data;
  const names = (tags?.models||[]).map(x=>String(x?.name||x?.model||''));
  if (!names.some(n=>n===def.model || n.startsWith(`${def.model}:`) || def.model.startsWith(`${n}:`))) {
    execFileSync('ollama',['pull',def.model],{stdio:'inherit',timeout:900000,maxBuffer:32*1024*1024});
  }
  return base;
}

async function callOllama(def) {
  const base = await ensureOllama(def);
  const {data} = await fetchJson(`${base}/api/chat`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      model:def.model,stream:false,
      messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],
      options:{temperature:0.72,top_p:0.9,num_ctx:8192,num_predict:6500}
    })
  }, 360000);
  const text = data?.message?.content || data?.response || '';
  if (!String(text).trim()) throw new Error(`Ollama returned no text for ${def.model}`);
  return {text:String(text),usage:{prompt_eval_count:data?.prompt_eval_count,eval_count:data?.eval_count},headers:{}};
}

async function callModel(def) {
  if (def.provider==='openrouter') return callOpenRouter(def);
  if (def.provider==='groq') return callGroq(def);
  if (def.provider==='gemini') return callGemini(def);
  if (def.provider==='gigachat') return callGigaChat(def);
  if (def.provider==='ollama') return callOllama(def);
  throw new Error(`Unknown provider ${def.provider}`);
}

function stripFence(text) {
  return String(text||'').trim().replace(/^```(?:markdown|md|text)?\s*/i,'').replace(/\s*```$/,'').trim();
}
function parseOutput(raw) {
  const text = stripFence(raw);
  const d = text.match(/<<<DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i);
  const r = text.match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);
  return {description:stripFence(d?.[1]||''),review:stripFence(r?.[1]||''),format_ok:Boolean(d&&r)};
}
function wordCount(text){return (String(text||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');}
function markdown(text){
  const lines=String(text||'').replace(/\r/g,'').split('\n');let html='',para=[];
  const flush=()=>{if(para.length){html+=`<p>${inline(para.join(' ').trim())}</p>`;para=[];}};
  for(const line of lines){const t=line.trim();if(!t){flush();continue}const m=t.match(/^(#{1,4})\s+(.+)$/);if(m){flush();const n=Math.min(4,m[1].length+1);html+=`<h${n}>${inline(m[2])}</h${n}>`;}else para.push(t);}flush();return html;
}
function css(){return `:root{color-scheme:dark;--bg:#0a0b10;--panel:#12141c;--muted:#8f95a7;--line:#262a38;--text:#f4f6fb;--accent:#b7ff3c;--purple:#8c6cff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#241b38 0,transparent 35%),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.62}.wrap{max-width:1240px;margin:auto;padding:42px 24px 80px}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero{padding:36px 0 30px;border-bottom:1px solid var(--line)}h1{font-size:clamp(34px,6vw,72px);line-height:.98;margin:10px 0 18px;max-width:1000px}.sub{max-width:850px;color:#c9cddd;font-size:18px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}.chip{border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:#c5cada;background:#11131a;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:28px}.card{background:linear-gradient(180deg,#151822,#101219);border:1px solid var(--line);border-radius:18px;padding:20px;min-height:220px}.card h2{margin:4px 0 8px;font-size:21px}.meta{color:var(--muted);font-size:13px}.ok{color:var(--accent)}.bad{color:#ff8f8f}.excerpt{color:#cdd1de;font-size:14px;margin:14px 0}.btn{display:inline-flex;text-decoration:none;color:#0b0c10;background:var(--accent);font-weight:800;border-radius:10px;padding:9px 13px}.btn.secondary{background:#242838;color:#fff}.article{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:36px;margin-top:34px}.copy{max-width:820px}.copy h2{font-size:30px;margin-top:45px}.copy h3{font-size:22px;margin-top:34px}.copy p{font-size:17px;color:#e5e7ee}.side{position:sticky;top:20px;height:max-content;border:1px solid var(--line);border-radius:16px;padding:18px;background:#101219}.side a{color:#d9dcff}.nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.nav a{color:#d7d9e6;text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:7px 10px;font-size:13px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.compare>section{border:1px solid var(--line);border-radius:14px;padding:20px;background:#101219}.compare select{width:100%;background:#171a24;color:#fff;border:1px solid var(--line);padding:10px;border-radius:8px}.small{font-size:12px;color:var(--muted)}code{background:#202330;padding:2px 5px;border-radius:4px}@media(max-width:850px){.article,.compare{grid-template-columns:1fr}.side{position:static}}`;}

function modelPage(result, all){
  const nav=all.map(x=>`<a href="${esc(x.id)}.html">${esc(x.label)}</a>`).join('');
  const status=result.status==='ok'?`<span class="ok">готово</span>`:`<span class="bad">${esc(result.status)}</span>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(result.label)} — Wolfenstein 3D benchmark</title><style>${css()}</style></head><body><main class="wrap"><a class="btn secondary" href="../index.html">← Все модели</a><header class="hero"><div class="eyebrow">Игропоиск · временный model benchmark</div><h1>${esc(result.label)}</h1><div class="sub">Wolfenstein 3D (1992): одна модель получила тот же source pack и самостоятельно написала описание и обзор.</div><div class="chips"><span class="chip">${esc(result.provider)}</span><span class="chip">${esc(result.model)}</span><span class="chip">${status}</span><span class="chip">${Math.round(result.elapsed_ms/100)/10}s</span><span class="chip">описание ${result.description_words} слов</span><span class="chip">обзор ${result.review_words} слов</span></div></header><nav class="nav">${nav}</nav>${result.status==='ok'?`<div class="article"><article class="copy"><h2>Описание игры</h2>${markdown(result.description)}<h2>Обзор</h2>${markdown(result.review)}</article><aside class="side"><b>Условия</b><p class="small">Одинаковый source pack, одинаковое редакционное задание. Другие модели этот текст не правили.</p><p class="small">Format markers: ${result.format_ok?'OK':'recovered/partial'}.</p><p><a href="../source-pack.json">Открыть source pack</a></p><p><a href="../results.json">Raw results JSON</a></p></aside></div>`:`<section class="card"><h2>Генерация не завершилась</h2><p class="bad">${esc(result.error||'Unknown error')}</p><p>Этот сбой показан как часть теста и не подменяется текстом другой модели.</p></section>`}</main></body></html>`;
}

function indexPage(results){
  const cards=results.map(r=>`<article class="card"><div class="eyebrow">${esc(r.provider)} · ${esc(r.tier)}</div><h2>${esc(r.label)}</h2><div class="meta"><code>${esc(r.model)}</code></div><p>${r.status==='ok'?`<span class="ok">готово</span> · ${Math.round(r.elapsed_ms/100)/10}s · ${r.description_words}/${r.review_words} слов`:`<span class="bad">${esc(r.status)}</span>`}</p><div class="excerpt">${r.status==='ok'?esc(r.description.slice(0,260))+'…':esc(r.error||'Нет результата')}</div><a class="btn" href="models/${esc(r.id)}.html">Смотреть страницу</a></article>`).join('');
  const options=results.filter(r=>r.status==='ok').map(r=>`<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
  const excluded=EXCLUDED.map(x=>`<span class="chip">${esc(x.label)} — ${esc(x.reason)}</span>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wolfenstein 3D — сравнение моделей Игропоиска</title><style>${css()}</style></head><body><main class="wrap"><header class="hero"><div class="eyebrow">Игропоиск · временный model benchmark</div><h1>Wolfenstein 3D (1992)</h1><div class="sub">Один source pack. Одно редакционное задание. Каждая модель самостоятельно пишет и описание игры, и полноценный обзор. Никакой цепочки «одна написала — другая исправила».</div><div class="chips"><span class="chip">${results.length} запусков</span><span class="chip">${results.filter(r=>r.status==='ok').length} готово</span><span class="chip">без цифровой оценки</span><span class="chip">noindex</span></div></header><section class="grid">${cards}</section><section class="hero"><div class="eyebrow">Side-by-side</div><h2>Сравнить два результата</h2><div class="compare"><section><select id="left">${options}</select><div id="leftText"></div></section><section><select id="right">${options}</select><div id="rightText"></div></section></div></section><section class="hero"><div class="eyebrow">Не включены</div><div class="chips">${excluded}</div><p class="small">Source pack: <a href="source-pack.json">source-pack.json</a> · raw: <a href="results.json">results.json</a></p></section></main><script>const data=${JSON.stringify(results.map(r=>({id:r.id,label:r.label,status:r.status,description:r.description,review:r.review})))};function show(sel,target){const r=data.find(x=>x.id===sel.value);target.innerHTML=r?'<h3>'+r.label.replace(/[&<>]/g,'')+'</h3><h4>Описание</h4><p>'+r.description.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/\n+/g,'</p><p>')+'</p><h4>Обзор</h4><p>'+r.review.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/\n+/g,'</p><p>')+'</p>':''}const l=document.getElementById('left'),r=document.getElementById('right');if(r.options.length>1)r.selectedIndex=1;const render=()=>{show(l,document.getElementById('leftText'));show(r,document.getElementById('rightText'))};l.onchange=render;r.onchange=render;render();</script></body></html>`;
}

async function main(){
  fs.mkdirSync(path.join(outDir,'models'),{recursive:true});
  const results=[];
  for(const def of MODELS){
    console.log(`\n=== ${def.label} (${def.provider}/${def.model}) ===`);
    const started=Date.now();
    let result={...def,started_at:new Date(started).toISOString(),status:'error',description:'',review:'',format_ok:false,description_words:0,review_words:0,elapsed_ms:0,usage:null,error:null};
    try{
      const response=await callModel(def);
      const parsed=parseOutput(response.text);
      result={...result,status:parsed.description&&parsed.review?'ok':'partial',...parsed,description_words:wordCount(parsed.description),review_words:wordCount(parsed.review),usage:response.usage||null};
      if(result.status!=='ok') result.error='Model response did not contain both required benchmark sections.';
    }catch(error){
      result.status=error?.code==='missing_secret'||error?.code==='missing_runtime'?'unavailable':'error';
      result.error=String(error?.message||error).slice(0,3000);
      console.error(result.error);
    }
    result.elapsed_ms=Date.now()-started;
    result.completed_at=new Date().toISOString();
    results.push(result);
    fs.writeFileSync(path.join(outDir,'models',`${def.id}.html`),modelPage(result,MODELS),'utf8');
    fs.writeFileSync(path.join(outDir,'models',`${def.id}.txt`),`MODEL: ${def.label}\nPROVIDER: ${def.provider}\nMODEL ID: ${def.model}\nSTATUS: ${result.status}\n\n=== DESCRIPTION ===\n${result.description}\n\n=== REVIEW ===\n${result.review}\n\nERROR: ${result.error||''}\n`,'utf8');
    console.log(JSON.stringify({model:def.label,status:result.status,description_words:result.description_words,review_words:result.review_words,elapsed_ms:result.elapsed_ms}));
    if(def.provider==='openrouter') await sleep(1500);
  }
  const payload={benchmark:sourcePack.benchmark,generated_at:new Date().toISOString(),rules:sourcePack.benchmark_rules,models:results,excluded:EXCLUDED};
  fs.writeFileSync(path.join(outDir,'results.json'),JSON.stringify(payload,null,2)+'\n','utf8');
  fs.writeFileSync(path.join(outDir,'index.html'),indexPage(results),'utf8');
  const summary=results.map(r=>`${r.label}: ${r.status} (${r.description_words}/${r.review_words} words, ${Math.round(r.elapsed_ms/100)/10}s)`).join('\n');
  fs.writeFileSync(path.join(outDir,'SUMMARY.txt'),summary+'\n','utf8');
  console.log('\n'+summary);
  if(!results.some(r=>r.status==='ok')) process.exitCode=2;
}

await main();
