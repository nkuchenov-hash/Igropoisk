#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {callEditorialModel} from './editorial-benchmark-provider.mjs';

const root=process.cwd();
const slug=String(process.env.BENCH_GAME||'').trim();
const provider=String(process.env.BENCH_PROVIDER||'').trim();
const model=String(process.env.BENCH_MODEL||'').trim();
const id=String(process.env.BENCH_ID||'').trim();
const label=String(process.env.BENCH_LABEL||model).trim();
const titleOverride=String(process.env.BENCH_TITLE||'').trim();
const year=String(process.env.BENCH_YEAR||'').trim();
if(!slug||!provider||!model||!id) throw new Error('BENCH_GAME/BENCH_PROVIDER/BENCH_MODEL/BENCH_ID required');

const evidenceDir=path.join(root,'benchmark-evidence',slug);
const contentPath=path.join(evidenceDir,'source-content.json');
const raw=fs.readFileSync(contentPath);
const sourceDoc=JSON.parse(raw.toString('utf8'));
const evidenceHash=crypto.createHash('sha256').update(raw).digest('hex');
const title=titleOverride||sourceDoc.title||slug;
const readable=(sourceDoc.sources||[]).filter(s=>s?.readable===true&&String(s.text||'').trim().length>0);
if(!readable.length) throw new Error(`No readable sources for ${slug}`);
const blocks=readable.map((s,i)=>`[SOURCE ${i+1}/${readable.length}]\nID: ${s.id||`source-${i+1}`}\nNAME: ${s.name||''}\nTITLE: ${s.title||''}\nURL: ${s.resolved_url||s.url||''}\nTEXT:\n${String(s.text||'').trim()}\n[/SOURCE]`);
const evidenceChars=blocks.reduce((n,x)=>n+x.length,0),CHUNK=44000;
function chunksOf(xs){const out=[];let cur='';for(const b of xs){if(b.length>CHUNK){if(cur){out.push(cur);cur=''}for(let p=0;p<b.length;p+=CHUNK)out.push(b.slice(p,p+CHUNK));continue}if(cur&&cur.length+b.length+2>CHUNK){out.push(cur);cur=''}cur+=(cur?'\n\n':'')+b}if(cur)out.push(cur);return out}
const chunks=chunksOf(blocks);
const SYSTEM=`Ты — ведущий автор Игропоиска. Пишешь журнальный evergreen-обзор конкретной игры только по переданному каноническому корпусу. Не используй знания из памяти. Не смешивай оригинал с ремейками, ремастерами, портами, сиквелами и другими версиями. Не упоминай источники, ИИ, benchmark или процесс. Механики описывай в настоящем времени. Стиль: живой, конкретный, взрослый редакционный русский без рекламного пафоса и нейросетевых клише.`;

async function evidencePass(chunk,index,total){const prompt=`Игра: ${title}${year?` (${year})`:''}.\n\nEvidence pass ${index+1}/${total}. Извлеки из этой части корпуса материал для будущего большого обзора. Нужны подтверждённые: механики, структура, сюжетная роль без избыточного пересказа, интерфейс/HUD/сохранения/управление, сильные стороны, реальные слабости, необычные детали, атмосфера только когда она подтверждается конкретикой, исторический контекст только если объясняет дизайн. Отмечай противоречия/сомнительные детали, чтобы не превращать их в факт. Не пиши обзор сейчас. Ничего не добавляй из памяти.\n\nCORPUS CHUNK:\n${chunk}`;const r=await callEditorialModel({provider,model,system:SYSTEM,prompt,maxTokens:3000,temperature:.2});return r.raw}

function reviewPrompt(notes){return `Игра: ${title}${year?` (${year})`:''}.\n\nНа основе evidence notes, которые ТЫ ЖЕ извлёк из 100% readable-корпуса, напиши полноценный обзор Игропоиска.\n\nТребования Review Skill:\n- evergreen: не строить текст вокруг того, как игра ощущается «сегодня»;\n- ориентир около 2200 слов; допустимый рабочий диапазон 1600–3200;\n- динамическая структура из самой игры, обычно 7–9 содержательных разделов;\n- заголовки должны называть конкретный аспект, а не «Геймплей/Графика/Итоги» по шаблону;\n- объясняй характер игры через конкретные механики и детали;\n- достоинства и недостатки вплетай в соответствующие системы, обязательного блока «Минусы» нет;\n- отдельно не забудь интерфейсную обратную связь: HUD, карта, здоровье, инвентарь, сохранения, управление, звуковые сигналы — только то, что реально есть в evidence;\n- не выдумывай атмосферные детали;\n- финал должен формулировать характер/послевкусие игры, а не пересказывать предыдущие разделы;\n- запрещены формулы вроде «по современным меркам», «сегодня ощущается», «выдаёт свой возраст», «состарилось плохо», «для современного игрока»;\n- не упоминай evidence, источники, модель или процесс.\n\nФормат ответа:\n<<<REVIEW>>>\n# [заголовок обзора]\n\n## [раздел]\n...\n\n## [раздел]\n...\n<<<END>>>\n\nEVIDENCE NOTES:\n${notes}`}
function section(rawText){return (String(rawText||'').match(/<<<REVIEW>>>\s*([\s\S]*?)(?=<<<END>>>|$)/i)?.[1]||'').trim()}
function countWords(s){return String(s||'').trim().split(/\s+/u).filter(Boolean).length}
function countSections(s){return (String(s||'').match(/^##\s+/gm)||[]).length}

const started=Date.now();
let result={schema_version:1,test:'review-model-qualification',qualification:true,game_slug:slug,game_title:title,year,id,label,provider,model,evidence_sha256:evidenceHash,total_candidates:Number(sourceDoc.total_candidates||sourceDoc.sources?.length||0),readable_sources:readable.length,evidence_chars:evidenceChars,chunk_count:chunks.length,coverage_source_ids:readable.map((s,i)=>s.id||`source-${i+1}`),status:'error',review:'',review_words:0,section_count:0,format_ok:false,structural_contract_ok:false,error:null,elapsed_ms:0};
try{const notes=[];for(let i=0;i<chunks.length;i++)notes.push(`=== CHUNK ${i+1}/${chunks.length} NOTES ===\n${await evidencePass(chunks[i],i,chunks.length)}`);const joined=notes.join('\n\n');const outDir=path.join(root,'benchmark-review-one');fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'evidence-notes.txt'),joined);const response=await callEditorialModel({provider,model,system:SYSTEM,prompt:reviewPrompt(joined),maxTokens:7600,temperature:.58});const review=section(response.raw);result.review=review;result.format_ok=Boolean(review&&/<<<END>>>/i.test(response.raw));result.status=review?'ok':'partial';if(!review)result.error='REVIEW section missing'}catch(e){result.status=e?.code==='missing_secret'?'unavailable':'error';result.error=String(e?.message||e).slice(0,4000)}
result.review_words=countWords(result.review);result.section_count=countSections(result.review);result.structural_contract_ok=result.status==='ok'&&result.format_ok&&result.review_words>=1600&&result.review_words<=3200&&result.section_count>=7&&result.section_count<=9;result.elapsed_ms=Date.now()-started;result.completed_at=new Date().toISOString();const out=path.join(root,'benchmark-review-one');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,'output.md'),`GAME: ${title}\nMODEL: ${label}\nSTATUS: ${result.status}\nEVIDENCE_SHA256: ${evidenceHash}\nREADABLE: ${readable.length}\nCHUNKS: ${chunks.length}\nWORDS: ${result.review_words}\nSECTIONS: ${result.section_count}\nSTRUCTURAL_CONTRACT: ${result.structural_contract_ok}\n\n${result.review}\n\nERROR: ${result.error||''}\n`);console.log(JSON.stringify({game:slug,model:label,status:result.status,words:result.review_words,sections:result.section_count,contract:result.structural_contract_ok,chunks:chunks.length,elapsed_ms:result.elapsed_ms,error:result.error},null,2));
