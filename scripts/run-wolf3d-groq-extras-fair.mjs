import fs from 'node:fs';import path from 'node:path';
const dir=path.join(process.cwd(),'benchmarks/wolfenstein-3d-1992'),source=JSON.parse(fs.readFileSync(path.join(dir,'source-pack.json'),'utf8')),key=process.env.GROQ_API_KEY||'';if(!key)throw new Error('GROQ_API_KEY missing');
const models=[{id:'qwen3-6-27b',label:'Qwen 3.6 27B',model:'qwen/qwen3.6-27b'},{id:'gpt-oss-20b',label:'GPT-OSS 20B',model:'openai/gpt-oss-20b'}];
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
const wc=s=>(String(s||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parse(x){const d=String(x).match(/<<<DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i),r=String(x).match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);return{description:(d?.[1]||'').trim(),review:(r?.[1]||'').trim(),format_ok:Boolean(d&&r)}}
function md(s){let h='',p=[];const f=()=>{if(p.length){h+=`<p>${esc(p.join(' '))}</p>`;p=[]}};for(const x of String(s||'').split(/\r?\n/)){const l=x.trim();if(!l){f();continue}const m=l.match(/^(#{1,4})\s+(.+)$/);if(m){f();const n=Math.min(4,m[1].length+1);h+=`<h${n}>${esc(m[2])}</h${n}>`}else p.push(l)}f();return h}
function page(r){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(r.label)} — Wolfenstein 3D</title><style>body{margin:0;background:#0a0b10;color:#f4f6fb;font:16px/1.65 Inter,system-ui,sans-serif}.w{max-width:940px;margin:auto;padding:42px 24px 80px}.e,a{color:#b7ff3c}h1{font-size:48px;line-height:1}h2{font-size:30px;margin-top:44px}h3{font-size:22px;margin-top:30px}p{color:#e2e5ed}.m{color:#9aa0b2}.bad{color:#ff8f8f}</style></head><body><main class="w"><div class="e">Игропоиск · временный benchmark</div><h1>${esc(r.label)}</h1><div class="m">${esc(r.model)} · Groq Free · exact shared prompt · ${esc(r.status)} · ${r.elapsed_ms} ms · ${r.description_words}/${r.review_words} слов</div>${r.status==='ok'?`<h2>Описание игры</h2>${md(r.description)}<h2>Обзор</h2>${md(r.review)}`:`<h2 class="bad">Нет результата</h2><p>${esc(r.error)}</p>`}<p><a href="../source-pack.json">Source pack</a></p></main></body></html>`}
async function call(d){let last;for(let i=0;i<3;i++){try{const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:d.model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_completion_tokens:6500,temperature:.72,top_p:.9,reasoning_effort:d.model.includes('qwen')?'none':'low',reasoning_format:'hidden'})}),t=await res.text();if(!res.ok){const e=new Error(`${res.status}: ${t.slice(0,1000)}`);e.status=res.status;throw e}const j=JSON.parse(t),c=j?.choices?.[0]?.message?.content;if(!String(c||'').trim())throw new Error('empty output');return{raw:String(c),usage:j.usage||null}}catch(e){last=e;if(![429,500,502,503,504].includes(Number(e.status))||i===2)break;await new Promise(r=>setTimeout(r,2500*(i+1)))}}throw last}
fs.mkdirSync(path.join(dir,'models'),{recursive:true});const results=[];for(const d of models){const t=Date.now();let r={...d,status:'error',description:'',review:'',description_words:0,review_words:0,error:null};try{const a=await call(d),p=parse(a.raw);r={...r,...p,status:p.description&&p.review?'ok':'partial',description_words:wc(p.description),review_words:wc(p.review),usage:a.usage};if(r.status!=='ok')r.error='required sections missing'}catch(e){r.error=String(e?.message||e).slice(0,2000)}r.elapsed_ms=Date.now()-t;results.push(r);fs.writeFileSync(path.join(dir,'models',`${r.id}.html`),page(r));fs.writeFileSync(path.join(dir,'models',`${r.id}.txt`),`MODEL: ${r.label}\nSTATUS: ${r.status}\n\n=== DESCRIPTION ===\n${r.description}\n\n=== REVIEW ===\n${r.review}\n\nERROR: ${r.error||''}\n`);console.log(r.label,r.status,r.description_words,r.review_words)}fs.writeFileSync(path.join(dir,'groq-extra-results-fair.json'),JSON.stringify({generated_at:new Date().toISOString(),prompt_contract:'exact_shared_v1',models:results},null,2)+'\n');
