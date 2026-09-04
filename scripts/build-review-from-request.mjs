#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-review-from-request.mjs <game-slug>');

const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const config=read('config/parsers/review-synthesis.json',{});
const game=read(`data/drafts/${slug}.json`);
if(!game)throw new Error(`Missing data/drafts/${slug}.json`);
const sourcePack=read(`data/game-sources/${slug}.json`);
if(!sourcePack)throw new Error(`Missing canonical source pack data/game-sources/${slug}.json. Review Module does not run its own source discovery; the game page remains publishable.`);

const checkedAt=new Date().toISOString();
const gate=config.publication_gate||{};
const editorialPolicy=config.editorial_policy||{};
const editorialWorkflow=Array.isArray(config.editorial_workflow)?config.editorial_workflow:[];
const evergreenBlacklist=(editorialPolicy.evergreen_blacklist||[]).map(value=>String(value).trim()).filter(Boolean);
const minSections=Number(gate.minimum_sections||7);
const maxSections=Number(gate.maximum_sections||9);
const minWords=Number(gate.minimum_article_words||1600);
const targetWords=Number(gate.target_article_words||2200);
const maxWords=Number(gate.maximum_article_words_without_editor_approval||3200);
const minSectionWords=Number(gate.minimum_words_per_section||170);
const provider=String(process.env.REVIEW_PROVIDER||'').trim().toLowerCase();
const model=String(process.env.REVIEW_MODEL||'').trim();
if(!provider||!model)throw new Error('REVIEW_PROVIDER and REVIEW_MODEL must be explicitly configured. Review Skill v1 has no implicit model or cross-model fallback.');
if(!['openai','github-models'].includes(provider))throw new Error(`Unsupported REVIEW_PROVIDER=${provider}. Configure one explicit supported route; do not fall back to another model.`);
if(provider==='openai'&&!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for REVIEW_PROVIDER=openai');
if(provider==='github-models'&&!process.env.GITHUB_TOKEN)throw new Error('GITHUB_TOKEN is required for REVIEW_PROVIDER=github-models');
const maxAttempts=Math.max(1,Number(config.model_policy?.same_model_attempts||3));
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};

const canonicalSources=(sourcePack.sources||[]).filter(source=>source&&(source.url||source.resolved_url));
if(!canonicalSources.length)throw new Error('Canonical source pack contains no usable sources. The game page remains publishable; only the Review Module waits for evidence.');
const usedIds=new Set();
const sources=canonicalSources.map((source,index)=>{
  const requestedId=String(source.id||'').trim();
  let id=requestedId||`source-auto-${index+1}`;
  if(usedIds.has(id))id=`source-auto-${index+1}`;
  while(usedIds.has(id))id=`${id}-x`;
  usedIds.add(id);
  return {
    ...source,
    id,
    url:canonical(source.resolved_url||source.url),
    publication:source.publication||source.name||source.source||''
  };
});
const sourceIds=sources.map(source=>source.id);
const sourceIdSet=new Set(sourceIds);

const ratings=read(`data/ratings/${slug}.json`,{});
const identity={
  title:game.identity?.title||slug,
  aliases:game.identity?.aliases||[],
  release:game.release||{},
  developers:game.companies?.developers||[],
  publishers:game.companies?.publishers||[],
  genres:game.classification?.genres||[],
  platforms:game.classification?.platforms||[],
  description:game.editorial?.integrated_description||game.editorial?.short_description||'',
  features:game.editorial?.features||[],
  requirements:game.requirements||{}
};
const sourceDigest=sources.map(source=>({
  id:source.id,
  publication:source.publication,
  title:source.title||'',
  source_kind:source.source_kind||source.kind||source.type||'',
  roles:Array.isArray(source.roles)?source.roles:(source.role?[source.role]:[]),
  professional:source.professional===true||source.role==='professional_review'||source.type==='professional_review'||source.kind==='professional-review',
  score:source.score??null,
  scale:source.scale??null,
  grade:source.grade||'',
  evidence_points:source.evidence_points||[],
  praise:source.praise||[],
  criticism:source.criticism||[],
  identity_evidence:source.identity_evidence||'',
  excerpt:source.excerpt||source.summary||source.review_summary||source.content_excerpt||''
}));

async function inferOpenAI(prompt){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model,input:prompt,text:{format:{type:'json_object'}}})});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
  if(!text)throw new Error('OpenAI returned no review JSON');
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g,''));
}

async function inferGitHubModels(prompt){
  const response=await fetch('https://models.github.ai/inference/chat/completions',{method:'POST',headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'content-type':'application/json','accept':'application/vnd.github+json'},body:JSON.stringify({model,messages:[{role:'system',content:'Ты старший русскоязычный игровой редактор Игропоиска. Пиши естественно, конкретно и только по подтверждённым данным.'},{role:'user',content:prompt}],response_format:{type:'json_object'},temperature:0.35,max_tokens:16000})});
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
  const data=await response.json();
  const text=data.choices?.[0]?.message?.content;
  if(!text)throw new Error('GitHub Models returned no review JSON');
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g,''));
}

const infer=provider==='openai'?inferOpenAI:inferGitHubModels;
const workflowText=editorialWorkflow.length?editorialWorkflow.map((step,index)=>`${index+1}. ${step.pass}: ${step.goal}`).join('\n'):'1. evidence_extraction\n2. editorial_angle_and_structure\n3. draft\n4. anti_generic_evergreen_audit';
const blacklistText=evergreenBlacklist.length?evergreenBlacklist.map(item=>`«${item}»`).join(', '):'«сегодня ощущается», «по современным меркам», «для современного игрока»';
const prompt=`Ты старший русскоязычный игровой редактор Игропоиска. Напиши самостоятельный evergreen-журнальный обзор конкретной игры по Review Skill v1.

ЗАДАЧА
Дать читателю цельное ощущение игры и одновременно точно объяснить, почему именно эта игра устроена и запоминается именно так: игровой цикл, управление, структуру мира/миссий, бой или другие центральные механики, персонажей/сюжет там, где это важно, визуальный и звуковой характер, интерфейс и обратную связь, сильные стороны и конкретные недостатки.

ВНУТРЕННИЕ РЕДАКЦИОННЫЕ ПРОХОДЫ
Выполни эти проходы последовательно, но не показывай их читателю и не выводи как отдельные блоки:
${workflowText}

ПРАВИЛА EVIDENCE EXTRACTION
- Сначала извлеки из корпуса факты и evidence: механики, сильные стороны, недостатки, спорные решения, конкретные примеры и только содержательно полезный исторический контекст.
- Активно ищи характерные микро-детали, которые человек реально запоминает: необычный HUD, анимацию состояния героя, отдачу конкретного оружия, физику транспорта, гаджеты, звуковой сигнал, странность управления, поведение врагов, особенность карты или интерфейса. Такие детали приоритетнее очередного общего тезиса.
- Сделай отдельный внутренний проход по интерфейсу и обратной связи: HUD, карта, здоровье, инвентарь, сохранения, управление, звуковые сигналы и другие способы, которыми игра сообщает игроку состояние и последствия действий. Если источник отмечает необычное решение, оно может быть полноценной частью анализа.
- Источники определяют факты и evidence, но не структуру статьи. Не пересказывай источники последовательно.
- Не пытайся использовать всё собранное. Для каждого тезиса и детали применяй критерий: «Помогает ли это понять, почему именно эта игра такая?» Если нет — выкидывай.

РЕДАКЦИОННЫЕ ПРАВИЛА
- Пиши естественным живым русским журнальным языком, без канцелярита, SEO-формул, AI-штампов и энциклопедического вступления.
- Начинай с конкретного опыта, ситуации, действия или центрального конфликта игры.
- Структура не универсальная: ${minSections}-${maxSections} непересекающихся разделов выбираются именно под эту игру. Никакого шаблона «сюжет → геймплей → графика → что устарело → итог».
- По заголовкам должно быть понятно, какой аспект игры разбирается. Выразительность допустима, если предмет раздела очевиден.
- Обзор evergreen: текущий год не является точкой отсчёта. Не делай обязательных разделов про «старение», «актуальность сегодня», «что потеряла за N лет» или пригодность для «современного игрока».
- Если конкретная механика неудобна или слаба, описывай саму проблему и её эффект на игру. Недостатки обсуждай органично внутри соответствующей системы, а не обязательным отдельным разделом «Минусы».
- Исторические сравнения используй точечно только тогда, когда они реально объясняют дизайнерское решение или место игры в своём времени. Фиксированный факт вроде «для игры 1992 года это было необычно» допустим; превращать обзор старой игры в статью о её возрасте нельзя.
- Механики описывай в настоящем времени независимо от года выхода: «Autolog связывает результаты друзей», а не «важной идеей был Autolog». Прошедшее время используй для исторического контекста и событий разработки/релиза.
- Запрещены редакционные штампы и формулы из blacklist: ${blacklistText}. Не используй и близкие искусственные формулировки.
- Не пересказывай рецензии по очереди и не упоминай процесс исследования в публичном тексте.
- Не выдумывай факты. Существенные проверяемые тезисы связывай с source_ids.
- Используй доступный канонический пакет источников по существу. Review Module получает его целиком и не выбрасывает официальные, фактологические или редакционные источники только из-за наличия профессиональных обзоров. Никакого требования ровно 10/20/любого другого числа источников нет.
- Не раскрывай крупные сюжетные повороты без необходимости.
- Общий объём: минимум ${minWords}, ориентир ${targetWords}, без редакторского разрешения не больше ${maxWords} содержательных слов.
- Каждый раздел: минимум ${minSectionWords} содержательных слов и минимум 3 нормальных абзаца.
- Финал не пересказывает предыдущие разделы и не сводит статью к списку плюсов/минусов. Он формулирует характер игры и оставляет послевкусие.
- verdict содержит только summary. best_for/not_for не создавай.

ANTI-GENERIC / EVERGREEN AUDIT ПЕРЕД ОТВЕТОМ
- Удали временные привязки к моменту написания и формулы про «возраст» игры, если временная дистанция не является содержанием анализа.
- Удали шаблонные заголовки и общие абзацы, которые можно без изменений вставить в обзор другой игры.
- Проверь, что характерные детали и интерфейсная обратная связь не потерялись за крупными общими тезисами.
- Проверь, что недостатки названы конкретно и встроены в разбор соответствующих систем.
- Проверь настоящее время механик и точность исторического контекста.
- Проверь, что финал — новый авторский вывод, а не краткое содержание статьи.

Верни ТОЛЬКО JSON:
{
  "title":"...",
  "dek":"...",
  "lead":"...",
  "sections":[{"id":"latin-kebab-id","heading":"...","paragraphs":["...","...","..."],"source_ids":["source-1"],"image_caption":"какой конкретный кадр нужен"}],
  "verdict":{"summary":"..."},
  "claim_sources":[{"claim":"...","source_ids":["source-1"]}],
  "used_source_ids":["source-1"]
}

ИГРА:
${JSON.stringify(identity,null,2)}

КАНОНИЧЕСКИЙ ПАКЕТ ИСТОЧНИКОВ:
${JSON.stringify(sourceDigest,null,2)}`;

const bannedPatterns=[/состарил(?:ось|ась|ись)\s+плохо/i,/выда[её]т\s+свой\s+возраст/i,/сегодня\s+ощущается/i,/по\s+(?:нынешним|современным)\s+меркам/i,/по\s+современным\s+стандартам/i,/для\s+современного\s+игрока/i,/современному\s+игроку/i,/\bигрово\b/i,/положенн\w*\s+на\s+рельсы\s+путешеств/i];
function auditDraft(draft){
  const sections=Array.isArray(draft?.sections)?draft.sections:[];
  const text=[draft?.lead,...sections.flatMap(section=>[section.heading,...(section.paragraphs||[])]),draft?.verdict?.summary].join('\n');
  const lower=text.toLowerCase();
  const errors=[];
  const words=countWords(text);
  if(sections.length<minSections||sections.length>maxSections)errors.push(`sections ${sections.length}/${minSections}-${maxSections}`);
  if(words<minWords)errors.push(`words ${words}/${minWords}`);
  if(words>maxWords)errors.push(`words ${words}/${maxWords} maximum without editor approval`);
  for(const phrase of evergreenBlacklist)if(lower.includes(phrase.toLowerCase()))errors.push(`evergreen blacklist: ${phrase}`);
  for(const pattern of bannedPatterns)if(pattern.test(text))errors.push(`evergreen violation: ${pattern}`);
  for(const section of sections){
    if(!section.id||!section.heading)errors.push('section without id/heading');
    if(!Array.isArray(section.paragraphs)||section.paragraphs.length<3)errors.push(`${section.id||'section'}: fewer than 3 paragraphs`);
    const sectionWords=countWords((section.paragraphs||[]).join(' '));
    if(sectionWords<minSectionWords)errors.push(`${section.id||'section'}: words ${sectionWords}/${minSectionWords}`);
    const ids=[...new Set(section.source_ids||[])].filter(id=>sourceIdSet.has(id));
    if(!ids.length)errors.push(`${section.id||'section'}: no canonical source ids`);
    section.source_ids=ids;
  }
  if(!draft?.verdict?.summary)errors.push('missing authorial verdict');
  if(draft?.verdict?.best_for?.length||draft?.verdict?.not_for?.length)errors.push('checklist verdict is forbidden');
  return {errors,words,sections};
}

let draft=null,audit=null,lastError=null,attemptsUsed=0;
for(let attempt=1;attempt<=maxAttempts;attempt++){
  attemptsUsed=attempt;
  try{
    const retryNote=attempt===1?'':`\n\nПредыдущая попытка этой же модели не прошла QC: ${audit?.errors?.join('; ')||lastError?.message||'unknown error'}. Перепиши материал целиком, исправив эти проблемы. Модель, провайдер и пакет источников остаются теми же.`;
    draft=await infer(prompt+retryNote);
    audit=auditDraft(draft);
    if(!audit.errors.length)break;
  }catch(error){lastError=error;if(attempt===maxAttempts)throw error}
}
if(!draft||!audit||audit.errors.length)throw new Error(`Review Skill v1 QC failed after ${attemptsUsed} same-model attempt(s): ${(audit?.errors||[lastError?.message||'unknown error']).join('; ')}`);

const used=[...new Set([...(draft.used_source_ids||[]),...(draft.claim_sources||[]).flatMap(item=>item.source_ids||[]),...audit.sections.flatMap(section=>section.source_ids||[])])].filter(id=>sourceIdSet.has(id));
const score=ratings.calculation?.score_10??ratings.score??game.ratings?.igropoisk??null;
const article={
  schema_version:11,
  review_skill_version:1,
  slug,
  game_slug:slug,
  game_id:game.identity?.game_id||game.game_id||sourcePack.game_id||null,
  title:draft.title,
  dek:draft.dek,
  author:'Редакция Игропоиска',
  published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),
  updated_at:checkedAt,
  score,
  hero:game.media?.hero||game.media?.cover||'',
  lead:draft.lead,
  reading_time_minutes:Math.max(5,Math.ceil(audit.words/190)),
  publication_status:'published',
  source_gate:{policy:'use-entire-available-canonical-corpus',available:sources.length,materially_used:used.length,passed:true,canonical_source_file:`data/game-sources/${slug}.json`},
  identity:{title:identity.title,developer:identity.developers.join(', '),publisher:identity.publishers.join(', '),release_date:game.release?.date_text||game.release?.date||'',genres:identity.genres,platforms:identity.platforms},
  sections:audit.sections.map(section=>({id:section.id,heading:section.heading,paragraphs:section.paragraphs,source_ids:section.source_ids,image_caption:section.image_caption||''})),
  verdict:{summary:draft.verdict.summary},
  claim_sources:(draft.claim_sources||[]).map(item=>({...item,source_ids:[...new Set(item.source_ids||[])].filter(id=>sourceIdSet.has(id))})),
  used_source_ids:used,
  sources:sources.map(source=>({id:source.id,name:source.publication||source.name,title:source.title||'',url:source.url,purpose:source.version_context||source.source_kind||source.kind||source.type||'Канонический источник'})),
  generation:{provider,model,model_owner:`${provider}:${model}`,attempts_used:attemptsUsed,same_model_attempts:maxAttempts,checked_at:checkedAt,source_pack:`data/game-sources/${slug}.json`,cross_model_fallback:false}
};
write(`data/article-drafts/${slug}.json`,article);
write(`data/articles/${slug}.json`,article);
write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'review-skill-v1',status:'success',game_slug:slug,checked_at:checkedAt,provider,model,model_owner:`${provider}:${model}`,attempts_used:attemptsUsed,cross_model_fallback:false,sections:audit.sections.length,words:audit.words,sources_available:sources.length,sources_used:used.length,output:`data/articles/${slug}.json`});
console.log(JSON.stringify({slug,status:'success',review_skill_version:1,provider,model,attempts_used:attemptsUsed,sections:audit.sections.length,words:audit.words,sources_available:sources.length,sources_used:used.length,cross_model_fallback:false},null,2));
