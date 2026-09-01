import fs from 'node:fs';
import path from 'node:path';
import { buildReviewIdentityPolicy, normalizeReviewIdentity, reviewIdentityProblem } from './lib/review-identity-policy.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug) throw new Error('Usage: node scripts/validate-pre-review-materials.mjs <slug>');
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const config=read('config/game-page-quality-v2.json',{});
const matrix=read(`data/research/${slug}-source-matrix.json`,{});
const reviews=read(`data/reviews/${slug}.json`,{});
const ratings=read(`data/ratings/${slug}.json`,{});
const draft=read(`data/drafts/${slug}.json`,{});
const reviewMinimum=Number(config.review_corpus?.minimum_sources||10);
const ratingMinimum=Number(config.rating?.minimum_sources||5);
const ratingTarget=Number(config.rating?.target_sources||10);
const requiredRatingCount=Math.max(ratingMinimum,ratingTarget);
const requireExhaustive=config.rating?.require_exhaustive_discovery!==false;
const accepted=Array.isArray(reviews.reviews)?reviews.reviews:[];
const matrixAccepted=Array.isArray(matrix.accepted)?matrix.accepted:[];
const normalized=normalizeReviewIdentity;
const publications=new Set(accepted.map(item=>normalized(item.publication||item.source)).filter(Boolean));
const scored=Array.isArray(ratings.sources)?ratings.sources:[];
const policy=buildReviewIdentityPolicy(root,slug,draft);
const problems=[];

const validateRows=(rows,label)=>{
  for(const item of rows){
    const reason=reviewIdentityProblem(item,policy);
    if(reason) problems.push(`${label} rejected by identity/direct-source policy: ${reason}: ${item.url||item.resolved_url||item.title||item.publication||'unknown'}`);
  }
};

if(matrix.source_registry_scan?.complete!==true) problems.push('source registry scan is incomplete');
if(requireExhaustive&&matrix.coverage?.page_material_scan_complete!==true) problems.push('professional review/score discovery is not exhaustive');
if(accepted.length<reviewMinimum) problems.push(`professional reviews ${accepted.length}/${reviewMinimum}`);
if(publications.size<reviewMinimum) problems.push(`independent publications ${publications.size}/${reviewMinimum}`);
if(scored.length<requiredRatingCount) problems.push(`professional score sources ${scored.length}/${requiredRatingCount}`);
if(ratings.status!=='green'||ratings.calculation?.score_10==null) problems.push('aggregate professional rating is not green/calculated');
if(ratings.method?.use_all_discovered_scores!==true) problems.push('aggregate does not use all discovered professional scores');
if(ratings.method?.identity_sanitized!==true) problems.push('aggregate was not produced by identity-sanitized rating pipeline');
if(Number(ratings.calculation?.source_count)!==scored.length) problems.push(`rating source count mismatch: calculation=${ratings.calculation?.source_count??'missing'} data=${scored.length}`);
if(matrixAccepted.length&&matrixAccepted.length!==accepted.length) problems.push(`research/review accepted corpus mismatch: matrix=${matrixAccepted.length} reviews=${accepted.length}`);
validateRows(accepted,'review');
validateRows(scored,'rating source');
validateRows(matrixAccepted,'research source');

const result={slug,review_minimum:reviewMinimum,accepted_reviews:accepted.length,independent_publications:publications.size,rating_minimum:ratingMinimum,rating_target:ratingTarget,required_rating_sources:requiredRatingCount,scored_publications:scored.length,score_target_met:scored.length>=requiredRatingCount,exhaustive_discovery_required:requireExhaustive,exhaustive_discovery_complete:matrix.coverage?.page_material_scan_complete===true,identity_sanitization_required:true,franchise_token:policy.franchiseToken,sibling_aliases_checked:policy.siblingAliases.length,score_10:ratings.calculation?.score_10??null,status:problems.length?'red-needs-revision':'green',problems};
console.log(JSON.stringify(result,null,2));
if(problems.length) process.exit(1);
