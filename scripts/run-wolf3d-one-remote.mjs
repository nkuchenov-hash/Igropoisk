import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const dir=path.join(root,'benchmarks/wolfenstein-3d-1992');
const source=JSON.parse(fs.readFileSync(path.join(dir,'source-pack.json'),'utf8'));
const provider=String(process.env.BENCH_PROVIDER||'').trim();
const model=String(process.env.BENCH_MODEL||'').trim();
const id=String(process.env.BENCH_ID||'').trim();
const label=String(process.env.BENCH_LABEL||model).trim();
if(!provider||!model||!id)throw new Error('BENCH_PROVIDER/BENCH_MODEL/BENCH_ID are required');

const SYSTEM=`Ты — выпускающий редактор Игропоиска. Пиши по-русски как сильный живой игровой автор, а не как рекламный текст и не как нейросеть.

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

const PROMPT=`Сделай ДВА законченных редакционных материала об Wolfenstein 3D (оригинал 1992 года) из одного и того же материала ниже.

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
${JSON.stringify(source,null,2)}`;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const first=(...names)=>names.map(n=>process.env[n]).find(v=>String(v||'').trim())||'';
async function fetchText(url,options={},timeout=210000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...options,signal:c.signal}),text=await r.text();if(!r.ok){const e=new Error(`${r.status}: ${text.slice(0,1400)}`);e.status=r.status;e.headers=Object.fromEntries(r.headers.entries());throw e}return{text,headers:Object.fromEntries(r.headers.entries())}}finally{clearTimeout(t)}}
async function retry(fn,n=3){let last;for(let i=0;i<n;i++){try{return await fn()}catch(e){last=e;const tr=[408,409,425,429,500,502,503,504].includes(Number(e.status))||e?.name==='AbortError'||/fetch failed|timeout|ECONNRESET|socket/i.test(String(e.message||''));if(!tr||i===n-1)break;const ra=Number(e.headers?.['retry-after']||0);await sleep(Math.max(ra*1000,2500*(i+1)))}}throw last}
function content(j){const c=j?.choices?.[0]?.message?.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.map(x=>typeof x==='string'?x:(x?.text||'')).join('\n');return j?.output_text||''}

async function openrouter(){const key=first('OPENROUTER_API_KEY','OPEN_ROUTER_API_KEY');if(!key)throw Object.assign(new Error('OPENROUTER_API_KEY missing'),{code:'missing_secret'});const {text}=await retry(()=>fetchText('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://nkuchenov-hash.github.io/Igropoisk/','X-Title':'Igropoisk Wolf3D model benchmark'},body:JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_tokens:6500,temperature:.72,top_p:.9,reasoning:{effort:'low',exclude:true}})}));const j=JSON.parse(text),out=content(j);if(!String(out).trim())throw new Error('empty model output');return{raw:out,usage:j.usage||null}}
async function groq(){const key=first('GROQ_API_KEY');if(!key)throw Object.assign(new Error('GROQ_API_KEY missing'),{code:'missing_secret'});const body={model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_completion_tokens:6500,temperature:.72,top_p:.9,reasoning_effort:model.includes('qwen')?'none':'low',reasoning_format:'hidden'};const {text}=await retry(()=>fetchText('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));const j=JSON.parse(text),out=content(j);if(!String(out).trim())throw new Error('empty model output');return{raw:out,usage:j.usage||null}}
async function gemini(){const key=first('GEMINI_API_KEY','GOOGLE_AI_API_KEY','GOOGLE_GEMINI_API_KEY');if(!key)throw Object.assign(new Error('GEMINI_API_KEY missing'),{code:'missing_secret'});const body={systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:6500,temperature:.72,topP:.9}};const {text}=await retry(()=>fetchText(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)}));const j=JSON.parse(text),out=(j?.candidates?.[0]?.content?.parts||[]).map(x=>x?.text||'').join('\n');if(!String(out).trim())throw new Error(`empty Gemini output: ${text.slice(0,900)}`);return{raw:out,usage:j.usageMetadata||null}}
function curlJson(args){return JSON.parse(execFileSync('curl',args,{encoding:'utf8',maxBuffer:24*1024*1024,timeout:240000}))}
async function gigachat(){const credential=first('GIGACHAT_AUTH_KEY','GIGACHAT_CREDENTIALS','GIGACHAT_API_KEY','GIGACHAT_AUTHORIZATION_KEY','GIGACHAT_KEY');if(!credential)throw Object.assign(new Error('GigaChat authorization secret missing'),{code:'missing_secret'});const auth=/^Basic\s+/i.test(credential)?credential:`Basic ${credential}`,rq=crypto.randomUUID();const tok=curlJson(['-skL','-X','POST','https://ngw.devices.sberbank.ru:9443/api/v2/oauth','-H','Content-Type: application/x-www-form-urlencoded','-H','Accept: application/json','-H',`RqUID: ${rq}`,'-H',`Authorization: ${auth}`,'--data-urlencode','scope=GIGACHAT_API_PERS']);if(!tok?.access_token)throw new Error(`GigaChat OAuth failed: ${JSON.stringify(tok).slice(0,700)}`);const payload=JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],stream:false,temperature:.72,top_p:.9,max_tokens:6500});const j=curlJson(['-skL','-X','POST','https://api.giga.chat/v1/chat/completions','-H',`Authorization: Bearer ${tok.access_token}`,'-H','Content-Type: application/json','-H','Accept: application/json','--data-binary',payload]);if(j?.error||j?.status)throw new Error(`GigaChat error: ${JSON.stringify(j).slice(0,1200)}`);const out=content(j);if(!String(out).trim())throw new Error(`empty GigaChat output: ${JSON.stringify(j).slice(0,900)}`);return{raw:out,usage:j.usage||null}}

function parse(raw){const x=String(raw||'').trim(),d=x.match(/<<<DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i),r=x.match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);return{description:(d?.[1]||'').trim(),review:(r?.[1]||'').trim(),format_ok:Boolean(d&&r)}}
const wc=s=>(String(s||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function md(s){let h='',p=[];const f=()=>{if(p.length){h+=`<p>${esc(p.join(' '))}</p>`;p=[]}};for(const raw of String(s||'').split(/\r?\n/)){const l=raw.trim();if(!l){f();continue}const m=l.match(/^(#{1,4})\s+(.+)$/);if(m){f();const n=Math.min(4,m[1].length+1);h+=`<h${n}>${esc(m[2])}</h${n}>`}else p.push(l)}f();return h}
function html(r){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(label)} — Wolfenstein 3D benchmark</title><style>body{margin:0;background:#0a0b10;color:#f5f6fa;font:16px/1.65 Inter,system-ui,sans-serif}.w{max-width:950px;margin:auto;padding:42px 24px 80px}.e,a{color:#b7ff3c}h1{font-size:48px;line-height:1;margin:10px 0}h2{font-size:30px;margin-top:44px}h3{font-size:22px;margin-top:30px}p{color:#e1e4ec}.m{color:#9ca2b4}.bad{color:#ff8f8f}</style></head><body><main class="w"><div class="e">Игропоиск · единый Wolfenstein 3D benchmark</div><h1>${esc(label)}</h1><div class="m">${esc(provider)} · ${esc(model)} · ${esc(r.status)} · описание ${r.description_words} слов · обзор ${r.review_words} слов · ${r.elapsed_ms} ms</div>${r.status==='ok'?`<h2>Описание игры</h2>${md(r.description)}<h2>Обзор</h2>${md(r.review)}`:`<h2 class="bad">Модель не дала сравнимый результат</h2><p>${esc(r.error||'unknown error')}</p>`}<p><a href="../source-pack.json">Единый source pack</a></p></main></body></html>`}

const started=Date.now();let result={id,label,provider,model,status:'error',description:'',review:'',format_ok:false,description_words:0,review_words:0,error:null,usage:null,elapsed_ms:0};try{const call=provider==='openrouter'?openrouter:provider==='groq'?groq:provider==='gemini'?gemini:provider==='gigachat'?gigachat:null;if(!call)throw new Error(`unsupported provider ${provider}`);const response=await call(),p=parse(response.raw);result={...result,...p,status:p.description&&p.review?'ok':'partial',description_words:wc(p.description),review_words:wc(p.review),usage:response.usage||null};if(result.status!=='ok')result.error='required DESCRIPTION/REVIEW sections missing'}catch(e){result.status=e?.code==='missing_secret'?'unavailable':'error';result.error=String(e?.message||e).slice(0,3000)}result.elapsed_ms=Date.now()-started;result.completed_at=new Date().toISOString();
const out=path.join(root,'benchmark-one');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,`${id}.html`),html(result));fs.writeFileSync(path.join(out,`${id}.txt`),`MODEL: ${label}\nPROVIDER: ${provider}\nMODEL ID: ${model}\nSTATUS: ${result.status}\nDESCRIPTION WORDS: ${result.description_words}\nREVIEW WORDS: ${result.review_words}\n\n=== DESCRIPTION ===\n${result.description}\n\n=== REVIEW ===\n${result.review}\n\nERROR: ${result.error||''}\n`);console.log(JSON.stringify(result,null,2));
