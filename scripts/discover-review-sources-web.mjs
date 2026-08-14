#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,editorialSources,regionalEditorialSources,sourceDiscoveryDef,registeredEditorialSource,classifyReviewPage,classifyCanonicalVersion} from './lib/review-source-registry.mjs';
import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';

const root=process.cwd(),slug=process.argv[2],auditAll=process.argv.includes('--all');
if(!slug)throw new Error('Usage: discover-review-sources-web <slug> [--all]');
const read=(relative,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const game=read(`data/drafts/${slug}.json`),old=read(`data/reviews/${slug}.json`),oldResearch=read(`data/research/${slug}-source-matrix.json`),article=read(`data/articles/${slug}.json`),cfg=read('config/parsers/review-synthesis.json'),registry=loadReviewSourceRegistry(cfg.source_registry),quality=read('config/game-page-quality-v2.json');
if(!game.identity)throw new Error('Missing game draft');

const corpus=quality.review_corpus||{},minimum=Number(corpus.minimum_sources||5),target=Number(corpus.target_sources||20),maximum=Number(corpus.maximum_sources||20),minScored=Number(quality.review_score?.minimum_sources||3),title=game.identity.title||slug,year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0),historical=year>0&&year<2010,now=new Date().toISOString();
const SEARCH_TIMEOUT=6500,PAGE_TIMEOUT=9000,BATCH=4;
const decode=value=>String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const canon=value=>{try{const url=new URL(decode(value));url.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ftag'])url.searchParams.delete(key);return url.origin+url.pathname.replace(/\/$/,'')+url.search}catch{return String(value||'')}};
const text=value=>decode(String(value||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const direct=value=>{try{const url=new URL(value);return url.pathname.split('/').filter(Boolean).length>1||url.searchParams.has('p')}catch{return false}};
const badDomains=(corpus.forbidden_domains||[]).map(String),forbidden=(corpus.forbidden_title_or_url_terms||[]).map(value=>String(value).toLowerCase());
const allTitleTokens=String(title).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').split(' ').filter(token=>token.length>2||/^\d+$/.test(token));
const stopTokens=new Set(['the','and','for','with','wild','hunt','game','edition']);
const coreTitleTokens=allTitleTokens.filter(token=>!stopTokens.has(token)).slice(0,5);
const looseTitle=coreTitleTokens.join(' ')||allTitleTokens.slice(0,5).join(' ')||title;
const identityMatch=(haystack)=>{const lower=String(haystack||'').toLowerCase();const tokens=coreTitleTokens.length?coreTitleTokens:allTitleTokens;if(!tokens.length)return true;return tokens.filter(token=>lower.includes(token)).length/tokens.length>=Math.min(0.66,2/Math.max(2,tokens.length));};
const reviewSignal=value=>/(?:review|reviews|opinion|recenzi|retsenzi|obzor|обзор|рецензи)/i.test(String(value||''));

const requiredRu=regionalEditorialSources(registry,'ru',{historical}).map(source=>({...sourceDiscoveryDef(source),regional:true})),ruIds=new Set(requiredRu.map(source=>source.id)),globals=editorialSources(registry,{historical}).map(sourceDiscoveryDef).filter(source=>!ruIds.has(source.id)),allDefs=[...requiredRu,...globals];
async function get(url,timeout=PAGE_TIMEOUT){try{const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/7.0)','accept-language':'ru,en;q=.8'}});return{ok:response.ok,url:response.url||url,status:response.status,body:response.ok?await response.text():''}}catch(error){return{ok:false,url,status:0,error:error.message,body:''}}}
function links(html,base='https://example.invalid'){
  const out=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url=decode(match[1]);try{url=new URL(url,base).href}catch{continue}
    const label=text(match[2]);if(/^https?:/i.test(url)&&!out.some(item=>item.url===canon(url)))out.push({url:canon(url),title:label});
  }
  return out;
}
function searchResults(html){
  const out=[];
  for(const match of String(html||'').matchAll(/href=["']([^"']+)["'][^>]*>([^<]{4,220})<\/a>/gi)){
    let url=decode(match[1]);
    try{const parsed=new URL(url,'https://html.duckduckgo.com');if(parsed.hostname.endsWith('duckduckgo.com')&&parsed.searchParams.get('uddg'))url=decodeURIComponent(parsed.searchParams.get('uddg'));else url=parsed.href}catch{}
    if(/^https?:/i.test(url)&&!out.some(item=>item.url===canon(url)))out.push({url:canon(url),title:text(match[2])});
  }
  return out;
}
function queryVariants(def,domain){
  const local=def.regional;
  const exact=`site:${domain} "${title}" ${local?'обзор рецензия':'review verdict'}${year?' '+year:''}`;
  const loose=`site:${domain} ${looseTitle} ${local?'обзор рецензия отзыв':'review score verdict'}${year?' '+year:''}`;
  return [...new Set([exact,loose])];
}
async function search(def){
  const source=registry.sources.find(item=>item.id===def.id),domain=(source?.domains||[])[0];
  if(!domain)return{def,reachable:false,items:[]};
  const queries=queryVariants(def,domain),requests=[];
  for(const query of queries){requests.push(get(`https://www.bing.com/search?count=12&q=${encodeURIComponent(query)}`,SEARCH_TIMEOUT));requests.push(get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,SEARCH_TIMEOUT));}
  const responses=await Promise.all(requests),items=[];
  for(const response of responses)if(response.ok)for(const item of searchResults(response.body))if(host(item.url)===domain||host(item.url).endsWith('.'+domain))if(!items.some(found=>found.url===item.url))items.push(item);
  return{def,reachable:responses.some(response=>response.ok),items:items.slice(0,16)};
}

const accepted=[],rejected=[],seenUrls=new Set(),checks=[];
function acceptedFor(sourceId){return accepted.find(item=>item.configured_source_id===sourceId)}
function sanitizeScore(item){if(!isTrustedEditorialScore(item)){item.score=null;item.scale=null;item.grade='';item.score_eligible=false;delete item.score_evidence}return item}
function store(candidate){
  const current=acceptedFor(candidate.configured_source_id);
  if(current){
    if(current.canonical_score_eligible===false&&candidate.canonical_score_eligible!==false){const index=accepted.indexOf(current);candidate.id=current.id;accepted[index]=candidate;return true}
    return false;
  }
  accepted.push(candidate);return true;
}
async function inspect(raw,{allowBlockedSeed=false,depth=0}={}){
  const source=registeredEditorialSource(registry,raw);if(!source)return false;
  let url=canon(raw.resolved_url||raw.url);if(!url.startsWith('http')||!direct(url)||seenUrls.has(url))return false;
  const hay=`${raw.title||''} ${url}`.toLowerCase();if(forbidden.some(term=>hay.includes(term))||badDomains.some(domain=>host(url)===domain||host(url).endsWith('.'+domain)))return false;
  seenUrls.add(url);
  const response=await get(url);
  if(!response.ok){
    if(allowBlockedSeed&&[401,403,408,425,429,451,500,502,503,504,0].includes(response.status)){
      const version=classifyCanonicalVersion({title:raw.title||'',url,versionContext:raw.version_context||'',game}),candidate=sanitizeScore({...raw,id:'',configured_source_id:source.id,publication:source.name,resolved_url:url,url,source_kind:version.score_eligible?(raw.source_kind||'review'):'port_review',language:raw.language||source.language||'',canonical_score_eligible:version.score_eligible,version_validation:version,validation:{status:'accepted-blocked-revalidation',checked_at:now,method:'registered-direct-publisher-preserved-v7',reason:`HTTP ${response.status||response.error}`}});
      return store(candidate);
    }
    rejected.push({publication:source.name,url,reasons:[`HTTP ${response.status||response.error}`]});return false;
  }
  url=canon(response.url);const pageTitle=text((response.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)||[])[1]||(response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||raw.title||''),bodyText=text(response.body),identityHay=`${pageTitle} ${url} ${bodyText.slice(0,6000)}`;
  if(!identityMatch(identityHay))return false;
  const pageClass=classifyReviewPage(source,{url,title:pageTitle,bodyText});
  if(!pageClass.accepted){
    if(pageClass.reason==='review_hub_not_article'&&depth<1){
      const candidates=links(response.body,url).filter(item=>(host(item.url)===host(url)||host(item.url).endsWith('.'+host(url)))&&reviewSignal(`${item.url} ${item.title}`)&&identityMatch(`${item.url} ${item.title}`)).slice(0,8);
      for(const child of candidates)if(await inspect({...child,configured_source_id:source.id,publication:source.name,language:source.language},{depth:depth+1}))return true;
    }
    rejected.push({publication:source.name,url,title:pageTitle,reasons:[pageClass.reason]});return false;
  }
  const version=classifyCanonicalVersion({title:pageTitle,url,versionContext:raw.version_context||'',game}),paragraphs=[...response.body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>text(match[1])).filter(value=>value.length>80&&value.length<900).slice(0,10),candidate=sanitizeScore({...raw,id:'',configured_source_id:source.id,publication:source.name,title:pageTitle||raw.title||`Review: ${title}`,url,resolved_url:url,source_kind:version.score_eligible?'review':'port_review',platform:raw.platform||'',version_context:raw.version_context||'',published_at:raw.published_at||'',author:raw.author||'',language:raw.language||source.language||'',canonical_score_eligible:version.score_eligible,version_validation:version,identity_evidence:raw.identity_evidence||`Direct registered professional publisher review verified for ${title}.`,evidence_points:(raw.evidence_points?.length?raw.evidence_points:raw.evidence?.length?raw.evidence:paragraphs).slice(0,12),praise:(raw.praise||[]).slice(0,8),criticism:(raw.criticism||[]).slice(0,8),mechanics:(raw.mechanics||[]).slice(0,12),domain:host(url),validation:{status:'accepted',checked_at:now,method:'registered-direct-publisher-http-v7',review_page:pageClass}});
  return store(candidate);
}

const articleSeeds=(article.sources||[]).filter(item=>item?.url).map(item=>({url:item.url,publication:item.name||item.publication||'',title:item.title||''}));
for(const seed of [...(old.reviews||[]),...(oldResearch.accepted||[]),...articleSeeds])await inspect(seed,{allowBlockedSeed:true});
async function discover(def){
  const current=acceptedFor(def.id);if(current?.canonical_score_eligible!==false)return{def,found:true,reachable:true};
  const result=await search(def);
  for(const item of result.items)if(await inspect({...item,configured_source_id:def.id,publication:def.name,language:def.language}))return{def,found:true,reachable:true};
  return{def,found:Boolean(acceptedFor(def.id)),reachable:result.reachable};
}
async function scan(defs){for(let i=0;i<defs.length;i+=BATCH){const batch=await Promise.all(defs.slice(i,i+BATCH).map(discover));for(const result of batch)checks.push({source_id:result.def.id,name:result.def.name,region:result.def.regional?'ru':'global',status:result.found?'found':result.reachable?'not_found':'unavailable',notes:result.found?'verified direct review':'search completed; no verified direct review'});if(!auditAll&&accepted.filter(item=>item.canonical_score_eligible!==false).length>=target)break}}
await scan(requiredRu);await scan(globals);
if(auditAll){const done=new Set(checks.map(item=>item.source_id));for(const def of allDefs)if(!done.has(def.id))checks.push({source_id:def.id,name:def.name,region:def.regional?'ru':'global',status:acceptedFor(def.id)?'found':'unchecked',notes:'not reached'})}
accepted.forEach((item,index)=>item.id=`source-${index+1}`);
const regionalChecks=checks.filter(item=>item.region==='ru'),regionalComplete=regionalChecks.length===requiredRu.length&&regionalChecks.every(item=>['found','not_found','unavailable'].includes(item.status)),contemporary=accepted.filter(item=>item.source_kind==='review').length,minContemporary=historical?Number(corpus.minimum_contemporary_historical||4):Number(corpus.minimum_contemporary_modern||5),green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete,scored=accepted.filter(item=>item.score_eligible&&isTrustedEditorialScore(item)).length,contextOnly=accepted.filter(item=>item.canonical_score_eligible===false).length,blockedVerified=accepted.filter(item=>item.validation?.status==='accepted-blocked-revalidation').length;
const matrix={schema_version:10,game_slug:slug,generated_at:now,source_registry:cfg.source_registry,policy:{minimum_sources:minimum,target_sources:target,maximum_sources:maximum,historical,regional_discovery_required:true,discovery_provider:'registered-direct-publisher-web-v7',audit_all:auditAll,canonical_score_requires_exact_version:true,score_extraction_separate:true,search_title_variants:true,review_hub_following:true},accepted,rejected,source_checks:checks,regional_discovery:{region:'ru',checks:regionalChecks.map(({source_id,name,status,notes})=>({source_id,name,status,notes})),complete:regionalComplete,found_but_not_accepted:[]},coverage:{registered_editorial:allDefs.length,checked:checks.length,accepted:accepted.length,scored,context_only_versions:contextOnly,blocked_verified:blockedVerified,contemporary,green,passed:green,needs_more:Math.max(0,minimum-accepted.length)}};
write(`data/research/${slug}-source-matrix.json`,matrix);
if(!auditAll)write(`data/reviews/${slug}.json`,{schema_version:10,game_slug:slug,game_id:game.game_id||old.game_id||null,updated_at:now,source_registry:cfg.source_registry,publication_gate:{minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision'},regional_discovery:matrix.regional_discovery,reviews:accepted,rejected,...(old.review_score?{review_score:old.review_score}:{}),...(old.igropoisk_article?{igropoisk_article:old.igropoisk_article}:{})});
write(`data/parser-runs/review-web-discovery-${slug}.json`,{parser:'review-registered-direct-publisher-web-v7',status:green?'green':'needs_revision',game_slug:slug,checked_at:now,source_registry:cfg.source_registry,accepted:accepted.length,scored,context_only_versions:contextOnly,blocked_verified:blockedVerified,registered_editorial:allDefs.length,source_checks:checks,regional_complete:regionalComplete,audit_all:auditAll,search_title_variants:true,review_hub_following:true});
console.log(JSON.stringify({slug,registered_editorial:allDefs.length,checked:checks.length,accepted:accepted.length,scored,context_only_versions:contextOnly,blocked_verified:blockedVerified,regional_complete:regionalComplete,audit_all:auditAll,status:green?'green':'red-needs-revision'},null,2));if(!green)process.exitCode=2;
