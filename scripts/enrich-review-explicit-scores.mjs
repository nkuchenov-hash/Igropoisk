#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,registeredEditorialSource,classifyReviewPage,classifyCanonicalVersion} from './lib/review-source-registry.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/enrich-review-explicit-scores.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};

const reviewPath=`data/reviews/${slug}.json`;
const researchPath=`data/research/${slug}-source-matrix.json`;
const review=read(reviewPath),research=read(researchPath),game=read(`data/drafts/${slug}.json`),cfg=read('config/parsers/review-synthesis.json');
if(!review||!research||!game||!cfg) throw new Error(`Missing canonical review research/game draft for ${slug}`);
const registry=loadReviewSourceRegistry(cfg.source_registry);
const timeout=Number(process.env.REVIEW_SCORE_FETCH_TIMEOUT_MS||10000);
const cleanNumber=value=>{const match=String(value??'').replace(',','.').match(/[0-9]+(?:\.[0-9]+)?/);const n=match?Number(match[0]):NaN;return Number.isFinite(n)?n:null};
const valid=(score,scale)=>Number.isFinite(score)&&Number.isFinite(scale)&&scale>0&&score>=0&&score<=scale&&scale<=100;
const fromPair=(score,scale,method)=>{const s=cleanNumber(score),m=cleanNumber(scale);return valid(s,m)?{score:s,scale:m,method}:null};
const hasExplicit=item=>Number.isFinite(Number(item?.score))&&Number.isFinite(Number(item?.scale))&&Number(item.scale)>0;
const visible=html=>String(html||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();
const escapeRx=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function inferredScale(score,source){const configured=Number(source?.review?.score?.default_scale);if(Number.isFinite(configured)&&configured>0)return configured;return Number(score)>10?100:10}
function schemaTypes(node){const raw=node?.['@type'];return (Array.isArray(raw)?raw:[raw]).filter(Boolean).map(x=>String(x).toLowerCase())}
function jsonLdRating(rootNode,source){let hit=null;const walk=(node,inReview=false)=>{if(hit||node==null)return;if(Array.isArray(node)){for(const item of node)walk(item,inReview);return}if(typeof node!=='object')return;const types=schemaTypes(node),reviewContext=inReview||types.some(t=>t==='review'||t.endsWith('review'));if(reviewContext&&node.reviewRating&&typeof node.reviewRating==='object'){const r=node.reviewRating;hit=fromPair(r.ratingValue,r.bestRating||inferredScale(r.ratingValue,source),'jsonld.reviewRating');if(hit)return}if(reviewContext&&types.some(t=>t==='rating')&&node.ratingValue!=null){hit=fromPair(node.ratingValue,node.bestRating||inferredScale(node.ratingValue,source),'jsonld.rating');if(hit)return}for(const[key,value]of Object.entries(node)){if(key==='aggregateRating')continue;walk(value,reviewContext||key==='review'||key==='reviewRating')}};walk(rootNode,false);return hit}
function parseJsonLd(html,source){for(const m of String(html||'').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){for(const candidate of[m[1].trim(),m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')]){if(!candidate)continue;try{const hit=jsonLdRating(JSON.parse(candidate),source);if(hit)return hit}catch{}}}return null}
function attr(tag,name){return (String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`,'i'))||[])[1]||''}
function parseStructuredHtml(html,source){const raw=String(html||'');for(const m of raw.matchAll(/<[^>]+itemprop=["']reviewRating["'][^>]*>[\s\S]{0,1800}?<\/[^>]+>/gi)){const block=m[0],scoreTag=(block.match(/<[^>]+itemprop=["']ratingValue["'][^>]*>/i)||[])[0]||'',bestTag=(block.match(/<[^>]+itemprop=["']bestRating["'][^>]*>/i)||[])[0]||'',score=attr(scoreTag,'content')||attr(scoreTag,'value')||(block.match(/itemprop=["']ratingValue["'][^>]*>\s*([0-9.]+)/i)||[])[1],scale=attr(bestTag,'content')||attr(bestTag,'value')||(block.match(/itemprop=["']bestRating["'][^>]*>\s*([0-9.]+)/i)||[])[1]||inferredScale(score,source),hit=fromPair(score,scale,'microdata.reviewRating');if(hit)return hit}
 for(const tag of raw.match(/<[^>]+(?:data-score|data-rating|data-review-score|data-review-rating)=["'][^"']+["'][^>]*>/gi)||[]){const score=attr(tag,'data-score')||attr(tag,'data-rating')||attr(tag,'data-review-score')||attr(tag,'data-review-rating');const scale=attr(tag,'data-scale')||attr(tag,'data-max')||attr(tag,'data-best-rating')||inferredScale(score,source);const hit=fromPair(score,scale,'data-attribute');if(hit)return hit}
 return null}
function parseConfiguredPatterns(html,source){const raw=String(html||''),text=visible(raw),patterns=source?.review?.score?.patterns||[];for(const entry of patterns){const pattern=typeof entry==='string'?entry:entry?.pattern;if(!pattern)continue;try{const rx=new RegExp(pattern,'i'),m=(entry?.html===true?raw:text).match(rx);if(!m)continue;const score=m[Number(entry?.score_group||1)],scale=entry?.scale??m[Number(entry?.scale_group||2)]??inferredScale(score,source),hit=fromPair(score,scale,`registry:${source.id}`);if(hit)return hit}catch{}}return null}
function parseSemantic(html,source){const raw=String(html||''),text=visible(raw),patterns=[
 /(?:overall score|final score|review score|our score|our rating|our review|the verdict|verdict|score|rating|оценка|рейтинг)\s*[:–—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:\/|out of)\s*(5|10|100)\b/i,
 /(?:overall score|final score|review score|our score|our rating|оценка|рейтинг)\s*[:–—-]?\s*([0-9]+(?:[.,][0-9]+)?)(?!\s*(?:votes?|голос|users?))/i,
 /(?:outstanding|excellent|great|good|average|poor)\s+([0-9]+(?:[.,][0-9]+)?)\s*\/\s*(5|10|100)\b/i
 ];for(const pattern of patterns){const m=text.match(pattern);if(!m)continue;const score=cleanNumber(m[1]),scale=m[2]||inferredScale(score,source),hit=fromPair(score,scale,'semantic-labelled-score');if(hit)return hit}
 const classScore=raw.match(/<(?:span|div|strong|b|p)[^>]+(?:class|id)=["'][^"']*(?:review[-_ ]?score|review[-_ ]?rating|rating[-_ ]?value|score[-_ ]?value|verdict[-_ ]?score|rating)[^"']*["'][^>]*>\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*(?:\/|out of)\s*(5|10|100))?/i);if(classScore){const score=cleanNumber(classScore[1]),hit=fromPair(score,classScore[2]||inferredScale(score,source),'semantic-score-element');if(hit)return hit}
 const publication=escapeRx(source?.name);if(publication){for(const rx of[new RegExp(`(?:^|\\s)([0-9]+(?:[.,][0-9]+)?)\\s*(?:\\/\\s*(5|10|100))?\\s*${publication}(?:\\s|$)`,'i'),new RegExp(`${publication}\\s*[:–—-]?\\s*([0-9]+(?:[.,][0-9]+)?)(?:\\s*\\/\\s*(5|10|100))?`,'i')]){const m=text.match(rx);if(m){const score=cleanNumber(m[1]),hit=fromPair(score,m[2]||inferredScale(score,source),'semantic-publisher-score');if(hit)return hit}}}
 return null}
function explicitRating(html,source){return parseConfiguredPatterns(html,source)||parseJsonLd(html,source)||parseStructuredHtml(html,source)||parseSemantic(html,source)}
async function fetchRating(item){const source=registeredEditorialSource(registry,item),url=item.resolved_url||item.url;if(!source||!/^https?:\/\//i.test(String(url||'')))return{rating:null,reason:'invalid_source_or_url'};try{const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskScoreAudit/4.0)','accept-language':'en,ru;q=.8'}});if(!response.ok)return{rating:null,reason:`http_${response.status}`,blocked:[401,403,408,425,429,451,500,502,503,504].includes(response.status)};const html=await response.text(),finalUrl=response.url||url,title=visible((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)||[])[1]||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||item.title||''),pageClass=classifyReviewPage(source,{url:finalUrl,title,bodyText:visible(html).slice(0,5000)});if(!pageClass.accepted)return{rating:null,reason:pageClass.reason,finalUrl,title,pageClass};const version=classifyCanonicalVersion({title,url:finalUrl,versionContext:item.version_context||'',game}),rating=explicitRating(html,source);return{rating,reason:rating?'explicit_score_found':'no_explicit_score',finalUrl,title,version,pageClass}}catch(error){return{rating:null,reason:error.message,blocked:true}}}

const accepted=(research.accepted||[]).filter(item=>registeredEditorialSource(registry,item));
const updates=[],checks=[];
for(let i=0;i<accepted.length;i+=4){const batch=accepted.slice(i,i+4),results=await Promise.all(batch.map(fetchRating));for(let j=0;j<batch.length;j++){
  const item=batch[j],result=results[j],source=registeredEditorialSource(registry,item);
  if(!source)continue;
  item.configured_source_id=source.id;item.publication=source.name;
  if(result.version){item.canonical_score_eligible=result.version.score_eligible;item.version_validation=result.version;if(!result.version.score_eligible)item.source_kind='port_review'}
  const previousScore=hasExplicit(item)?{score:Number(item.score),scale:Number(item.scale),grade:item.grade||'',evidence:item.score_evidence||null}:null;
  if(result.rating){item.score=result.rating.score;item.scale=result.rating.scale;item.grade='';item.score_eligible=item.canonical_score_eligible!==false;item.score_evidence={method:result.rating.method,checked_at:new Date().toISOString(),url:result.finalUrl||item.resolved_url||item.url,configured_source_id:item.configured_source_id,direct_publisher:true};updates.push({configured_source_id:item.configured_source_id,publication:item.publication,score:item.score,scale:item.scale,method:result.rating.method,canonical_score_eligible:item.score_eligible})}
  else if(previousScore){item.score=previousScore.score;item.scale=previousScore.scale;item.grade=previousScore.grade;item.score_evidence=previousScore.evidence;item.score_eligible=item.canonical_score_eligible!==false;}
  checks.push({configured_source_id:item.configured_source_id,publication:item.publication,url:item.resolved_url||item.url,final_url:result.finalUrl||'',status:result.reason,blocked:Boolean(result.blocked),preserved_existing_score:Boolean(!result.rating&&previousScore),canonical_score_eligible:item.canonical_score_eligible!==false});
}}

const bySource=new Map(accepted.map(item=>[item.configured_source_id,item]));
review.reviews=(review.reviews||[]).map(item=>{const source=registeredEditorialSource(registry,item),updated=source?bySource.get(source.id):null;if(!updated)return item;const next={...item,...updated};if(!hasExplicit(updated)&&hasExplicit(item)){next.score=Number(item.score);next.scale=Number(item.scale);next.grade=item.grade||'';next.score_evidence=item.score_evidence||null;next.score_eligible=item.score_eligible!==false&&next.canonical_score_eligible!==false}return next});
research.source_registry=cfg.source_registry;research.accepted=accepted;research.coverage={...(research.coverage||{}),scored:accepted.filter(x=>x.score_eligible&&hasExplicit(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length};
review.source_registry=cfg.source_registry;review.updated_at=new Date().toISOString();
write(researchPath,research);write(reviewPath,review);
write(`data/parser-runs/review-explicit-scores-${slug}.json`,{parser:'review-explicit-score-enrichment-registry-v4',game_slug:slug,checked_at:review.updated_at,source_registry:cfg.source_registry,accepted:accepted.length,scored:accepted.filter(x=>x.score_eligible&&hasExplicit(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length,updates,checks});
console.log(JSON.stringify({slug,accepted:accepted.length,scored:accepted.filter(x=>x.score_eligible&&hasExplicit(x)).length,context_only_versions:accepted.filter(x=>x.canonical_score_eligible===false).length,updates:updates.length,preserved:checks.filter(x=>x.preserved_existing_score).length},null,2));
