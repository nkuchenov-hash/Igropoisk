#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-bootstrap-local <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[«»"'`]/g,'').replace(/[^a-zа-яё0-9]+/gi,' ').replace(/\s+/g,' ').trim();
const QUICK_REVIEW_TIMEOUT_MS=Math.max(60000,Math.min(180000,Number(process.env.QUICK_REVIEW_TIMEOUT_MS||120000)));
const QUICK_REVIEW_GITHUB_TIMEOUT_MS=Math.max(30000,Math.min(120000,Number(process.env.QUICK_REVIEW_GITHUB_TIMEOUT_MS||75000)));
const QUICK_REVIEW_NUM_CTX=Math.max(4096,Math.min(16384,Number(process.env.QUICK_REVIEW_NUM_CTX||8192)));
const QUICK_REVIEW_NUM_PREDICT=Math.max(1200,Math.min(3600,Number(process.env.QUICK_REVIEW_NUM_PREDICT||2400)));
const QUICK_REVIEW_MIN_WORDS=Math.max(180,Math.min(420,Number(process.env.QUICK_REVIEW_MIN_WORDS||220)));
const GITHUB_MODEL=process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1';
const draft=read(`data/drafts/${slug}.json`),review=read(`data/reviews/${slug}.json`,{}),research=read(`data/research/${slug}-source-matrix.json`,{});
if(!draft?.identity)throw new Error(`${slug}: game draft missing`);
const score=Number(review?.review_score?.calculation?.score_10);
if(review?.review_score?.status!=='green'||!Number.isFinite(score)){
  console.log(JSON.stringify({slug,status:'skipped',reason:'canonical_rating_not_green'},null,2));process.exit(0);
}
const allSources=(research.accepted||[]).filter(source=>source?.canonical_score_eligible!==false&&Boolean(source?.url||source?.resolved_url));
const publications=new Set(allSources.map(source=>String(source.publication||source.source||source.configured_source_id||'').toLowerCase()).filter(Boolean));
if(allSources.length<3||publications.size<3){
  console.log(JSON.stringify({slug,status:'skipped',reason:'fewer_than_three_independent_professional_sources',sources:allSources.length,publications:publications.size},null,2));process.exit(0);
}
function assessEditorialQuality(generated){
  const sections=Array.isArray(generated?.sections)?generated.sections:[];
  const paragraphs=[generated?.lead,...sections.flatMap(section=>section?.paragraphs||[]),generated?.verdict?.summary].map(value=>String(value||'').trim()).filter(Boolean);
  const words=countWords(paragraphs.join(' '));
  const normalizedParagraphs=paragraphs.map(normalize).filter(value=>value.length>=40);
  const paragraphCounts=new Map();for(const value of normalizedParagraphs)paragraphCounts.set(value,(paragraphCounts.get(value)||0)+1);
  const duplicateParagraphs=[...paragraphCounts.entries()].filter(([,count])=>count>1).map(([text,count])=>({text:text.slice(0,120),count}));
  const sentences=paragraphs.flatMap(value=>String(value).split(/(?<=[.!?…])\s+/)).map(normalize).filter(value=>value.length>=45);
  const sentenceCounts=new Map();for(const value of sentences)sentenceCounts.set(value,(sentenceCounts.get(value)||0)+1);
  const duplicateSentences=[...sentenceCounts.entries()].filter(([,count])=>count>1).map(([text,count])=>({text:text.slice(0,140),count}));
  const uniqueSentenceRatio=sentences.length?new Set(sentences).size/sentences.length:1;
  const headings=sections.map(section=>normalize(section?.heading)).filter(Boolean);
  const genericHeadingCount=headings.filter(value=>/^(основной игровой процесс|сильные стороны|заметные недостатки|кому подходит игра|итог)$/.test(value)).length;
  const reasons=[];
  if(sections.length<3)reasons.push(`sections ${sections.length}/3`);
  if(words<QUICK_REVIEW_MIN_WORDS)reasons.push(`words ${words}/${QUICK_REVIEW_MIN_WORDS}`);
  if(duplicateParagraphs.length)reasons.push(`duplicate paragraphs ${duplicateParagraphs.length}`);
  if(duplicateSentences.length)reasons.push(`duplicate long sentences ${duplicateSentences.length}`);
  if(sentences.length>=6&&uniqueSentenceRatio<0.86)reasons.push(`unique sentence ratio ${uniqueSentenceRatio.toFixed(2)}/0.86`);
  if(genericHeadingCount>=3)reasons.push(`generic headings ${genericHeadingCount}`);
  return{passed:reasons.length===0,reasons,words,sections:sections.length,duplicate_paragraphs:duplicateParagraphs,duplicate_sentences:duplicateSentences,unique_sentence_ratio:Number(uniqueSentenceRatio.toFixed(3)),generic_heading_count:genericHeadingCount};
}
const existing=read(`data/review-bootstrap/${slug}.json`);
if(existing?.publication_status==='published'&&Number(existing.score)===score&&fs.existsSync(path.join(root,'article',slug,'index.html'))){
  const existingQuality=assessEditorialQuality(existing);
  if(existingQuality.passed){console.log(JSON.stringify({slug,status:'already_published',score,sources:existing.sources?.length||0,quality:existingQuality},null,2));process.exit(0)}
  console.log(`${slug}: existing bootstrap review failed editorial quality gate; regenerating: ${existingQuality.reasons.join(', ')}`);
}
const sources=allSources.slice(0,8),validIds=new Set(sources.map((source,index)=>source.id||`source-${index+1}`));
const sourceDigest=sources.map((source,index)=>({
  id:source.id||`source-${index+1}`,
  publication:source.publication||source.source||source.configured_source_id,
  title:source.title||'',score:source.score??null,scale:source.scale??null,
  snippet:source.snippet||source.summary||source.description||source.identity_evidence||'',
  praise:(source.praise||[]).slice(0,4),criticism:(source.criticism||[]).slice(0,4),
  evidence_points:(source.evidence_points||source.evidence||[]).slice(0,6)
}));
const identity={title:draft.identity.title,release:draft.release,developers:draft.companies?.developers||[],publishers:draft.companies?.publishers||[],genres:draft.classification?.genres||[],platforms:draft.classification?.platforms||[],description:draft.editorial?.integrated_description||draft.editorial?.short_description||'',features:(draft.editorial?.features||[]).slice(0,10)};
const schema={type:'object',additionalProperties:false,required:['title','dek','lead','sections','verdict'],properties:{title:{type:'string'},dek:{type:'string'},lead:{type:'string'},sections:{type:'array',minItems:3,maxItems:4,items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','source_ids'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:1,maxItems:3,items:{type:'string'}},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}},verdict:{type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',maxItems:3,items:{type:'string'}},not_for:{type:'array',maxItems:3,items:{type:'string'}}}}}};
const basePrompt=`Напиши быстрый публикуемый обзор Игропоиска на русском языке по игре ниже. Это полноценный короткий редакционный материал, а не шаблон, SEO-текст, перевод или перечень чужих мнений. Читатель должен понять, что в игре реально делаешь, какие системы/ощущения определяют опыт, за что критики её ценят и что им мешает.\n\nПРАВИЛА:\n- 3–4 содержательных раздела, примерно 300–600 слов; не раздувай ради объёма.\n- Заголовки разделов должны быть конкретными для этой игры, а не «Сильные стороны»/«Недостатки»/«Кому подходит».\n- Не повторяй одну мысль или формулировку в разных абзацах; lead и verdict не должны дублировать друг друга.\n- Каждый абзац должен сообщать новую конкретную мысль именно об этой игре.\n- Используй только факты/выводы из ИГРА и ПРОФЕССИОНАЛЬНЫЕ ИСТОЧНИКИ; если источники не подтверждают деталь, не выдумывай её.\n- Каждый раздел обязан иметь source_ids реально подтверждающих его тезисы.\n- Естественный современный русский, без кальки, канцелярита и рекламной интонации.\n- Оценка Игропоиска уже рассчитана отдельно: ${score}/10. Не пересчитывай её.\nВерни только JSON.\n\nИГРА:\n${JSON.stringify(identity)}\n\nПРОФЕССИОНАЛЬНЫЕ ИСТОЧНИКИ:\n${JSON.stringify(sourceDigest)}`;
async function githubJson(prompt,retry=false){
  const token=process.env.GITHUB_TOKEN;if(!token)throw new Error('GITHUB_TOKEN unavailable');
  const response=await fetch('https://models.github.ai/inference/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','accept':'application/vnd.github+json','x-github-api-version':'2026-03-10'},body:JSON.stringify({model:GITHUB_MODEL,messages:[{role:'system',content:'Ты старший русскоязычный игровой редактор. Пиши живой, точный и небанальный текст. Не повторяй предложения, не имитируй перевод и не заполняй объём общими словами.'},{role:'user',content:retry?`${prompt}\n\nПредыдущий вариант не прошёл редакционный gate. Перепиши целиком более конкретно, без повторов и шаблонных заголовков.`:prompt}],response_format:{type:'json_object'},temperature:retry?0.25:0.35,max_tokens:3500}),signal:AbortSignal.timeout(QUICK_REVIEW_GITHUB_TIMEOUT_MS)});
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${(await response.text()).slice(0,600)}`);
  const payload=await response.json(),raw=payload.choices?.[0]?.message?.content;if(!raw)throw new Error('GitHub Models returned no quick-review JSON');
  return JSON.parse(String(raw).replace(/^```json\s*|\s*```$/g,''));
}
async function localJson(prompt){return chatJson({system:'Ты опытный русскоязычный игровой журналист. Пиши живой оригинальный текст, без повторов, строго опираясь на предоставленные профессиональные рецензии.',prompt,schema,temperature:0.2,numCtx:QUICK_REVIEW_NUM_CTX,numPredict:QUICK_REVIEW_NUM_PREDICT,timeoutMs:QUICK_REVIEW_TIMEOUT_MS})}
async function generateQuickReview(){
  const failures=[];
  if(process.env.GITHUB_TOKEN){
    for(let attempt=1;attempt<=2;attempt++){
      try{const generated=await githubJson(basePrompt,attempt>1),quality=assessEditorialQuality(generated);if(quality.passed)return{generated,quality,provider:'github-models',model:GITHUB_MODEL,attempt,failures};failures.push(`github attempt ${attempt}: ${quality.reasons.join(', ')}`)}catch(error){failures.push(`github attempt ${attempt}: ${error?.message||String(error)}`)}
    }
  }
  try{
    const generated=await localJson(`${basePrompt}\n\nЭто аварийный локальный fallback. Сделай компактный, но законченный текст и особенно избегай повторов.`),quality=assessEditorialQuality(generated);
    if(quality.passed)return{generated,quality,provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,attempt:1,failures};
    failures.push(`local fallback: ${quality.reasons.join(', ')}`);
  }catch(error){failures.push(`local fallback: ${error?.message||String(error)}`)}
  throw new Error(`${slug}: quick review failed editorial quality gate: ${failures.join(' | ')}`);
}
const generatedResult=await generateQuickReview();
const generated=generatedResult.generated,sections=Array.isArray(generated.sections)?generated.sections:[],words=generatedResult.quality.words;
for(const section of sections){section.source_ids=[...new Set(section.source_ids||[])].filter(id=>validIds.has(id));if(!section.source_ids.length)throw new Error(`${slug}/${section.id}: no verified source_ids`)}
const title=String(generated.title||`Обзор ${identity.title}`),dek=String(generated.dek||generated.lead||''),now=new Date().toISOString();
const article={schema_version:2,review_stage:'bootstrap',publication_status:'published',slug,game_slug:slug,game_id:draft.game_id||draft.identity.game_id||null,title,dek,lead:generated.lead,author:'Редакция Игропоиска',published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),updated_at:now,score,score_source:`data/reviews/${slug}.json#review_score`,reading_time_minutes:Math.max(2,Math.ceil(words/190)),sections,verdict:generated.verdict,sources:sources.map((source,index)=>({id:source.id||`source-${index+1}`,name:source.publication||source.source||source.configured_source_id||'Издание',title:source.title||'',url:source.resolved_url||source.url,purpose:[...(source.praise||[]).slice(0,1),...(source.criticism||[]).slice(0,1)].join(' · ')||'Профессиональная рецензия'})),methodology:{stage:'bootstrap',minimum_independent_professional_sources:3,accepted_sources:sources.length,independent_publications:publications.size,upgrade_target:'full_editorial_review'},generation:{provider:generatedResult.provider,model:generatedResult.model,checked_at:now,attempt:generatedResult.attempt,github_timeout_ms:QUICK_REVIEW_GITHUB_TIMEOUT_MS,local_timeout_ms:QUICK_REVIEW_TIMEOUT_MS,minimum_words:QUICK_REVIEW_MIN_WORDS,editorial_quality:generatedResult.quality,prior_failures:generatedResult.failures}};
const toc=sections.map((section,index)=>`<li><a href="#${esc(section.id)}"><span>${String(index+1).padStart(2,'0')}</span><b>${esc(section.heading)}</b></a></li>`).join('');
const body=sections.map((section,index)=>`<section class="article-section" id="${esc(section.id)}"><h2><span>${String(index+1).padStart(2,'0')}</span>${esc(section.heading)}</h2>${(section.paragraphs||[]).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</section>`).join('');
const best=(generated.verdict?.best_for||[]).map(item=>`<li>${esc(item)}</li>`).join(''),notFor=(generated.verdict?.not_for||[]).map(item=>`<li>${esc(item)}</li>`).join('');
const sourceRows=article.sources.map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b><small>${esc(source.title||source.purpose)}</small></div><strong>↗</strong></a>`).join('');
const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(dek)}"><title>${esc(title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/review-article.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body data-article="${esc(slug)}" id="top"><header class="article-header"></header><section class="article-hero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(title)}</h1><div class="article-dek">${esc(dek)}</div><div class="article-meta"><span>Редакция Игропоиска</span><span>${article.reading_time_minutes} мин</span><span>${article.sources.length} источников</span><strong class="article-score">${score} / 10</strong></div></div></div></section><main class="ig-container article-layout"><aside class="article-left-rail"><nav class="article-toc" aria-label="Оглавление"><div class="article-kicker">Оглавление</div><ol>${toc}</ol><a class="article-toc__top" href="#top">Наверх ↑</a></nav></aside><article class="article-body"><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(slug)}/"><span>←</span><div><small>Страница игры</small><b>Открыть карточку игры</b></div></a><section class="article-quality"><div><strong>${article.sources.length}</strong><span>источников</span></div><div><strong>${words}</strong><span>слов</span></div><div><strong>${score}</strong><span>оценка / 10</span></div></section><p class="article-lead">${esc(generated.lead)}</p>${body}<section class="article-verdict"><div class="article-kicker">Вердикт</div><h2>${score} / 10</h2><p>${esc(generated.verdict?.summary||'')}</p><div class="article-verdict__grid">${best?`<div class="article-verdict__group"><h3>Подойдёт</h3><ul>${best}</ul></div>`:''}${notFor?`<div class="article-verdict__group"><h3>Не подойдёт</h3><ul>${notFor}</ul></div>`:''}</div></section><section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Источники</div><h2>Материалы, использованные при написании</h2></div><div class="article-sources__list">${sourceRows}</div></section><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(slug)}/"><span>←</span><div><small>Страница игры</small><b>Вернуться к игре</b></div></a></article></main><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>`;
write(`data/review-bootstrap/${slug}.json`,article);
const output=path.join(root,'article',slug,'index.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
review.igropoisk_article={url:`../../article/${slug}/`,title,description:dek,score,score_source:`data/reviews/${slug}.json#review_score`,review_stage:'bootstrap',source_count:article.sources.length,updated_at:now};review.updated_at=now;write(`data/reviews/${slug}.json`,review);
write(`data/parser-runs/review-bootstrap-${slug}.json`,{parser:'review-bootstrap-quality-v2',status:'green',game_slug:slug,checked_at:now,score,sources:article.sources.length,words,sections:sections.length,provider:generatedResult.provider,model:generatedResult.model,generation_attempt:generatedResult.attempt,editorial_quality:generatedResult.quality});
console.log(JSON.stringify({slug,status:'published_bootstrap',score,sources:article.sources.length,words,sections:sections.length,provider:generatedResult.provider,model:generatedResult.model,generation_attempt:generatedResult.attempt,editorial_quality:generatedResult.quality},null,2));
