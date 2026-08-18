#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-bootstrap-local <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const QUICK_REVIEW_TIMEOUT_MS=Math.max(60000,Math.min(240000,Number(process.env.QUICK_REVIEW_TIMEOUT_MS||120000)));
const QUICK_REVIEW_NUM_CTX=Math.max(4096,Math.min(16384,Number(process.env.QUICK_REVIEW_NUM_CTX||8192)));
const QUICK_REVIEW_NUM_PREDICT=Math.max(1200,Math.min(3600,Number(process.env.QUICK_REVIEW_NUM_PREDICT||2200)));
const QUICK_REVIEW_MIN_WORDS=Math.max(160,Math.min(360,Number(process.env.QUICK_REVIEW_MIN_WORDS||180)));
const QUICK_REVIEW_MAX_ATTEMPTS=2;
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
const existing=read(`data/review-bootstrap/${slug}.json`);
if(existing?.publication_status==='published'&&Number(existing.score)===score&&fs.existsSync(path.join(root,'article',slug,'index.html'))){
  console.log(JSON.stringify({slug,status:'already_published',score,sources:existing.sources?.length||0},null,2));process.exit(0);
}
const sources=allSources.slice(0,6),validIds=new Set(sources.map((source,index)=>source.id||`source-${index+1}`));
const sourceDigest=sources.map((source,index)=>({
  id:source.id||`source-${index+1}`,
  publication:source.publication||source.source||source.configured_source_id,
  title:source.title||'',
  score:source.score??null,
  scale:source.scale??null,
  praise:(source.praise||[]).slice(0,2),
  criticism:(source.criticism||[]).slice(0,2),
  evidence_points:(source.evidence_points||source.evidence||[]).slice(0,4)
}));
const identity={title:draft.identity.title,release:draft.release,developers:draft.companies?.developers||[],publishers:draft.companies?.publishers||[],genres:draft.classification?.genres||[],description:draft.editorial?.integrated_description||draft.editorial?.short_description||'',features:(draft.editorial?.features||[]).slice(0,8)};
const schema={type:'object',additionalProperties:false,required:['title','dek','lead','sections','verdict'],properties:{title:{type:'string'},dek:{type:'string'},lead:{type:'string'},sections:{type:'array',minItems:3,maxItems:4,items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','source_ids'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:1,maxItems:3,items:{type:'string'}},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}},verdict:{type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',maxItems:3,items:{type:'string'}},not_for:{type:'array',maxItems:3,items:{type:'string'}}}}}};
const basePrompt=`Напиши быстрый публикуемый обзор Игропоиска на русском языке по игре ниже. Это компактный первый редакционный обзор, который позже может быть расширен отдельным full-review этапом. Дай цельное понимание игры: основной игровой процесс, сильные стороны, заметные недостатки и кому она подходит. Пиши естественным русским языком, без канцелярита, рекламной интонации и ощущения машинного перевода. Используй ТОЛЬКО факты и выводы из предоставленных профессиональных источников; не выдумывай детали и не раскрывай крупные сюжетные повороты. Нужны 3–4 содержательных раздела и примерно 250–500 слов: не раздувай текст ради объёма. Каждый раздел обязан иметь source_ids, реально подтверждающие его тезисы. Оценка Игропоиска уже рассчитана отдельно и равна ${score}/10; не пересчитывай её. Верни только JSON по схеме.\n\nИГРА:\n${JSON.stringify(identity)}\n\nПРОФЕССИОНАЛЬНЫЕ ИСТОЧНИКИ:\n${JSON.stringify(sourceDigest)}`;
async function generateQuickReview(){
  const failures=[];
  for(let attempt=1;attempt<=QUICK_REVIEW_MAX_ATTEMPTS;attempt++){
    const retryNote=attempt===1?'':`\n\nПредыдущая попытка не дала пригодный компактный материал. Ответь проще: 3–4 раздела, минимум ${QUICK_REVIEW_MIN_WORDS} содержательных слов, только валидный JSON без пояснений.`;
    try{
      const generated=await chatJson({
        system:'Ты опытный русскоязычный игровой журналист. Пиши живой оригинальный текст и строго опирайся на предоставленные профессиональные рецензии.',
        prompt:`${basePrompt}${retryNote}`,
        schema,
        temperature:attempt===1?0.3:0.2,
        numCtx:QUICK_REVIEW_NUM_CTX,
        numPredict:QUICK_REVIEW_NUM_PREDICT,
        timeoutMs:QUICK_REVIEW_TIMEOUT_MS
      });
      const sections=Array.isArray(generated.sections)?generated.sections:[];
      const words=countWords([generated.lead,...sections.flatMap(section=>section.paragraphs||[]),generated.verdict?.summary].join(' '));
      if(sections.length>=3&&words>=QUICK_REVIEW_MIN_WORDS)return{generated,sections,words,attempt,failures};
      failures.push(`attempt ${attempt}: too short (${sections.length} sections, ${words} words)`);
    }catch(error){failures.push(`attempt ${attempt}: ${error?.message||String(error)}`)}
  }
  throw new Error(`${slug}: bounded quick review generation failed: ${failures.join(' | ')}`);
}
const generatedResult=await generateQuickReview();
const generated=generatedResult.generated,sections=generatedResult.sections,words=generatedResult.words;
for(const section of sections){section.source_ids=[...new Set(section.source_ids||[])].filter(id=>validIds.has(id));if(!section.source_ids.length)throw new Error(`${slug}/${section.id}: no verified source_ids`)}
const title=String(generated.title||`Обзор ${identity.title}`),dek=String(generated.dek||generated.lead||''),now=new Date().toISOString();
const article={schema_version:1,review_stage:'bootstrap',publication_status:'published',slug,game_slug:slug,game_id:draft.game_id||draft.identity.game_id||null,title,dek,lead:generated.lead,author:'Редакция Игропоиска',published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),updated_at:now,score,score_source:`data/reviews/${slug}.json#review_score`,reading_time_minutes:Math.max(2,Math.ceil(words/190)),sections,verdict:generated.verdict,sources:sources.map((source,index)=>({id:source.id||`source-${index+1}`,name:source.publication||source.source||source.configured_source_id||'Издание',title:source.title||'',url:source.resolved_url||source.url,purpose:[...(source.praise||[]).slice(0,1),...(source.criticism||[]).slice(0,1)].join(' · ')||'Профессиональная рецензия'})),methodology:{stage:'bootstrap',minimum_independent_professional_sources:3,accepted_sources:sources.length,independent_publications:publications.size,upgrade_target:'full_editorial_review'},generation:{provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,checked_at:now,attempt:generatedResult.attempt,timeout_ms:QUICK_REVIEW_TIMEOUT_MS,num_ctx:QUICK_REVIEW_NUM_CTX,num_predict:QUICK_REVIEW_NUM_PREDICT,minimum_words:QUICK_REVIEW_MIN_WORDS}};
const toc=sections.map((section,index)=>`<li><a href="#${esc(section.id)}"><span>${String(index+1).padStart(2,'0')}</span><b>${esc(section.heading)}</b></a></li>`).join('');
const body=sections.map((section,index)=>`<section class="article-section" id="${esc(section.id)}"><h2><span>${String(index+1).padStart(2,'0')}</span>${esc(section.heading)}</h2>${(section.paragraphs||[]).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</section>`).join('');
const best=(generated.verdict?.best_for||[]).map(item=>`<li>${esc(item)}</li>`).join(''),notFor=(generated.verdict?.not_for||[]).map(item=>`<li>${esc(item)}</li>`).join('');
const sourceRows=article.sources.map((source,index)=>`<a class="article-source-row" href="${esc(source.url)}" target="_blank" rel="noopener"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(source.name)}</b><small>${esc(source.title||source.purpose)}</small></div><strong>↗</strong></a>`).join('');
const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(dek)}"><title>${esc(title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/review-article.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body data-article="${esc(slug)}" id="top"><header class="article-header"></header><section class="article-hero"><div class="ig-container article-hero__inner"><div class="article-hero__copy"><div class="article-kicker">Обзор Игропоиска</div><h1>${esc(title)}</h1><div class="article-dek">${esc(dek)}</div><div class="article-meta"><span>Редакция Игропоиска</span><span>${article.reading_time_minutes} мин</span><span>${article.sources.length} источников</span><strong class="article-score">${score} / 10</strong></div></div></div></section><main class="ig-container article-layout"><aside class="article-left-rail"><nav class="article-toc" aria-label="Оглавление"><div class="article-kicker">Оглавление</div><ol>${toc}</ol><a class="article-toc__top" href="#top">Наверх ↑</a></nav></aside><article class="article-body"><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(slug)}/"><span>←</span><div><small>Страница игры</small><b>Открыть карточку игры</b></div></a><section class="article-quality"><div><strong>${article.sources.length}</strong><span>источников</span></div><div><strong>${words}</strong><span>слов</span></div><div><strong>${score}</strong><span>оценка / 10</span></div></section><p class="article-lead">${esc(generated.lead)}</p>${body}<section class="article-verdict"><div class="article-kicker">Вердикт</div><h2>${score} / 10</h2><p>${esc(generated.verdict?.summary||'')}</p><div class="article-verdict__grid">${best?`<div class="article-verdict__group"><h3>Подойдёт</h3><ul>${best}</ul></div>`:''}${notFor?`<div class="article-verdict__group"><h3>Не подойдёт</h3><ul>${notFor}</ul></div>`:''}</div></section><section class="article-sources" id="sources"><div class="article-sources__head"><div class="article-kicker">Источники</div><h2>Материалы, использованные при написании</h2></div><div class="article-sources__list">${sourceRows}</div></section><a class="article-game-return" href="/Igropoisk/game/${encodeURIComponent(slug)}/"><span>←</span><div><small>Страница игры</small><b>Вернуться к игре</b></div></a></article></main><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>`;
write(`data/review-bootstrap/${slug}.json`,article);
const output=path.join(root,'article',slug,'index.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
review.igropoisk_article={url:`../../article/${slug}/`,title,description:dek,score,score_source:`data/reviews/${slug}.json#review_score`,review_stage:'bootstrap',source_count:article.sources.length,updated_at:now};review.updated_at=now;write(`data/reviews/${slug}.json`,review);
write(`data/parser-runs/review-bootstrap-${slug}.json`,{parser:'review-bootstrap-local',status:'green',game_slug:slug,checked_at:now,score,sources:article.sources.length,words,sections:sections.length,model:LOCAL_EDITORIAL_MODEL,generation_attempt:generatedResult.attempt,timeout_ms:QUICK_REVIEW_TIMEOUT_MS,minimum_words:QUICK_REVIEW_MIN_WORDS});
console.log(JSON.stringify({slug,status:'published_bootstrap',score,sources:article.sources.length,words,sections:sections.length,generation_attempt:generatedResult.attempt,timeout_ms:QUICK_REVIEW_TIMEOUT_MS,minimum_words:QUICK_REVIEW_MIN_WORDS},null,2));
