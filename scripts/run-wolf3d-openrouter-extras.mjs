import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const dir=path.join(root,'benchmarks/wolfenstein-3d-1992');
const source=JSON.parse(fs.readFileSync(path.join(dir,'source-pack.json'),'utf8'));
const key=process.env.OPENROUTER_API_KEY||process.env.OPEN_ROUTER_API_KEY||'';
if(!key) throw new Error('OPENROUTER_API_KEY missing');

const models=[
  {id:'minimax-m3-free',label:'MiniMax M3 Free',model:'minimax/minimax-m3:free'},
  {id:'gemma-4-31b-free',label:'Gemma 4 31B Free',model:'google/gemma-4-31b-it:free'},
  {id:'gemma-4-26b-a4b-free',label:'Gemma 4 26B A4B Free',model:'google/gemma-4-26b-a4b-it:free'}
];
const system=`Ты — выпускающий редактор Игропоиска. Пиши по-русски как сильный живой игровой автор, а не как рекламный текст и не как нейросеть.

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
const prompt=`Сделай ДВА законченных редакционных материала об Wolfenstein 3D (оригинал 1992 года) из одного и того же материала ниже.

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
const wc=s=>(String(s||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parse(raw){const d=String(raw).match(/<<<DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i);const r=String(raw).match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);return{description:(d?.[1]||'').trim(),review:(r?.[1]||'').trim(),format_ok:Boolean(d&&r)}}
function md(s){const out=[];let p=[];const flush=()=>{if(p.length){out.push(`<p>${esc(p.join(' '))}</p>`);p=[]}};for(const raw of String(s||'').split(/\r?\n/)){const line=raw.trim();if(!line){flush();continue}const h=line.match(/^(#{1,4})\s+(.+)$/);if(h){flush();out.push(`<h${Math.min(4,h[1].length+1)}>${esc(h[2])}</h${Math.min(4,h[1].length+1)}>`)}else p.push(line)}flush();return out.join('')}
function page(r){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(r.label)} — Wolfenstein 3D</title><style>body{margin:0;background:#0a0b10;color:#f4f6fb;font:16px/1.65 Inter,system-ui,sans-serif}.w{max-width:940px;margin:auto;padding:42px 24px 80px}a{color:#b7ff3c}header{border-bottom:1px solid #292c38;padding-bottom:24px}.e{color:#b7ff3c;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:800}h1{font-size:48px;line-height:1;margin:8px 0}h2{font-size:30px;margin-top:44px}h3{font-size:22px;margin-top:30px}p{color:#e2e5ed}.m{color:#9aa0b2;font-size:13px}.bad{color:#ff8f8f}.pill{display:inline-block;border:1px solid #292c38;border-radius:99px;padding:5px 9px;margin:8px 5px 0 0}</style></head><body><main class="w"><header><div class="e">Игропоиск · временный benchmark</div><h1>${esc(r.label)}</h1><div class="m">${esc(r.model)} · OpenRouter Free · ${esc(r.status)} · ${r.elapsed_ms} ms</div><span class="pill">описание ${r.description_words}</span><span class="pill">обзор ${r.review_words}</span></header>${r.status==='ok'?`<h2>Описание игры</h2>${md(r.description)}<h2>Обзор</h2>${md(r.review)}`:`<h2 class="bad">Нет результата</h2><p>${esc(r.error)}</p>`}<p><a href="../source-pack.json">Source pack</a></p></main></body></html>`}
async function call(model){let last;for(let attempt=0;attempt<3;attempt++){try{const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://nkuchenov-hash.github.io/Igropoisk/','X-Title':'Igropoisk Wolf3D free-model benchmark'},body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:prompt}],max_tokens:6500,temperature:.72,top_p:.9,reasoning:{effort:'low',exclude:true}})});const text=await res.text();if(!res.ok){const e=new Error(`${res.status}: ${text.slice(0,1000)}`);e.status=res.status;throw e}const j=JSON.parse(text);const c=j?.choices?.[0]?.message?.content;const out=typeof c==='string'?c:Array.isArray(c)?c.map(x=>x?.text||'').join('\n'):'';if(!out.trim())throw new Error('empty model output');return{raw:out,usage:j.usage||null}}catch(e){last=e;if(![429,500,502,503,504].includes(Number(e.status))||attempt===2)break;await sleep(2500*(attempt+1))}}throw last}
fs.mkdirSync(path.join(dir,'models'),{recursive:true});const results=[];
for(const def of models){const t=Date.now();let r={...def,provider:'openrouter',tier:'OpenRouter Free',status:'error',description:'',review:'',description_words:0,review_words:0,elapsed_ms:0,error:null};try{const a=await call(def.model);const p=parse(a.raw);r={...r,...p,status:p.description&&p.review?'ok':'partial',description_words:wc(p.description),review_words:wc(p.review),usage:a.usage};if(r.status!=='ok')r.error='required sections missing'}catch(e){r.error=String(e?.message||e).slice(0,2500)}r.elapsed_ms=Date.now()-t;results.push(r);fs.writeFileSync(path.join(dir,'models',`${r.id}.html`),page(r));fs.writeFileSync(path.join(dir,'models',`${r.id}.txt`),`MODEL: ${r.label}\nSTATUS: ${r.status}\n\n=== DESCRIPTION ===\n${r.description}\n\n=== REVIEW ===\n${r.review}\n\nERROR: ${r.error||''}\n`);console.log(r.label,r.status,r.description_words,r.review_words);await sleep(1500)}
fs.writeFileSync(path.join(dir,'extra-results.json'),JSON.stringify({generated_at:new Date().toISOString(),models:results},null,2)+'\n');
