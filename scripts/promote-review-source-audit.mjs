#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/promote-review-source-audit.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const canonicalUrl=value=>{try{const url=new URL(String(value||''));url.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ftag'])url.searchParams.delete(key);return `${url.origin}${url.pathname.replace(/\/$/,'')}`}catch{return String(value||'')}};
const pubKey=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');

const matrixPath=`data/research/${slug}-source-matrix.json`,reviewPath=`data/reviews/${slug}.json`,matrix=read(matrixPath),existing=read(reviewPath,{}),quality=read('config/game-page-quality-v2.json',{});
if(!matrix||!Array.isArray(matrix.accepted))throw new Error(`Missing full source matrix: ${matrixPath}`);
if(matrix.policy?.audit_all!==true)throw new Error('Only a complete --all source audit may be promoted into the canonical corpus');

const oldReviews=Array.isArray(existing.reviews)?existing.reviews:[],oldById=new Map(oldReviews.filter(item=>item.configured_source_id).map(item=>[item.configured_source_id,item])),oldByUrl=new Map(oldReviews.filter(item=>item.url||item.resolved_url).map(item=>[canonicalUrl(item.resolved_url||item.url),item])),oldByPub=new Map(oldReviews.map(item=>[pubKey(item.publication||item.source),item]));
const accepted=matrix.accepted.map((fresh,index)=>{
  const old=oldById.get(fresh.configured_source_id)||oldByUrl.get(canonicalUrl(fresh.resolved_url||fresh.url))||oldByPub.get(pubKey(fresh.publication||fresh.source));
  const merged={...(old||{}),...fresh,id:`source-${index+1}`};
  // A full source scan may fail to re-read a score because of bot blocking. Preserve only a score
  // that already carries explicit editorial-review provenance; bare legacy numbers are deliberately discarded.
  if(old&&isTrustedEditorialScore(old)&&!isTrustedEditorialScore(fresh)){
    merged.score=Number(old.score);merged.scale=Number(old.scale);merged.grade='';merged.score_evidence=old.score_evidence;merged.score_eligible=old.score_eligible!==false&&merged.canonical_score_eligible!==false;
  }else if(!isTrustedEditorialScore(fresh)){
    merged.score=null;merged.scale=null;merged.grade='';merged.score_eligible=false;delete merged.score_evidence;
  }
  return merged;
});

const minimum=Number(quality.review_corpus?.minimum_sources||5),target=Number(quality.review_corpus?.target_sources||20),contemporary=accepted.filter(item=>item.source_kind==='review').length,minContemporary=Number((matrix.policy?.historical?quality.review_corpus?.minimum_contemporary_historical:quality.review_corpus?.minimum_contemporary_modern)||5),regionalComplete=matrix.regional_discovery?.complete===true,fullCoverage=Number(matrix.coverage?.checked||0)>=Number(matrix.coverage?.registered_editorial||0)&&Number(matrix.coverage?.registered_editorial||0)>0,green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete&&fullCoverage;
const review={...existing,schema_version:Math.max(11,Number(existing.schema_version||0)),game_slug:slug,game_id:existing.game_id||null,updated_at:new Date().toISOString(),source_registry:matrix.source_registry||existing.source_registry||'config/parsers/review-source-registry.json',publication_gate:{minimum,target,accepted:accepted.length,status:green?'green':'red-needs-revision',full_registry_scan:true,checked_registered_sources:Number(matrix.coverage?.checked||0),applicable_registered_sources:Number(matrix.coverage?.registered_editorial||0)},regional_discovery:matrix.regional_discovery||existing.regional_discovery||{},reviews:accepted,rejected:matrix.rejected||[],...(existing.review_score?{review_score:existing.review_score}:{}),...(existing.igropoisk_article?{igropoisk_article:existing.igropoisk_article}:{})};
write(reviewPath,review);
write(`data/parser-runs/review-source-audit-promotion-${slug}.json`,{parser:'review-source-audit-promotion-v2',status:green?'green':'needs_revision',game_slug:slug,checked_at:review.updated_at,accepted:accepted.length,trusted_scores_preserved:accepted.filter(isTrustedEditorialScore).length,checked_registered_sources:review.publication_gate.checked_registered_sources,applicable_registered_sources:review.publication_gate.applicable_registered_sources,regional_complete:regionalComplete,full_registry_scan:fullCoverage});
console.log(JSON.stringify({slug,status:review.publication_gate.status,accepted:accepted.length,trusted_scores_preserved:accepted.filter(isTrustedEditorialScore).length,checked:review.publication_gate.checked_registered_sources,applicable:review.publication_gate.applicable_registered_sources,regional_complete:regionalComplete},null,2));if(!green)process.exitCode=2;
