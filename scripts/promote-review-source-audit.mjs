#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/promote-review-source-audit.mjs <slug>');

const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const canonicalUrl=value=>{try{const u=new URL(String(value||''));u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ftag'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}`}catch{return String(value||'')}};
const pubKey=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
const explicitScore=item=>Number.isFinite(Number(item?.score))&&Number.isFinite(Number(item?.scale))&&Number(item.scale)>0;

const matrixPath=`data/research/${slug}-source-matrix.json`;
const reviewPath=`data/reviews/${slug}.json`;
const matrix=read(matrixPath);
const existing=read(reviewPath,{});
const quality=read('config/game-page-quality-v2.json',{});
if(!matrix||!Array.isArray(matrix.accepted)) throw new Error(`Missing full source matrix: ${matrixPath}`);
if(matrix.policy?.audit_all!==true) throw new Error('Only a complete --all source audit may be promoted into the canonical corpus');

const oldReviews=Array.isArray(existing.reviews)?existing.reviews:[];
const oldById=new Map(oldReviews.filter(x=>x.configured_source_id).map(x=>[x.configured_source_id,x]));
const oldByUrl=new Map(oldReviews.filter(x=>x.url||x.resolved_url).map(x=>[canonicalUrl(x.resolved_url||x.url),x]));
const oldByPub=new Map(oldReviews.map(x=>[pubKey(x.publication||x.source),x]));

const accepted=matrix.accepted.map((fresh,index)=>{
  const old=oldById.get(fresh.configured_source_id)||oldByUrl.get(canonicalUrl(fresh.resolved_url||fresh.url))||oldByPub.get(pubKey(fresh.publication||fresh.source));
  const merged={...(old||{}),...fresh,id:`source-${index+1}`};
  // A transient bot block or a parser miss must never erase a previously verified explicit score.
  if(old&&explicitScore(old)&&!explicitScore(fresh)){
    merged.score=Number(old.score);
    merged.scale=Number(old.scale);
    merged.grade=old.grade||'';
    merged.score_evidence=old.score_evidence||null;
    merged.score_eligible=old.score_eligible!==false&&merged.canonical_score_eligible!==false;
  }
  return merged;
});

const minimum=Number(quality.review_corpus?.minimum_sources||5);
const target=Number(quality.review_corpus?.target_sources||20);
const contemporary=accepted.filter(x=>x.source_kind==='review').length;
const minContemporary=Number((matrix.policy?.historical?quality.review_corpus?.minimum_contemporary_historical:quality.review_corpus?.minimum_contemporary_modern)||5);
const regionalComplete=matrix.regional_discovery?.complete===true;
const fullCoverage=Number(matrix.coverage?.checked||0)>=Number(matrix.coverage?.registered_editorial||0)&&Number(matrix.coverage?.registered_editorial||0)>0;
const green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete&&fullCoverage;

const review={
  ...existing,
  schema_version:Math.max(10,Number(existing.schema_version||0)),
  game_slug:slug,
  game_id:existing.game_id||null,
  updated_at:new Date().toISOString(),
  source_registry:matrix.source_registry||existing.source_registry||'config/parsers/review-source-registry.json',
  publication_gate:{
    minimum,
    target,
    accepted:accepted.length,
    status:green?'green':'red-needs-revision',
    full_registry_scan:true,
    checked_registered_sources:Number(matrix.coverage?.checked||0),
    applicable_registered_sources:Number(matrix.coverage?.registered_editorial||0)
  },
  regional_discovery:matrix.regional_discovery||existing.regional_discovery||{},
  reviews:accepted,
  rejected:matrix.rejected||[],
  ...(existing.review_score?{review_score:existing.review_score}:{}),
  ...(existing.igropoisk_article?{igropoisk_article:existing.igropoisk_article}:{})
};

write(reviewPath,review);
write(`data/parser-runs/review-source-audit-promotion-${slug}.json`,{
  parser:'review-source-audit-promotion-v1',
  status:green?'green':'needs_revision',
  game_slug:slug,
  checked_at:review.updated_at,
  accepted:accepted.length,
  scored_before_enrichment:accepted.filter(x=>x.score_eligible&&explicitScore(x)).length,
  checked_registered_sources:review.publication_gate.checked_registered_sources,
  applicable_registered_sources:review.publication_gate.applicable_registered_sources,
  regional_complete:regionalComplete,
  full_registry_scan:fullCoverage
});
console.log(JSON.stringify({slug,status:review.publication_gate.status,accepted:accepted.length,checked:review.publication_gate.checked_registered_sources,applicable:review.publication_gate.applicable_registered_sources,regional_complete:regionalComplete},null,2));
if(!green) process.exitCode=2;
