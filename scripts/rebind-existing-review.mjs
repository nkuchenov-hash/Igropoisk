#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/rebind-existing-review.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const words=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonicalUrl=value=>{try{const u=new URL(String(value||''));u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ftag'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}`}catch{return String(value||'')}};
const pubKey=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');

const review=read(`data/reviews/${slug}.json`);
const research=read(`data/research/${slug}-source-matrix.json`);
const quality=read('config/game-page-quality-v2.json',{});
const mediaPolicy=read('config/parsers/review-media-policy.json',{});
const articlePath=`data/articles/${slug}.json`,draftPath=`data/article-drafts/${slug}.json`;
const article=read(articlePath,read(draftPath));
if(!review||!research||!article) throw new Error(`Missing review/research/article for ${slug}`);
const score=Number(review.review_score?.calculation?.score_10);
if(review.publication_gate?.status!=='green'||review.review_score?.status!=='green'||!Number.isFinite(score)) throw new Error('Canonical corpus and review_score must be green before rebind');

const accepted=research.accepted||[];
const minSources=Number(quality.review_corpus?.minimum_sources||5);
const minSections=Number(mediaPolicy.article_balance?.minimum_sections||7);
const minWords=Number(mediaPolicy.article_balance?.minimum_words||1600);
if(accepted.length<minSources) throw new Error(`Canonical corpus ${accepted.length}/${minSources}`);
const articleWords=words([article.lead,...(article.sections||[]).flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
if((article.sections||[]).length<minSections||articleWords<minWords) throw new Error(`Existing article is not substantive enough for score-only rebind: sections=${article.sections?.length||0}/${minSections}, words=${articleWords}/${minWords}`);

// The article may intentionally cite a readable subset of the full review corpus. Keep its stable source IDs
// and prove each source still resolves to an accepted canonical publisher instead of re-numbering every section.
const acceptedByUrl=new Map(accepted.map(source=>[canonicalUrl(source.resolved_url||source.url),source]));
const acceptedByPub=new Map(accepted.map(source=>[pubKey(source.publication||source.source),source]));
const oldSources=Array.isArray(article.sources)?article.sources:[];
const reboundSources=[];
const validOldIds=new Set();
for(let index=0;index<oldSources.length;index++){
  const source=oldSources[index],oldId=String(source.id||`source-${index+1}`),match=acceptedByUrl.get(canonicalUrl(source.url))||acceptedByPub.get(pubKey(source.name||source.publication));
  if(!match) continue;
  validOldIds.add(oldId);
  reboundSources.push({...source,id:oldId,name:match.publication||match.source||source.name,title:match.title||source.title,url:match.resolved_url||match.url||source.url,configured_source_id:match.configured_source_id||null});
}
const invalidSections=(article.sections||[]).filter(section=>{
  const ids=(section.source_ids||[]).filter(id=>validOldIds.has(String(id)));
  return ids.length<2;
}).map(section=>section.id||section.heading);
if(invalidSections.length) throw new Error(`Existing article citations no longer resolve to two accepted publishers in sections: ${invalidSections.join(', ')}`);

article.sources=reboundSources;
article.used_source_ids=(article.used_source_ids||[]).filter(id=>validOldIds.has(String(id)));
article.claim_sources=(article.claim_sources||[]).map(item=>({...item,source_ids:(item.source_ids||[]).filter(id=>validOldIds.has(String(id)))})).filter(item=>item.source_ids.length);
article.score=score;
article.score_source=`data/reviews/${slug}.json#review_score`;
article.score_method=review.review_score.method;
article.score_sources=review.review_score.sources;
article.methodology=`Текст опирается на ${reboundSources.length} проверенных рецензий из полного канонического корпуса из ${accepted.length} источников. Оценка ${score} — арифметическое среднее всех явных оценок канонической версии, найденных среди зарегистрированных профессиональных изданий.`;
article.publication_status='editorial_review';
article.quality_status='reviewing';
article.updated_at=new Date().toISOString();
article.generation={...(article.generation||{}),score_rebound_at:article.updated_at,score_source:article.score_source,prose_regenerated:false};
write(articlePath,article);write(draftPath,article);

function run(script,args=[]){return spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:24*1024*1024})}
const language=run('scripts/audit-review-language-local.mjs',[slug]);
if(language.status!==0){console.error(`${slug}: local language audit failed`);process.exit(2)}
const validation=run('scripts/validate-review-output.mjs',[slug]);
if(validation.status!==0){console.error(`${slug}: review output validation failed`);process.exit(2)}
const finalArticle=read(articlePath);
finalArticle.publication_status='published';finalArticle.quality_status='green';finalArticle.quality_comment='Existing substantive article retained; only canonical source binding and review-owned score were synchronized.';finalArticle.updated_at=new Date().toISOString();
write(articlePath,finalArticle);write(draftPath,finalArticle);
write(`data/parser-runs/review-rebind-${slug}.json`,{parser:'review-score-surgical-rebind-v2',status:'green',game_slug:slug,checked_at:finalArticle.updated_at,score,full_corpus_sources:accepted.length,article_sources:reboundSources.length,words:articleWords,sections:article.sections.length,prose_regenerated:false});
console.log(JSON.stringify({slug,status:'green',score,full_corpus_sources:accepted.length,article_sources:reboundSources.length,words:articleWords,sections:article.sections.length,prose_regenerated:false},null,2));
