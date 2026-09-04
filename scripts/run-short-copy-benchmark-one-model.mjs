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
if(!slug||!provider||!model||!id) throw new Error('BENCH_GAME/BENCH_PROVIDER/BENCH_MODEL/BENCH_ID required');

const packPath=path.join(root,'benchmark-packs',slug,'pack.json');
const packBytes=fs.readFileSync(packPath);
const pack=JSON.parse(packBytes);
const packSha256=crypto.createHash('sha256').update(packBytes).digest('hex');
const title=pack.game?.display_title||pack.game?.identity_title||slug;
const maxAttempts=Math.max(1,Number(process.env.SHORT_COPY_ATTEMPTS||3));
const outDir=path.join(root,'short-copy-result');
const attemptsDir=path.join(outDir,'attempts');
fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(attemptsDir,{recursive:true});

const SYSTEM=`Ты — редактор Игропоиска. Пиши естественным современным русским языком, без рекламного пафоса, канцелярита, нейросетевых клише и демонстративной литературности. FROZEN ASSEMBLY PACK — единственный источник фактов. Не используй знания из памяти и не добавляй детали, которых нет в пакете.`;
const PROMPT=`Игра: ${title} (${pack.game?.year||''}).\n\nНапиши ТОЛЬКО короткое описание основной страницы игры Игропоиска.\n\nЖЁСТКИЙ КОНТРАКТ:\n- ровно 2 законченных русских предложения;\n- весь ответ от 100 до 240 символов ВКЛЮЧАЯ пробелы;\n- сразу объясни центральную идею игры и что делает игрок;\n- это не мини-рецензия: без вердикта, оценки и исторического эссе;\n- без заголовка, маркеров, кавычек, пояснений, источников и служебных слов;\n- не перечисляй жанры через запятую;\n- не добавляй ни одного факта из памяти.\n\nВерни только эти два предложения.\n\nFROZEN ASSEMBLY PACK:\n${JSON.stringify(pack,null,2)}`;

const first=(...names)=>names.map(n=>process.env[n]).find(v=>String(v||'').trim())||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchText(url,options={},timeout=180000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...options,signal:c.signal});const text=await r.text();if(!r.ok){const e=new Error(`${r.status}: ${text.slice(0,1800)}`);e.status=r.status;e.headers=Object.fromEntries(r.headers.entries());throw e}return{text,headers:Object.fromEntries(r.headers.entries())}}finally{clearTimeout(timer)}}
function openAIContent(j){const c=j?.choices?.[0]?.message?.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.map(x=>typeof x==='string'?x:(x?.text||'')).join('\n');return j?.output_text||''}
function curlJson(args){return JSON.parse(execFileSync('curl',args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000}))}

async function callOpenRouter(){const key=first('OPENROUTER_API_KEY','OPEN_ROUTER_API_KEY');if(!key)throw Object.assign(new Error('OPENROUTER_API_KEY missing'),{code:'missing_secret'});const {text}=await fetchText('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://nkuchenov-hash.github.io/Igropoisk/','X-Title':'Igropoisk short-copy benchmark'},body:JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_tokens:220,temperature:.45,top_p:.9,reasoning:{effort:'low',exclude:true}})});const j=JSON.parse(text);const raw=openAIContent(j);if(!String(raw).trim())throw new Error('empty OpenRouter output');return{raw,usage:j.usage||null}}
async function callGroq(){const key=first('GROQ_API_KEY');if(!key)throw Object.assign(new Error('GROQ_API_KEY missing'),{code:'missing_secret'});const body={model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],max_completion_tokens:220,temperature:.45,top_p:.9,reasoning_effort:model.includes('qwen')?'none':'low',reasoning_format:'hidden'};const {text}=await fetchText('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=JSON.parse(text);const raw=openAIContent(j);if(!String(raw).trim())throw new Error('empty Groq output');return{raw,usage:j.usage||null}}
async function callGemini(){const key=first('GEMINI_API_KEY','GOOGLE_AI_API_KEY','GOOGLE_GEMINI_API_KEY');if(!key)throw Object.assign(new Error('GEMINI_API_KEY missing'),{code:'missing_secret'});const body={systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:220,temperature:.45,topP:.9}};const {text}=await fetchText(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=JSON.parse(text);const raw=(j?.candidates?.[0]?.content?.parts||[]).map(x=>x?.text||'').join('\n');if(!String(raw).trim())throw new Error(`empty Gemini output: ${text.slice(0,900)}`);return{raw,usage:j.usageMetadata||null}}
async function callGigaChat(){const credential=first('GIGACHAT_AUTH_KEY','GIGACHAT_CREDENTIALS','GIGACHAT_API_KEY','GIGACHAT_AUTHORIZATION_KEY','GIGACHAT_KEY');if(!credential)throw Object.assign(new Error('GigaChat authorization secret missing'),{code:'missing_secret'});const auth=/^Basic\s+/i.test(credential)?credential:`Basic ${credential}`;const tok=curlJson(['-skL','-X','POST','https://ngw.devices.sberbank.ru:9443/api/v2/oauth','-H','Content-Type: application/x-www-form-urlencoded','-H','Accept: application/json','-H',`RqUID: ${crypto.randomUUID()}`,'-H',`Authorization: ${auth}`,'--data-urlencode','scope=GIGACHAT_API_PERS']);if(!tok?.access_token)throw new Error(`GigaChat OAuth failed: ${JSON.stringify(tok).slice(0,700)}`);const payload=JSON.stringify({model,messages:[{role:'system',content:SYSTEM},{role:'user',content:PROMPT}],stream:false,temperature:.45,top_p:.9,max_tokens:220});const j=curlJson(['-skL','-X','POST','https://api.giga.chat/v1/chat/completions','-H',`Authorization: Bearer ${tok.access_token}`,'-H','Content-Type: application/json','-H','Accept: application/json','--data-binary',payload]);if(j?.error||j?.status)throw new Error(`GigaChat error: ${JSON.stringify(j).slice(0,1200)}`);const raw=openAIContent(j);if(!String(raw).trim())throw new Error('empty GigaChat output');return{raw,usage:j.usage||null}}

function clean(raw){return String(raw||'').trim().replace(/^```(?:text|markdown)?\s*/i,'').replace(/\s*```$/,'').trim()}
function sentenceCount(s){return (String(s||'').match(/[^.!?…]+[.!?…]+/g)||[]).length}
function contract(text){const chars=[...text].length;const sentences=sentenceCount(text);const noMeta=!/(^|\n)\s*[-*#]|SHORT_DESCRIPTION|источник|source|benchmark|нейросет|модель/i.test(text);return{chars,sentences,no_meta:noMeta,pass:chars>=100&&chars<=240&&sentences===2&&noMeta}}
function transient(error){return /\b(408|409|425|429|500|502|503|504)\b|rate.?limit|quota|RESOURCE_EXHAUSTED|timeout|ECONNRESET|socket|fetch failed/i.test(String(error||''))}

const call=provider==='openrouter'?callOpenRouter:provider==='groq'?callGroq:provider==='gemini'?callGemini:provider==='gigachat'?callGigaChat:null;
if(!call) throw new Error(`unsupported provider ${provider}`);
const attempts=[];let winner=null;
for(let attempt=1;attempt<=maxAttempts;attempt++){
  const started=Date.now();let text='';let usage=null;let error=null;let status='error';
  try{const r=await call();text=clean(r.raw);usage=r.usage||null;status='ok'}catch(e){error=String(e?.message||e).slice(0,3500);status=e?.code==='missing_secret'?'unavailable':'error'}
  const c=contract(text);const pass=status==='ok'&&c.pass;
  const row={attempt,status,pass,text,chars:c.chars,sentences:c.sentences,no_meta:c.no_meta,error,usage,elapsed_ms:Date.now()-started};
  attempts.push(row);fs.writeFileSync(path.join(attemptsDir,`attempt-${attempt}.json`),JSON.stringify(row,null,2)+'\n');
  if(pass){winner=row;break;}
  if(attempt<maxAttempts){const wait=status!=='ok'&&transient(error)?70000:5000;await sleep(wait)}
}
const endpointOnly=!winner&&attempts.every(a=>a.status!=='ok');
const result={schema_version:1,game_slug:slug,game_title:title,id,label,provider,model,pack_sha256:packSha256,capable:Boolean(winner),classification:winner?'PASS':endpointOnly?'FAIL_ENDPOINT':'FAIL_CONTRACT',attempts_used:attempts.length,max_attempts:maxAttempts,winning_attempt:winner?.attempt||null,text:winner?.text||'',chars:winner?.chars||0,sentences:winner?.sentences||0,attempts,completed_at:new Date().toISOString()};
fs.writeFileSync(path.join(outDir,'result.json'),JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'output.txt'),winner?`${winner.text}\n`:`${result.classification}\n${attempts.map(a=>`attempt ${a.attempt}: ${a.status}; chars=${a.chars}; sentences=${a.sentences}; error=${a.error||''}`).join('\n')}\n`);
console.log(JSON.stringify({game:slug,model:label,capable:result.capable,classification:result.classification,attempts_used:result.attempts_used,text:result.text},null,2));
