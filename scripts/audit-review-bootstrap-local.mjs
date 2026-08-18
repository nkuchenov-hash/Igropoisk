#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd();
const slugs=process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
if(!slugs.length)throw new Error('Usage: audit-review-bootstrap-local <slug...>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const textOf=article=>[
  article?.dek,article?.lead,
  ...(article?.sections||[]).flatMap(section=>[section?.heading,...(section?.paragraphs||[])]),
  article?.verdict?.summary,...(article?.verdict?.best_for||[]),...(article?.verdict?.not_for||[])
].filter(Boolean).join('\n');
const evidenceOf=review=>(review?.reviews||[]).filter(source=>source?.canonical_score_eligible!==false&&source?.source_kind==='review').map(source=>({
  id:source.id,publication:source.publication,language:source.language||'',
  evidence_points:(source.evidence_points||[]).slice(0,8),praise:(source.praise||[]).slice(0,3),criticism:(source.criticism||[]).slice(0,3),mechanics:(source.mechanics||[]).slice(0,4)
}));
const numbers=value=>[...String(value||'').matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/gu)].map(match=>match[0].replace(',','.'));
const lowerLatin=value=>[...String(value||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(match=>match[0]);
const schema={type:'object',additionalProperties:false,required:['natural_russian','translationese_absence','factual_grounding','specificity','editorial_voice','unsupported_claims','language_problems'],properties:{
  natural_russian:{type:'number',minimum:0,maximum:1},translationese_absence:{type:'number',minimum:0,maximum:1},factual_grounding:{type:'number',minimum:0,maximum:1},specificity:{type:'number',minimum:0,maximum:1},editorial_voice:{type:'number',minimum:0,maximum:1},unsupported_claims:{type:'array',items:{type:'string'}},language_problems:{type:'array',items:{type:'string'}}
}};
let failed=false;
for(const slug of slugs){
  const request=read(`data/game-enrichment-requests/${slug}.json`,{}),review=read(`data/reviews/${slug}.json`,{}),draft=read(`data/drafts/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
  if(request?.released===false||review?.review_score?.status!=='green'||!Number.isFinite(score)){
    console.log(JSON.stringify({slug,status:'skipped',reason:request?.released===false?'unreleased':'canonical_rating_not_green'},null,2));
    continue;
  }
  const article=read(`data/review-bootstrap/${slug}.json`);
  if(!article){console.error(`${slug}: bootstrap review missing for audit`);failed=true;continue}
  const prose=textOf(article),evidence=evidenceOf(review),evidenceText=JSON.stringify({identity:{title:draft?.identity?.title,release:draft?.release,developers:draft?.companies?.developers,publishers:draft?.companies?.publishers,genres:draft?.classification?.genres,platforms:draft?.classification?.platforms},evidence});
  const allowedNumbers=new Set([...numbers(evidenceText),String(score)]);
  const unsupportedNumbers=[...new Set(numbers(prose).filter(value=>!allowedNumbers.has(value)))];
  const latinIntrusions=[...new Set(lowerLatin(prose).filter(token=>!['fallout'].includes(token)))];
  const prompt=`Проведи строгий выпускающий фактчек и языковую редактуру короткого обзора игры. Текст должен звучать как оригинальный материал сильного русскоязычного игрового издания, а не как машинный перевод. Любое конкретное утверждение о механике, количестве, структуре мира, сюжете, управлении, визуале или аудитории должно прямо следовать из EVIDENCE/IDENTITY. Нельзя додумывать детали даже если они кажутся правдоподобными. Отдельно отмечай кальки, неграмотные словоформы, неуместные английские слова, бессмысленные или туманные формулировки. Высокая оценка factual_grounding допустима только если нет существенных неподтверждённых утверждений. Верни только JSON.\n\nТЕКСТ:\n${prose}\n\nIDENTITY + EVIDENCE:\n${evidenceText}`;
  let scores;
  try{scores=await chatJson({system:'Ты строгий русскоязычный выпускающий редактор и фактчекер. Не оправдывай слабый текст и не додумывай факты за автора.',prompt,schema,temperature:0.05,numCtx:16384,numPredict:1600,timeoutMs:420000})}
  catch(error){scores={natural_russian:0,translationese_absence:0,factual_grounding:0,specificity:0,editorial_voice:0,unsupported_claims:[error?.message||String(error)],language_problems:['audit_failed']}}
  const modelPassed=Number(scores.natural_russian)>=0.9&&Number(scores.translationese_absence)>=0.9&&Number(scores.factual_grounding)>=0.92&&Number(scores.specificity)>=0.85&&Number(scores.editorial_voice)>=0.88&&!(scores.unsupported_claims||[]).length&&!(scores.language_problems||[]).length;
  const deterministicPassed=!unsupportedNumbers.length&&!latinIntrusions.length;
  const passed=modelPassed&&deterministicPassed;
  const audit={passed,provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,checked_at:new Date().toISOString(),thresholds:{natural_russian:0.9,translationese_absence:0.9,factual_grounding:0.92,specificity:0.85,editorial_voice:0.88},scores,deterministic:{unsupported_numbers:unsupportedNumbers,lowercase_latin_intrusions:latinIntrusions}};
  article.generation={...(article.generation||{}),grounding_audit:audit,editorial_quality:{...(article.generation?.editorial_quality||{}),passed:Boolean(article.generation?.editorial_quality?.passed)&&passed,reasons:[...(article.generation?.editorial_quality?.reasons||[]),...(unsupportedNumbers.length?[`unsupported numeric claims: ${unsupportedNumbers.join(', ')}`]:[]),...(latinIntrusions.length?[`lowercase latin intrusions: ${latinIntrusions.join(', ')}`]:[]),...(!modelPassed?['factual/language audit failed']:[])]}};
  write(`data/review-bootstrap/${slug}.json`,article);
  write(`data/parser-runs/review-bootstrap-audit-${slug}.json`,{schema_version:1,game_slug:slug,...audit});
  console.log(JSON.stringify({slug,passed,scores,unsupported_numbers:unsupportedNumbers,lowercase_latin_intrusions:latinIntrusions},null,2));
  if(!passed)failed=true;
}
if(failed)process.exit(2);
