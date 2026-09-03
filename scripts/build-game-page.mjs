#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {generateFreeEditorialJSON,assertFreeEditorialAI} from './lib/free-editorial-ai.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const cyrillicRatio=v=>{const s=clean(v);const letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;return letters?(s.match(/[А-Яа-яЁё]/g)||[]).length/letters:0};
const draft=read(`data/drafts/${slug}.json`),parser=read(`data/parser-output/${slug}.json`,{}),corpus=read(`data/game-sources/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const sources=(corpus?.sources||[]).map(s=>({name:s.publication||s.name||s.source_name||'',title:s.title||'',url:s.resolved_url||s.url||'',kind:s.kind||'',roles:s.roles||[],score:s.score??s.original_score??null})).filter(s=>s.url);
if(!corpus?.discovery?.complete||!sources.length)throw new Error(`${slug}: completed canonical source discovery and a non-empty source corpus are required before editorial repair`);
const ai=await assertFreeEditorialAI();
const forbidden=[/построена как .*разработчик/i,/основной режим рассчитан/i,/ключевые механики здесь выводятся/i,/официальное описание указывает/i,/описание не добавляет/i,/структура прохождения описывается/i,/информация о которой собрана/i,/проверяемых каталогов/i,/official sources|verified catalogs/i];
const normalize=editorial=>({
  short_description:clean(editorial?.short_description),
  integrated_description:clean(editorial?.integrated_description),
  campaign:clean(editorial?.campaign),
  features:Array.isArray(editorial?.features)?editorial.features.map(clean).filter(Boolean):[]
});
const issuesFor=editorial=>{
  const issues=[];
  if(editorial.short_description.length<90)issues.push(`short_description слишком короткое: ${editorial.short_description.length}/90`);
  if(cyrillicRatio(editorial.short_description)<0.55)issues.push('short_description должно быть полноценным русским текстом');
  if(editorial.integrated_description.length<280)issues.push(`integrated_description слишком короткое: ${editorial.integrated_description.length}/280`);
  if(cyrillicRatio(editorial.integrated_description)<0.55)issues.push('integrated_description должно быть полноценным русским текстом');
  if(editorial.campaign.length<120)issues.push(`campaign слишком короткое: ${editorial.campaign.length}/120`);
  if(cyrillicRatio(editorial.campaign)<0.55)issues.push('campaign должно быть полноценным русским текстом');
  if(editorial.features.length<4)issues.push(`features: требуется минимум 4, получено ${editorial.features.length}`);
  editorial.features.forEach((item,index)=>{if(item.length<18)issues.push(`feature #${index+1} слишком короткая/общая: ${item.length}/18`)});
  for(const rx of forbidden){
    if(rx.test(editorial.short_description))issues.push(`short_description содержит запрещённый technical/generic шаблон: ${rx}`);
    if(rx.test(editorial.integrated_description))issues.push(`integrated_description содержит запрещённый technical/generic шаблон: ${rx}`);
    if(rx.test(editorial.campaign))issues.push(`campaign содержит запрещённый technical/generic шаблон: ${rx}`);
  }
  return issues;
};
const evidence=JSON.stringify({
  structured_facts:{identity:draft.identity,release:draft.release,companies:draft.companies,classification:draft.classification,requirements:draft.requirements,links:draft.links},
  official_editorial_seed:{
    short_description:parser?.editorial?.short_description||draft.editorial?.short_description||'',
    integrated_description:parser?.editorial?.integrated_description||draft.editorial?.integrated_description||'',
    features:parser?.editorial?.features||draft.editorial?.features||[],
    language:parser?.editorial?.language||'',
    source:parser?.source||null
  },
  canonical_sources:sources,
  ratings:ratings?.sources||[]
},null,2);
const baseRequirements=`Верни только JSON с полями short_description, integrated_description, campaign, features.\nТребования:\n- Только естественный русский язык, как у сильного живого игрового редактора.\n- short_description: 100–220 символов, сразу объясняет суть и отличительную черту игры.\n- integrated_description: минимум 350 символов; конкретно объясняет игровой цикл, мир или структуру, ключевые механики и чем игра выделяется.\n- campaign: минимум 150 символов; конкретно описывает роль игрока и структуру прохождения/сюжета либо содержательно объясняет отсутствие классической кампании.\n- features: массив из 4–8 конкретных особенностей; каждая полноценная русская фраза не короче 18 символов.\n- official_editorial_seed — проверенный текст структурированного официального источника. Его разрешено переводить, разворачивать и редакционно перерабатывать, но нельзя добавлять отсутствующие там факты по памяти модели.\n- canonical_sources подтверждают наличие материалов и оценок, но их заголовки/URL сами по себе не являются разрешением придумывать детали статьи.\n- Используй ТОЛЬКО факты из переданных проверенных данных. Не добавляй факты по памяти модели.\n- Не смешивай ремейки, ремастеры, DLC, продолжения и одноимённые игры.\n- Никаких технических фраз о парсинге, источниках, сборе данных или работе модели.\n- Запрещены формулы «построена как», «основной режим рассчитан», «ключевые механики здесь выводятся», «официальное описание указывает», «описание не добавляет», «информация собрана из источников».\n- Если факт нельзя подтвердить переданными данными, не используй его.`;
let prompt=`Напиши редакционный блок страницы игры ${draft.identity.title} для Игропоиска.\n\n${baseRequirements}\n\nПроверенные данные:\n${evidence}`;
let next=null,provider='ollama',model=ai.model,issues=[],attempts=[];
const maxAttempts=3;
for(let attempt=1;attempt<=maxAttempts;attempt++){
  const generated=await generateFreeEditorialJSON({system:'Ты русскоязычный игровой редактор. Пиши конкретно, естественно и фактологично. Возвращай только валидный JSON.',prompt,temperature:attempt===1?0.25:0.12});
  provider=generated.provider;model=generated.model;next=normalize(generated.data);issues=issuesFor(next);
  attempts.push({attempt,issues:[...issues],metrics:{short_description_chars:next.short_description.length,integrated_description_chars:next.integrated_description.length,campaign_chars:next.campaign.length,features:next.features.length,cyrillic:{short_description:Number(cyrillicRatio(next.short_description).toFixed(3)),integrated_description:Number(cyrillicRatio(next.integrated_description).toFixed(3)),campaign:Number(cyrillicRatio(next.campaign).toFixed(3))}}});
  if(!issues.length)break;
  prompt=`Исправь предыдущий кандидат редакционного блока страницы игры ${draft.identity.title}. Он не прошёл автоматическую проверку. Верни ПОЛНЫЙ исправленный JSON, а не отдельные поля.\n\nОшибки, которые обязательно надо исправить:\n- ${issues.join('\n- ')}\n\nПредыдущий кандидат:\n${JSON.stringify(next,null,2)}\n\n${baseRequirements}\n\nПроверенные данные:\n${evidence}`;
}
const checkedAt=new Date().toISOString();
if(issues.length){
  write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-editorial-builder',status:'needs_revision',game_slug:slug,checked_at:checkedAt,provider,model,paid_api:false,repair_attempts:attempts.length,attempts,source_corpus:`data/game-sources/${slug}.json`,source_count:sources.length,official_editorial_seed_used:true,output:`data/drafts/${slug}.json`});
  throw new Error(`Free Qwen editorial remained invalid after ${attempts.length} attempt(s): ${issues.join('; ')}`);
}
draft.editorial={...(draft.editorial||{}),...next};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'editorial_generated_pending_qc'};
draft.updated_at=checkedAt;
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-editorial-builder',status:'completed_pending_qc',game_slug:slug,checked_at:checkedAt,provider,model,paid_api:false,repair_attempts:attempts.length,attempts,source_corpus:`data/game-sources/${slug}.json`,source_count:sources.length,official_editorial_seed_used:true,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider,model,paid_api:false,sources:sources.length,repair_attempts:attempts.length,official_editorial_seed_used:true,public_ready:false},null,2));
