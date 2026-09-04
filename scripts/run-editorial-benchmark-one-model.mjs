#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.env.BENCH_GAME||'').trim();
const provider=String(process.env.BENCH_PROVIDER||'').trim();
const model=String(process.env.BENCH_MODEL||'').trim();
const id=String(process.env.BENCH_ID||'').trim();
const label=String(process.env.BENCH_LABEL||model).trim();
if(!slug||!provider||!model||!id)throw new Error('BENCH_GAME/BENCH_PROVIDER/BENCH_MODEL/BENCH_ID required');
const pack=JSON.parse(fs.readFileSync(path.join(root,'benchmark-packs',slug,'pack.json'),'utf8'));
const title=pack.game?.display_title||pack.game?.identity_title||slug;

const SYSTEM=`Ты — автор и редактор Игропоиска. Пиши естественным современным русским языком: конкретно, уверенно, без рекламного пафоса и без демонстративной «литературности».

КРИТИЧЕСКИЕ ПРАВИЛА:
- FROZEN ASSEMBLY PACK ниже — единственный источник фактов. Не используй знания из памяти, даже если уверен в них.
- Если факта, механики, оружия, персонажа, места, даты или оценки нет в пакете — не добавляй его.
- Не смешивай оригинальную игру с ремейками, ремастерами, сиквелами, портами или экранизациями из excluded_versions.
- Audience Profile — только внутренний стилистический сигнал. Никогда не упоминай его и не делай демографических выводов.
- Не упоминай источники, модель, ИИ, промпт, benchmark или процесс сбора.
- Не ставь цифровую оценку Игропоиска.
- Избегай нейросетевых клише, нарочитых метафор, театрального пафоса, канцелярита и повторения одной мысли разными словами.
- Не пытайся «писать эффектно» ценой точности. Живой редакционный голос важнее украшательства.
- Не копируй длинные фразы источников; синтезируй материал своими словами.`;

const PROMPT=`Игра: ${title} (${pack.game?.year||''}).

Это имитация реального шага Игропоиска ПОСЛЕ обычной сборки страницы: ниже заморожен материал, который собрал модуль. Сделай два независимых редакционных выхода той же игры.

1) SHORT_DESCRIPTION — реальный короткий текст основной страницы игры.
Требования:
- ровно 2 законченных русских предложения;
- от 100 до 240 символов ВКЛЮЧАЯ пробелы;
- сразу объясняет центральную идею игры и что делает игрок;
- это НЕ мини-рецензия, без вердикта и без исторического эссе;
- никакого списка жанров через запятую.

2) REVIEW — полноценный обзор Игропоиска.
Требования:
- примерно 2000–2600 содержательных русских слов;
- собственный небанальный заголовок;
- 8–10 естественных разделов, структура должна вытекать из конкретной игры, а не из универсального шаблона;
- объясни игровой цикл, управление/взаимодействие, структуру мира или миссий, прогрессию, сильные стороны и реальные проблемы;
- для старой игры отдельно оцени, что работает сейчас и что состарилось, но не превращай текст в музейную справку;
- различай факты и редакционную интерпретацию;
- не раскрывай крупные сюжетные повороты;
- финал — ясный текстовый вердикт: кому и зачем игра может быть интересна сегодня, без цифры.

Формат ответа СТРОГО:
<<<SHORT_DESCRIPTION>>>
[2 предложения]
<<<REVIEW>>>
# [заголовок]
[обзор]
<<<END>>>

FROZEN ASSEMBLY PACK:
${JSON.stringify(pack,null,2)}`;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const first=(...names)=>names.map(n=>process.env[n]).find(v=>String(v||'').trim())||'';
async function fetchText(url,options={},timeout=300000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...options,signal:c.signal}),text=await r.text();if(!r.ok){const e=new Error(`${r.status}: ${text.slice(0,1800)}`);e.status=r.status;e.headers=Object.fromEntries(r.headers.entries());throw e}return{text,headers:Object.fromEntries(r.headers.entries())}}finally{clearTimeout(timer)}}
async function retry(fn,n=3){let last;for(let i=0;i<n;i++){try{return await fn()}catch(e){last=e;const transient=[408,409,425,429,500,502,503,504].includes(Number(e.status))||e?.name==='AbortError'||/fetch failed|timeout|ECONNRESET|socket/i.test(String(e.message||''));if(!transient||i===n-1)break;const ra=Number(e.headers?.['retry-after']||0);await sleep(Math.max(ra*1000,4000*(i+1)))}}throw last}
function openAIContent(j){const c=j?.choices?.[0]?.message?.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.map(x=>typeof x==='string'?x:(x?.text||'')).join('\n');return j?.output_text||''}

async function openrouter(){const key=first('OPENROUTER_API_KEY','OPEN_ROUTER_API_KEY');if(!key)throw Object.assign(new Error('OPENROUTER_API_KEY missing'),{code:'missing_secret'});const {text}=await retry(()=>fetchText('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://nkuchenov-hash.github.io/Igropoisk/','X-Title':'Igropoisk five-game editorial benchmark'},body:JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_tokens:7000,temperature:.62,top_p:.9,reasoning:{effort:'low',exclude:true}})}));const j=JSON.parse(text),out=openAIContent(j);if(!String(out).trim())throw new Error('empty OpenRouter output');return{raw:out,usage:j.usage||null}}
async function groq(){const key=first('GROQ_API_KEY');if(!key)throw Object.assign(new Error('GROQ_API_KEY missing'),{code:'missing_secret'});const body={model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_completion_tokens:7000,temperature:.62,top_p:.9,reasoning_effort:model.includes('qwen')?'none':'low',reasoning_format:'hidden'};const {text}=await retry(()=>fetchText('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));const j=JSON.parse(text),out=openAIContent(j);if(!String(out).trim())throw new Error('empty Groq output');return{raw:out,usage:j.usage||null}}
async function gemini(){const key=first('GEMINI_API_KEY','GOOGLE_AI_API_KEY','GOOGLE_GEMINI_API_KEY');if(!key)throw Object.assign(new Error('GEMINI_API_KEY missing'),{code:'missing_secret'});const body={systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:7000,temperature:.62,topP:.9}};const {text}=await retry(()=>fetchText(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)}));const j=JSON.parse(text),out=(j?.candidates?.[0]?.content?.parts||[]).map(x=>x?.text||'').join('\n');if(!String(out).trim())throw new Error(`empty Gemini output: ${text.slice(0,900)}`);return{raw:out,usage:j.usageMetadata||null}}
function curlJson(args){return JSON.parse(execFileSync('curl',args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:300000}))}
async function gigachat(){const credential=first('GIGACHAT_AUTH_KEY','GIGACHAT_CREDENTIALS','GIGACHAT_API_KEY','GIGACHAT_AUTHORIZATION_KEY','GIGACHAT_KEY');if(!credential)throw Object.assign(new Error('GigaChat authorization secret missing'),{code:'missing_secret'});const auth=/^Basic\s+/i.test(credential)?credential:`Basic ${credential}`,rq=crypto.randomUUID();const tok=curlJson(['-skL','-X','POST','https://ngw.devices.sberbank.ru:9443/api/v2/oauth','-H','Content-Type: application/x-www-form-urlencoded','-H','Accept: application/json','-H',`RqUID: ${rq}`,'-H',`Authorization: ${auth}`,'--data-urlencode','scope=GIGACHAT_API_PERS']);if(!tok?.access_token)throw new Error(`GigaChat OAuth failed: ${JSON.stringify(tok).slice(0,700)}`);const payload=JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],stream:false,temperature:.62,top_p:.9,max_tokens:7000});const j=curlJson(['-skL','-X','POST','https://api.giga.chat/v1/chat/completions','-H',`Authorization: Bearer ${tok.access_token}`,'-H','Content-Type: application/json','-H','Accept: application/json','--data-binary',payload]);if(j?.error||j?.status)throw new Error(`GigaChat error: ${JSON.stringify(j).slice(0,1200)}`);const out=openAIContent(j);if(!String(out).trim())throw new Error('empty GigaChat output');return{raw:out,usage:j.usage||null}}

function parse(raw){const x=String(raw||'').trim();const s=x.match(/<<<SHORT_DESCRIPTION>>>\s*([\s\S]*?)(?=<<<REVIEW>>>|$)/i),r=x.match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i);return{short_description:(s?.[1]||'').trim(),review:(r?.[1]||'').trim(),format_ok:Boolean(s&&r)}}
const wordCount=s=>(String(s||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;
const sentenceCount=s=>(String(s||'').match(/[^.!?…]+[.!?…]+/g)||[]).length;
const headingCount=s=>(String(s||'').match(/^#{2,4}\s+.+$/gm)||[]).length;
const started=Date.now();let result={game_slug:slug,game_title:title,id,label,provider,model,status:'error',short_description:'',review:'',format_ok:false,short_chars:0,short_sentences:0,review_words:0,review_sections:0,short_contract_ok:false,review_length_ok:false,error:null,usage:null,elapsed_ms:0};
try{const call=provider==='openrouter'?openrouter:provider==='groq'?groq:provider==='gemini'?gemini:provider==='gigachat'?gigachat:null;if(!call)throw new Error(`unsupported provider ${provider}`);const response=await call(),parsed=parse(response.raw);result={...result,...parsed,status:parsed.short_description&&parsed.review?'ok':'partial',usage:response.usage||null};if(result.status!=='ok')result.error='required benchmark sections missing'}catch(e){result.status=e?.code==='missing_secret'?'unavailable':'error';result.error=String(e?.message||e).slice(0,3500)}
result.short_chars=[...result.short_description].length;result.short_sentences=sentenceCount(result.short_description);result.review_words=wordCount(result.review);result.review_sections=headingCount(result.review);result.short_contract_ok=result.short_chars>=100&&result.short_chars<=240&&result.short_sentences===2;result.review_length_ok=result.review_words>=1900&&result.review_words<=2850;result.elapsed_ms=Date.now()-started;result.completed_at=new Date().toISOString();
const out=path.join(root,'benchmark-one');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,'output.txt'),`GAME: ${title}\nMODEL: ${label}\nPROVIDER: ${provider}\nMODEL ID: ${model}\nSTATUS: ${result.status}\nSHORT: ${result.short_chars} chars / ${result.short_sentences} sentences / contract=${result.short_contract_ok}\nREVIEW: ${result.review_words} words / ${result.review_sections} sections / length=${result.review_length_ok}\n\n=== SHORT DESCRIPTION ===\n${result.short_description}\n\n=== REVIEW ===\n${result.review}\n\nERROR: ${result.error||''}\n`);console.log(JSON.stringify({game:slug,model:label,status:result.status,short_chars:result.short_chars,short_sentences:result.short_sentences,short_contract_ok:result.short_contract_ok,review_words:result.review_words,review_sections:result.review_sections,review_length_ok:result.review_length_ok,elapsed_ms:result.elapsed_ms,error:result.error},null,2));
