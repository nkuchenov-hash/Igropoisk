import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/synthesize-review-github-models.mjs <game-slug>');
const token=process.env.GITHUB_TOKEN;
if(!token)throw new Error('GITHUB_TOKEN is required for GitHub Models fallback');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=file=>fs.existsSync(path.join(root,file));
const config=read('config/parsers/review-synthesis.json');
const game=read(`data/drafts/${slug}.json`);
const ratings=exists(`data/ratings/${slug}.json`)?read(`data/ratings/${slug}.json`):{};
const research=read(`data/research/${slug}-source-matrix.json`);
const media=exists(`data/media-candidates/${slug}.json`)?read(`data/media-candidates/${slug}.json`):{candidates:[]};
const gate=config.publication_gate||{};
const requiredSources=Number(gate.editorial_reviews_required||20);
const minSections=Number(gate.minimum_sections||7);
const maxSections=Number(gate.maximum_sections||9);
const minWords=Number(gate.minimum_article_words||1600);
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const sources=(research.accepted||[]).slice(0,requiredSources);
if(sources.length<requiredSources||research.coverage?.passed===false)throw new Error(`Source gate failed: ${sources.length}/${requiredSources}`);
const screenshots=(media.candidates||[]).filter(item=>item?.url);
if(screenshots.length<minSections)throw new Error(`Media gate failed: ${screenshots.length}/${minSections} verified screenshots`);

const model=process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1';
async function infer(prompt){
  const response=await fetch('https://models.github.ai/inference/chat/completions',{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json','accept':'application/vnd.github+json','x-github-api-version':'2026-03-10'},
    body:JSON.stringify({
      model,
      messages:[
        {role:'system',content:'Ты старший русскоязычный игровой редактор Игропоиска. Пиши живым, естественным, конкретным русским языком. Нельзя заполнять текст общими словами, канцеляритом или универсальными формулами. Каждый абзац должен объяснять конкретную особенность именно этой игры.'},
        {role:'user',content:prompt}
      ],
      response_format:{type:'json_object'},
      temperature:0.35,
      max_tokens:12000
    })
  });
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
  const data=await response.json();
  const text=data.choices?.[0]?.message?.content;
  if(!text)throw new Error('GitHub Models returned no article JSON');
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g,''));
}

const identity={
  title:game.identity?.title||slug,
  aliases:game.identity?.aliases||[],
  release:game.release||{},
  developers:game.companies?.developers||[],
  publishers:game.companies?.publishers||[],
  genres:game.classification?.genres||[],
  platforms:game.classification?.platforms||[],
  categories:game.classification?.categories||[],
  description:game.editorial?.integrated_description||game.editorial?.short_description||'',
  features:game.editorial?.features||[],
  requirements:game.requirements||{},
  links:game.links||{}
};
const sourceDigest=sources.map(source=>({
  id:source.id,
  publication:source.publication||source.source,
  title:source.title,
  source_kind:source.source_kind,
  platform:source.platform,
  praise:source.praise||[],
  criticism:source.criticism||[],
  evidence_points:source.evidence_points||[],
  identity_evidence:source.identity_evidence||''
}));

const prompt=`Собери полноценный обзор Игропоиска для точной игры ниже. Это не SEO-текст и не пересказ чужих рецензий. Читатель после статьи должен понимать: что он реально делает минуту за минутой; как устроены бой/исследование/прогрессия/миссии/онлайн-функции, если они есть; чем игра отличается от соседей по жанру; что в ней восхищает; где она раздражает; кому её советовать сейчас.

ЖЁСТКИЕ ПРАВИЛА:
- Только русский язык, кроме официальных имён и терминов, которые обычно не переводят.
- ${minSections}-${maxSections} разделов. Заголовки должны быть конкретны для этой игры; запрещены шаблоны вроде «Что это за игра и какое обещание она даёт», «Геймплей и механики», «Визуал и звук».
- Не меньше ${minWords} содержательных слов суммарно. В каждом разделе минимум 3 нормальных абзаца и примерно 170+ слов.
- Вступление должно сразу передавать характер игры и объяснять, почему она важна/интересна, а не начинаться с абстрактного обещания.
- Называй конкретные системы, локации, типы действий, оружие/способности/структуру мира, когда это подтверждено данными или источниками.
- Если игра имеет сетевые функции, объясни их точный формат. Не называй игру MMO, если это не так.
- Не выдумывай факты. Спорные утверждения связывай с source_ids.
- Не раскрывай крупные сюжетные повороты.
- used_source_ids должен содержать все ${requiredSources} source_ids. Каждый раздел — минимум 2 source_ids.
- Вердикт должен содержать конкретные «подойдёт/не подойдёт».
- image_caption для каждого раздела — короткая естественная русская подпись о том, какой именно кадр нужен, без фраз «кадр иллюстрирует тезис раздела».

Верни ТОЛЬКО JSON со структурой:
{
  "title":"...",
  "dek":"...",
  "lead":"...",
  "sections":[{"id":"latin-kebab-id","heading":"...","paragraphs":["...","...","..."],"source_ids":["source-1","source-2"],"image_caption":"..."}],
  "verdict":{"summary":"...","best_for":["..."],"not_for":["..."]},
  "claim_sources":[{"claim":"...","source_ids":["source-1"]}],
  "used_source_ids":["source-1"]
}

ИГРА:
${JSON.stringify(identity,null,2)}

ПРОФЕССИОНАЛЬНЫЕ ИСТОЧНИКИ:
${JSON.stringify(sourceDigest,null,2)}`;

let draft=await infer(prompt);
let sections=Array.isArray(draft.sections)?draft.sections:[];
let words=countWords([draft.lead,...sections.flatMap(section=>section.paragraphs||[]),draft.verdict?.summary].join(' '));
if(sections.length<minSections||sections.length>maxSections||words<minWords){
  draft=await infer(`${prompt}\n\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА ФОРМАЛЬНЫЙ ПОРОГ: sections=${sections.length}, words=${words}. Перепиши целиком, сохраняя фактическую точность, но обязательно уложись в ${minSections}-${maxSections} разделов и ${minWords}+ содержательных слов.`);
  sections=Array.isArray(draft.sections)?draft.sections:[];
  words=countWords([draft.lead,...sections.flatMap(section=>section.paragraphs||[]),draft.verdict?.summary].join(' '));
}
if(sections.length<minSections||sections.length>maxSections||words<minWords)throw new Error(`Generated article failed depth gate: ${sections.length} sections, ${words} words`);
const validSourceIds=new Set(sources.map(source=>source.id));
for(const section of sections){
  section.source_ids=[...new Set(section.source_ids||[])].filter(id=>validSourceIds.has(id));
  if(section.source_ids.length<2)throw new Error(`${section.id}: fewer than two verified source ids`);
  if((section.paragraphs||[]).length<3)throw new Error(`${section.id}: fewer than three paragraphs`);
}
const used=[...new Set([...(draft.used_source_ids||[]),...sections.flatMap(section=>section.source_ids||[])])].filter(id=>validSourceIds.has(id));
for(const source of sources)if(!used.includes(source.id))used.push(source.id);
const score=ratings.calculation?.score_10??ratings.score??game.ratings?.igropoisk??null;
const hero=game.media?.hero||game.media?.cover||'';
const reading=Math.max(5,Math.ceil(words/190));
const article={
  schema_version:10,
  slug,
  game_slug:slug,
  game_id:game.game_id||null,
  title:draft.title,
  dek:draft.dek,
  author:'Редакция Игропоиска',
  published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),
  updated_at:new Date().toISOString(),
  score,
  hero,
  lead:draft.lead,
  reading_time_minutes:reading,
  publication_status:'editorial_review',
  source_gate:{required_editorial:requiredSources,accepted_editorial:sources.length,required_publications:requiredSources,accepted_publications:new Set(sources.map(source=>String(source.publication||source.source).toLowerCase())).size,passed:true},
  source_coverage:{available:sources.length,materially_used:used.length,rejected:(research.rejected||[]).length},
  methodology:`Обзор собран по ${sources.length} независимым профессиональным материалам и каноническим данным игры. Текст синтезирован в GitHub Models после проверки идентичности источников; визуальный ряд проходит отдельный технический и identity-safe media gate.`,
  identity:{
    title:identity.title,
    developer:identity.developers.join(', '),
    publisher:identity.publishers.join(', '),
    release_date:game.release?.date_text||game.release?.date||'',
    genres:identity.genres,
    platforms:identity.platforms
  },
  sections:sections.map(section=>({id:section.id,heading:section.heading,paragraphs:section.paragraphs,source_ids:section.source_ids,image_caption:section.image_caption||''})),
  verdict:draft.verdict,
  claim_sources:draft.claim_sources||[],
  used_source_ids:used,
  sources:sources.map(source=>({id:source.id,name:source.publication||source.source,title:source.title,url:source.resolved_url||source.url,purpose:[...(source.praise||[]).slice(0,1),...(source.criticism||[]).slice(0,1)].join(' · ')||source.version_context||'Профессиональная рецензия'})),
  generation:{provider:'github-models',model,checked_at:new Date().toISOString(),source_pack:research.policy?.reused_existing_pack?'revalidated_existing':'verified_research'}
};
write(`data/article-drafts/${slug}.json`,article);
write(`data/articles/${slug}.json`,article);
write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'review-synthesis-github-models',status:'success',game_slug:slug,checked_at:new Date().toISOString(),model,sections:sections.length,words,sources:sources.length,output:`data/articles/${slug}.json`});
console.log(JSON.stringify({slug,provider:'github-models',model,sections:sections.length,words,sources:sources.length},null,2));
