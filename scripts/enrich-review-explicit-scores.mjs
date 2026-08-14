#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,registeredEditorialSource,classifyReviewPage,classifyCanonicalVersion} from './lib/review-source-registry.mjs';
import {extractExplicitEditorialScore,isTrustedEditorialScore,buildEditorialScoreEvidence} from './lib/review-score-extractor.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/enrich-review-explicit-scores.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const visible=html=>String(html||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

const reviewPath=`data/reviews/${slug}.json`,researchPath=`data/research/${slug}-source-matrix.json`;
const review=read(reviewPath),research=read(researchPath),game=read(`data/drafts/${slug}.json`),cfg=read('config/parsers/review-synthesis.json');
if(!review||!research||!game||!cfg)throw new Error(`Missing canonical review research/game draft for ${slug}`);
const registry=loadReviewSourceRegistry(cfg.source_registry),timeout=Number(process.env.REVIEW_SCORE_FETCH_TIMEOUT_MS||10000);

async function fetchRating(item){
  const source=registeredEditorialSource(registry,item),url=item.resolved_url||item.url;
  if(!source||!/^https?:\/\//i.test(String(url||'')))return{rating:null,reason:'invalid_source_or_url'};
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskScoreAudit/5.0)','accept-language':'en,ru;q=.8'}});
    if(!response.ok)return{rating:null,reason:`http_${response.status}`,blocked:[401,403,408,425,429,451,500,502,503,504].includes(response.status)};
    const html=await response.text(),finalUrl=response.url||url,title=visible((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)||[])[1]||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||item.title||'');
    const pageClass=classifyReviewPage(source,{url:finalUrl,title,bodyText:visible(html).slice(0,5000)});
    if(!pageClass.accepted)return{rating:null,reason:pageClass.reason,finalUrl,title,pageClass};
    const version=classifyCanonicalVersion({title,url:finalUrl,versionContext:item.version_context||'',game});
    const rating=extractExplicitEditorialScore(html,source);
    return{rating,reason:rating?'explicit_editorial_score_found':'no_explicit_editorial_score',finalUrl,title,version,pageClass};
  }catch(error){return{rating:null,reason:error.message,blocked:true}}
}

const accepted=(research.accepted||[]).filter(item=>registeredEditorialSource(registry,item));
const updates=[],checks=[];
for(let i=0;i<accepted.length;i+=4){
  const batch=accepted.slice(i,i+4),results=await Promise.all(batch.map(fetchRating));
  for(let j=0;j<batch.length;j++){
    const item=batch[j],result=results[j],source=registeredEditorialSource(registry,item);
    if(!source)continue;
    item.configured_source_id=source.id;item.publication=source.name;
    if(result.version){item.canonical_score_eligible=result.version.score_eligible;item.version_validation=result.version;if(!result.version.score_eligible)item.source_kind='port_review'}
    const previousTrusted=isTrustedEditorialScore(item)?{score:Number(item.score),scale:Number(item.scale),grade:item.grade||'',evidence:item.score_evidence}:null;
    if(result.rating){
      item.score=result.rating.score;item.scale=result.rating.scale;item.grade='';item.score_eligible=item.canonical_score_eligible!==false;
      item.score_evidence=buildEditorialScoreEvidence(result.rating,{url:result.finalUrl||item.resolved_url||item.url,configuredSourceId:item.configured_source_id});
      updates.push({configured_source_id:item.configured_source_id,publication:item.publication,score:item.score,scale:item.scale,method:result.rating.method,scope:'editorial_review',canonical_score_eligible:item.score_eligible});
    }else if(previousTrusted){
      item.score=previousTrusted.score;item.scale=previousTrusted.scale;item.grade=previousTrusted.grade;item.score_evidence=previousTrusted.evidence;item.score_eligible=item.canonical_score_eligible!==false;
    }else{
      item.score=null;item.scale=null;item.grade='';item.score_eligible=false;delete item.score_evidence;
    }
    checks.push({configured_source_id:item.configured_source_id,publication:item.publication,url:item.resolved_url||item.url,final_url:result.finalUrl||'',status:result.reason,blocked:Boolean(result.blocked),preserved_existing_score:Boolean(!result.rating&&previousTrusted),trusted_editorial_score:isTrustedEditorialScore(item),canonical_score_eligible:item.canonical_score_eligible!==false});
  }
}

const bySource=new Map(accepted.map(item=>[item.configured_source_id,item]));
review.reviews=(review.reviews||[]).map(item=>{
  const source=registeredEditorialSource(registry,item),updated=source?bySource.get(source.id):null;
  if(!updated)return item;
  return {...item,...updated};
});
research.source_registry=cfg.source_registry;research.accepted=accepted;research.coverage={...(research.coverage||{}),scored:accepted.filter(x=>x.score_eligible&&isTrustedEditorialScore(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length};
review.source_registry=cfg.source_registry;review.updated_at=new Date().toISOString();
write(researchPath,research);write(reviewPath,review);
write(`data/parser-runs/review-explicit-scores-${slug}.json`,{parser:'review-explicit-editorial-score-enrichment-v5',game_slug:slug,checked_at:review.updated_at,source_registry:cfg.source_registry,accepted:accepted.length,scored:accepted.filter(x=>x.score_eligible&&isTrustedEditorialScore(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length,updates,checks});
console.log(JSON.stringify({slug,accepted:accepted.length,scored:accepted.filter(x=>x.score_eligible&&isTrustedEditorialScore(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length,updates:updates.length,preserved:checks.filter(x=>x.preserved_existing_score).length},null,2));
