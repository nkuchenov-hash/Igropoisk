import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),src=JSON.parse(fs.readFileSync('benchmarks/wolfenstein-3d-1992/source-pack.json','utf8'));
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
${JSON.stringify(src,null,2)}`;
const t=Date.now();let result={id:'qwen2-5-3b-local',label:'Qwen 2.5 3B Local',provider:'ollama',model:'qwen2.5:3b',status:'error',description:'',review:'',description_words:0,review_words:0,error:null};try{const c=new AbortController(),timer=setTimeout(()=>c.abort(),420000);const res=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({model:'qwen2.5:3b',stream:false,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],options:{temperature:.72,top_p:.9,num_ctx:8192,num_predict:6500}})});clearTimeout(timer);const j=await res.json();if(!res.ok)throw new Error(`${res.status}: ${JSON.stringify(j).slice(0,1000)}`);const raw=String(j?.message?.content||j?.response||''),d=raw.match(/<<<DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i),r=raw.match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);result.description=(d?.[1]||'').trim();result.review=(r?.[1]||'').trim();result.status=result.description&&result.review?'ok':'partial';result.error=result.status==='ok'?null:'required sections missing';result.usage={prompt_eval_count:j.prompt_eval_count,eval_count:j.eval_count}}catch(e){result.error=String(e?.message||e).slice(0,2000)}const wc=s=>(String(s||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;result.description_words=wc(result.description);result.review_words=wc(result.review);result.elapsed_ms=Date.now()-t;const out='benchmark-local';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,'qwen2-5-3b-local.txt'),`MODEL: ${result.label}\nSTATUS: ${result.status}\nDESCRIPTION WORDS: ${result.description_words}\nREVIEW WORDS: ${result.review_words}\n\n=== DESCRIPTION ===\n${result.description}\n\n=== REVIEW ===\n${result.review}\n\nERROR: ${result.error||''}\n`);console.log(JSON.stringify(result,null,2));
