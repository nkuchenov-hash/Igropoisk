#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';
import {githubChatJson,GITHUB_AUDIT_MODEL} from './lib/github-editorial-model.mjs';

const root=process.cwd();
const slugs=process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
if(!slugs.length)throw new Error('Usage: audit-review-bootstrap-local <slug...>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const textOf=article=>[article?.dek,article?.lead,...(article?.sections||[]).flatMap(section=>[section?.heading,...(section?.paragraphs||[])]),article?.verdict?.summary,...(article?.verdict?.best_for||[]),...(article?.verdict?.not_for||[])].filter(Boolean).join('\n');
const numbers=value=>[...String(value||'').matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/gu)].map(match=>match[0].replace(',','.'));
const lowerLatin=value=>[...String(value||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(match=>match[0]);
const schema={type:'object',additionalProperties:false,required:['natural_russian','translationese_absence','factual_grounding','specificity','editorial_voice','unsupported_claims','language_problems','quality_problems'],properties:{natural_russian:{type:'boolean'},translationese_absence:{type:'boolean'},factual_grounding:{type:'boolean'},specificity:{type:'boolean'},editorial_voice:{type:'boolean'},unsupported_claims:{type:'array',items:{type:'string'}},language_problems:{type:'array',items:{type:'string'}},quality_problems:{type:'array',items:{type:'string'}}}};
let failed=false;
for(const slug of slugs){
  const request=read(`data/game-enrichment-requests/${slug}.json`,{}),review=read(`data/reviews/${slug}.json`,{}),draft=read(`data/drafts/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10),article=read(`data/review-bootstrap/${slug}.json`);
  if(request?.released===false||review?.review_score?.status!=='green'||!Number.isFinite(score)){console.log(JSON.stringify({slug,status:'skipped',reason:request?.released===false?'unreleased':'canonical_rating_not_green'},null,2));continue}
  if(!article){console.error(`${slug}: bootstrap review missing for audit`);failed=true;continue}
  const citedIds=new Set((article.sections||[]).flatMap(section=>section.source_ids||[]).filter(Boolean));
  const cited=(review.reviews||[]).filter(source=>source?.canonical_score_eligible!==false&&source?.source_kind==='review'&&citedIds.has(source.id)).slice(0,6);
  const citedPublications=new Set(cited.map(source=>String(source.publication||'').trim().toLowerCase()).filter(Boolean));
  if(cited.length<3||citedPublications.size<3){console.error(`${slug}: factual audit requires 3 cited independent professional sources; got ${cited.length}/${citedPublications.size}`);failed=true;continue}
  const evidence=cited.map(source=>({id:source.id,publication:source.publication,language:source.language||'',evidence_points:(source.evidence_points||[]).slice(0,5),praise:(source.praise||[]).slice(0,2),criticism:(source.criticism||[]).slice(0,2),mechanics:(source.mechanics||[]).slice(0,3)}));
  const identity={title:draft?.identity?.title,release:draft?.release,developers:draft?.companies?.developers,publishers:draft?.companies?.publishers,genres:draft?.classification?.genres,platforms:draft?.classification?.platforms};
  const prose=textOf(article),evidenceText=JSON.stringify({identity,evidence});
  const unsupportedNumbers=[...new Set(numbers(prose).filter(value=>value!==String(score)&&!evidenceText.includes(value)))],latinIntrusions=[...new Set(lowerLatin(prose).filter(token=>!['fallout'].includes(token)))];
  const prompt=`Проведи строгий выпускающий фактчек и языковую проверку короткого обзора. Проверяй ТОЛЬКО текст против IDENTITY и тех EVIDENCE, на которые статья сама ссылается. Любая конкретная механика, число, количество, имя, место, сюжетная деталь или характеристика должна прямо следовать из доказательств. Одновременно проверь, звучит ли текст как оригинальная работа сильного русскоязычного игрового редактора: без кальки, машинных оборотов, канцелярита, бессмысленных фраз и ненужного английского.\n\nВерни пять независимых boolean-критериев: natural_russian=true только если русский естественный; translationese_absence=true только если нет переводной кальки; factual_grounding=true только если все существенные факты подтверждены; specificity=true только если текст конкретен; editorial_voice=true только если подача редакционная и профессиональная. Итоговый passed вычислит программа сама. Массивы проблем используются ТОЛЬКО для объяснения соответствующего false: unsupported_claims — только если factual_grounding=false; language_problems — только если natural_russian=false или translationese_absence=false; quality_problems — только если specificity=false или editorial_voice=false. Если соответствующий критерий true, его problem-массив ОБЯЗАН быть пустым. Если ставишь false, ОБЯЗАТЕЛЬНО укажи хотя бы одну конкретную проблему соответствующей категории. Не наказывай текст за то, что он не пересказывает всё из источников; оцени только написанные утверждения. Если IDENTITY прямо содержит год, платформу, разработчика или издателя, это считается подтверждением. Верни только JSON.\n\nТЕКСТ:\n${prose}\n\nIDENTITY + CITED EVIDENCE:\n${evidenceText}`;
  const requestedProvider=String(process.env.EDITORIAL_PROVIDER||'github').toLowerCase();
  let verdict,provider,model;
  try{
    if(requestedProvider==='local'){
      verdict=await chatJson({system:'Ты строгий русскоязычный выпускающий редактор и фактчекер. Boolean-критерии — источник решения; problem-массивы только объясняют соответствующий false и должны быть пустыми при true.',prompt,schema,temperature:0.02,numCtx:6144,numPredict:700,timeoutMs:240000});
      provider='local-ollama';model=LOCAL_EDITORIAL_MODEL;
    }else{
      verdict=await githubChatJson({system:'Ты строгий выпускающий русскоязычный редактор и фактчекер. Проверяй только предоставленный текст против предоставленных доказательств; не используй внешние знания.',prompt,model:GITHUB_AUDIT_MODEL,temperature:0.02,maxTokens:1200,timeoutMs:75000});
      provider='github-models';model=GITHUB_AUDIT_MODEL;
    }
  }catch(error){verdict={natural_russian:false,translationese_absence:false,factual_grounding:false,specificity:false,editorial_voice:false,unsupported_claims:[error?.message||String(error)],language_problems:['audit_failed'],quality_problems:['audit_failed']};provider=requestedProvider==='local'?'local-ollama':'github-models';model=requestedProvider==='local'?LOCAL_EDITORIAL_MODEL:GITHUB_AUDIT_MODEL}
  const criteria={natural_russian:verdict.natural_russian===true,translationese_absence:verdict.translationese_absence===true,factual_grounding:verdict.factual_grounding===true,specificity:verdict.specificity===true,editorial_voice:verdict.editorial_voice===true};
  const rawUnsupported=Array.isArray(verdict.unsupported_claims)?verdict.unsupported_claims:[],rawLanguage=Array.isArray(verdict.language_problems)?verdict.language_problems:[],rawQuality=Array.isArray(verdict.quality_problems)?verdict.quality_problems:[];
  const effectiveUnsupported=criteria.factual_grounding?[]:rawUnsupported;
  const effectiveLanguage=(criteria.natural_russian&&criteria.translationese_absence)?[]:rawLanguage;
  const effectiveQuality=(criteria.specificity&&criteria.editorial_voice)?[]:rawQuality;
  const missingReasons=[];
  if(!criteria.factual_grounding&&!effectiveUnsupported.length)missingReasons.push('factual_grounding=false without unsupported_claims');
  if((!criteria.natural_russian||!criteria.translationese_absence)&&!effectiveLanguage.length)missingReasons.push('language criterion=false without language_problems');
  if((!criteria.specificity||!criteria.editorial_voice)&&!effectiveQuality.length)missingReasons.push('quality criterion=false without quality_problems');
  const modelPassed=Object.values(criteria).every(Boolean)&&missingReasons.length===0,deterministicPassed=!unsupportedNumbers.length&&!latinIntrusions.length,passed=modelPassed&&deterministicPassed,now=new Date().toISOString();
  const audit={passed,provider,model,checked_at:now,criteria,verdict:{unsupported_claims:effectiveUnsupported,language_problems:effectiveLanguage,quality_problems:effectiveQuality,discarded_advisory_issues:{unsupported_claims:criteria.factual_grounding?rawUnsupported:[],language_problems:(criteria.natural_russian&&criteria.translationese_absence)?rawLanguage:[],quality_problems:(criteria.specificity&&criteria.editorial_voice)?rawQuality:[]},missing_reasons:missingReasons},deterministic:{unsupported_numbers:unsupportedNumbers,lowercase_latin_intrusions:latinIntrusions},evidence_scope:{cited_sources:cited.length,cited_publications:citedPublications.size}};
  article.publication_status=passed?'published':'needs_revision';article.quality_status=passed?'green':'needs_revision';article.updated_at=now;article.generation={...(article.generation||{}),grounding_audit:audit,editorial_quality:{...(article.generation?.editorial_quality||{}),passed:Boolean(article.generation?.editorial_quality?.passed)&&passed,reasons:[...(article.generation?.editorial_quality?.reasons||[]),...(unsupportedNumbers.length?[`unsupported numeric claims: ${unsupportedNumbers.join(', ')}`]:[]),...(latinIntrusions.length?[`lowercase latin intrusions: ${latinIntrusions.join(', ')}`]:[]),...missingReasons,...(!modelPassed&&!missingReasons.length?['factual/language criteria failed']:[])]}};
  write(`data/review-bootstrap/${slug}.json`,article);write(`data/parser-runs/review-bootstrap-audit-${slug}.json`,{schema_version:5,game_slug:slug,...audit});console.log(JSON.stringify({slug,passed,provider,model,criteria:audit.criteria,verdict:audit.verdict,unsupported_numbers:unsupportedNumbers,lowercase_latin_intrusions:latinIntrusions,cited_sources:cited.length},null,2));if(!passed)failed=true;
}
if(failed)process.exit(2);
