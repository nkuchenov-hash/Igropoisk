#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requestedSlug=String(process.argv[2]||'').trim();
const articlesDir=path.join(root,'data/articles');
if(!fs.existsSync(articlesDir))process.exit(0);
const config=JSON.parse(fs.readFileSync(path.join(root,'config/parsers/review-synthesis.json'),'utf8'));
const policy=config.editorial_policy||{};
const blacklist=(policy.evergreen_blacklist||[]).map(value=>String(value).toLowerCase());
const genericHeadings=[/^геймплей(?: и механики)?$/i,/^визуал(?: и звук)?$/i,/^сюжет(?: и персонажи)?$/i,/^итог(?:и)?$/i,/^плюсы и минусы$/i,/^что это за игра/i];
const files=requestedSlug?[`${requestedSlug}.json`]:fs.readdirSync(articlesDir).filter(name=>name.endsWith('.json'));
let failed=false;
for(const name of files){
  const target=path.join(articlesDir,name);
  if(!fs.existsSync(target)){console.error(`${name}: article not found`);failed=true;continue}
  const article=JSON.parse(fs.readFileSync(target,'utf8'));
  const sections=article.sections||[];
  const text=[article.title,article.dek,article.lead,...sections.flatMap(section=>[section.heading,...(section.paragraphs||[])]),article.verdict?.summary].join('\n');
  const lower=text.toLowerCase();
  const errors=[];
  for(const phrase of blacklist)if(lower.includes(phrase))errors.push(`evergreen blacklist: ${phrase}`);
  for(const section of sections){
    const heading=String(section.heading||'').trim();
    if(!heading)errors.push(`${section.id||'section'}: missing heading`);
    if(genericHeadings.some(pattern=>pattern.test(heading)))errors.push(`${section.id||'section'}: generic heading "${heading}"`);
    if(!(section.source_ids||[]).length)errors.push(`${section.id||'section'}: no canonical source ids`);
  }
  if(article.verdict?.best_for?.length||article.verdict?.not_for?.length)errors.push('public best_for/not_for checklist is forbidden by Review Skill v1');
  if(!article.verdict?.summary)errors.push('missing authorial verdict');
  if(article.generation?.cross_model_fallback!==false)errors.push('cross-model fallback must be explicitly false');
  if(article.source_gate?.policy!=='use-entire-available-canonical-corpus')errors.push('article is not bound to use-entire-available-canonical-corpus policy');
  const canonicalFile=String(article.source_gate?.canonical_source_file||article.generation?.source_pack||'');
  if(canonicalFile!==`data/game-sources/${article.game_slug||article.slug}.json`)errors.push(`unexpected canonical source file: ${canonicalFile||'missing'}`);
  if(/\b(источник(?:и|ов)? показал|по данным нашего исследования|мы собрали \d+ (?:обзор|источник)|source[_ -]?id)\b/i.test(text))errors.push('research/process leakage in public prose');
  const report={validator:'review-editorial-v1',review_skill_version:1,slug:article.slug,checked_at:new Date().toISOString(),passed:errors.length===0,sections:sections.length,canonical_source_file:canonicalFile,cross_model_fallback:article.generation?.cross_model_fallback,errors};
  const reportPath=path.join(root,'data/parser-runs',`review-editorial-v1-${article.slug}.json`);
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  if(errors.length){failed=true;console.error(`${article.slug}: Review Skill v1 blocked\n- ${errors.join('\n- ')}`)}
  else console.log(`${article.slug}: Review Skill v1 editorial QC passed`);
}
if(failed)process.exit(2);
