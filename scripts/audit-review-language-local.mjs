#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chatJson, LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd(),slug=process.argv[2];
if(!slug)throw new Error('Usage: audit-review-language-local <slug>');
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),'utf8'));
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const article=read(`data/articles/${slug}.json`),review=read(`data/reviews/${slug}.json`),quality=read('config/game-page-quality-v2.json'),policy=quality.editorial_language||{},thresholds={natural_russian:Number(policy.minimum_natural_russian||0.8),editorial_voice:Number(policy.minimum_editorial_voice||0.8),translationese_absence:0.8,source_grounding:Number(policy.minimum_source_grounding||0.8),specificity:0.8};
const evidence=(review.reviews||[]).map(s=>({id:s.id,publication:s.publication,language:s.language||'',evidence_points:(s.evidence_points||[]).slice(0,6),praise:(s.praise||[]).slice(0,4),criticism:(s.criticism||[]).slice(0,4),mechanics:(s.mechanics||[]).slice(0,5)}));
const prose={title:article.title,dek:article.dek,lead:article.lead,sections:(article.sections||[]).map(s=>({heading:s.heading,paragraphs:s.paragraphs,source_ids:s.source_ids})),verdict:article.verdict};
const proseHash=crypto.createHash('sha256').update(JSON.stringify(prose)).digest('hex');
const previousPath=path.join(root,'data/parser-runs',`review-language-${slug}.json`);
if(fs.existsSync(previousPath)){
  const previous=JSON.parse(fs.readFileSync(previousPath,'utf8'));
  if(previous.passed===true&&previous.article_prose_sha256===proseHash){console.log(JSON.stringify({slug,passed:true,reused:true,article_prose_sha256:proseHash},null,2));process.exit(0)}
}
const schema={type:'object',additionalProperties:false,required:['natural_russian','editorial_voice','translationese_absence','source_grounding','specificity','problems'],properties:{natural_russian:{type:'number',minimum:0,maximum:1},editorial_voice:{type:'number',minimum:0,maximum:1},translationese_absence:{type:'number',minimum:0,maximum:1},source_grounding:{type:'number',minimum:0,maximum:1},specificity:{type:'number',minimum:0,maximum:1},problems:{type:'array',items:{type:'string'}}}};
const prompt=`Оцени качество готового русскоязычного игрового обзора как строгий выпускающий редактор. Проверь естественность русского языка, цельность авторской подачи, отсутствие буквальных переводных конструкций, конкретность и опору утверждений на source_ids/evidence. Высокие значения допустимы только для текста, который звучит как оригинальная работа опытного русскоязычного игрового журналиста. Верни только JSON по заданной схеме.\n\nТЕКСТ:\n${JSON.stringify(prose)}\n\nEVIDENCE:\n${JSON.stringify(evidence)}`;
const scores=await chatJson({system:'Ты строгий выпускающий редактор русскоязычного игрового издания. Не завышай оценки качества.',prompt,schema,temperature:0.1,numPredict:2500});
const passed=Object.entries(thresholds).every(([k,v])=>Number(scores[k])>=v),report={schema_version:2,game_slug:slug,checked_at:new Date().toISOString(),passed,provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,article_prose_sha256:proseHash,thresholds,scores};write(`data/parser-runs/review-language-${slug}.json`,report);console.log(JSON.stringify({slug,passed,model:LOCAL_EDITORIAL_MODEL,scores},null,2));if(!passed)process.exitCode=2;
