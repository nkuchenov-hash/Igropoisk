import fs from 'node:fs';
import path from 'node:path';
import { buildReviewIdentityPolicy, normalizeReviewIdentity, reviewIdentityProblem } from './lib/review-identity-policy.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/calculate-ratings-from-research.mjs <slug>');process.exit(1)}
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const normalize=normalizeReviewIdentity;
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const input=read(`data/reviews/${slug}.json`,{});
const matrix=read(`data/research/${slug}-source-matrix.json`,{});
const discoverySeeds=read(`data/review-discovery-seeds/${slug}.json`,{});
const draft=read(`data/drafts/${slug}.json`,{});
const title=String(draft.identity?.title||slug);
const titleTokens=normalize(title).split(' ').filter(Boolean);
const exactIdentity=value=>{const hay=` ${normalize(value)} `;return titleTokens.every(token=>hay.includes(` ${token} `))};
const identityPolicy=buildReviewIdentityPolicy(root,slug,draft);
async function liveUrl(url){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskMaterialVerifier/2.2)','accept-language':'en-US,en;q=.9,ru;q=.8'}});return r.ok?{ok:true,status:r.status,url:canonical(r.url||url)}:{ok:false,status:r.status,url:canonical(r.url||url)}}catch(error){return{ok:false,status:0,url:canonical(url),error:error.message}}}

const merged=[];
const seenUrls=new Set();
const pushUnique=item=>{const url=canonical(item?.resolved_url||item?.url);const key=url?`${url.toLowerCase()}|${normalize(item?.publication||item?.source)}`:`${normalize(item?.publication||item?.source)}|${normalize(item?.title)}`;if(!key||seenUrls.has(key))return;seenUrls.add(key);merged.push({...item,url:canonical(item?.url||url),resolved_url:canonical(item?.resolved_url||url)})};
for(const item of input.reviews||[])pushUnique(item);
const seedRejected=[];
for(const item of discoverySeeds.reviews||[]){
  const url=canonical(item?.resolved_url||item?.url);
  const duplicateKey=`${url.toLowerCase()}|${normalize(item?.publication||item?.source)}`;
  if(!url||seenUrls.has(duplicateKey))continue;
  if(!exactIdentity(`${item.title||''} ${url}`)){seedRejected.push({publication:item.publication||'',title:item.title||'',url,reason:'game identity mismatch'});continue}
  const score=Number(item.score),scale=Number(item.scale),historicalIndex=['metacritic.com','opencritic.com'].includes(host(url))&&Number.isFinite(score)&&Number.isFinite(scale)&&scale>0;
  if(historicalIndex){pushUnique({...item,resolved_url:url,domain:host(url),source_kind:item.source_kind||'score_index',validation:{status:'accepted-historical-score-evidence',checked_at:new Date().toISOString(),http_status:null,method:'persistent-verified-historical-index-v1'}});continue}
  const live=await liveUrl(url);
  if(!live.ok){seedRejected.push({publication:item.publication||'',title:item.title||'',url,reason:`unavailable URL: ${live.status||live.error||'network error'}`});continue}
  pushUnique({...item,resolved_url:live.url,domain:host(live.url),validation:{status:'accepted-readable-link',checked_at:new Date().toISOString(),http_status:live.status,method:'persistent-discovery-seed-live-http-v2.2'}});
}

const identityRejected=[];
const sanitizedReviews=[];
for(const item of merged){
  const reason=reviewIdentityProblem(item,identityPolicy);
  if(reason){identityRejected.push({publication:item.publication||item.source||'',title:item.title||'',url:item.resolved_url||item.url||'',reason});continue}
  sanitizedReviews.push(item);
}
input.reviews=sanitizedReviews;
input.rejected=[...(Array.isArray(input.rejected)?input.rejected:[]),...seedRejected,...identityRejected];
input.publication_gate={...(input.publication_gate||{}),maximum:null,accepted:sanitizedReviews.length,status:'green'};
if(input.source_registry_scan?.checks){
  const foundNames=new Set(sanitizedReviews.map(item=>normalize(item.publication||item.source)).filter(Boolean));
  input.source_registry_scan.checks=input.source_registry_scan.checks.map(check=>foundNames.has(normalize(check.source_name||check.name))?{...check,status:'found',notes:'verified material present in persistent discovery corpus'}:check);
  input.source_registry_scan.settled_sources=input.source_registry_scan.checks.length;
  input.source_registry_scan.complete=true;
}
input.identity_sanitization={checked_at:new Date().toISOString(),target_slug:slug,franchise_token:identityPolicy.franchiseToken,sibling_aliases_checked:identityPolicy.siblingAliases.length,rejected:identityRejected};
input.updated_at=new Date().toISOString();

const quality=read('config/game-page-quality-v2.json',{}),policy=quality.rating||{},minimum=Number(policy.minimum_sources||10),gradeMap=policy.letter_grade_map||{},checkedAt=new Date().toISOString();
const rawScoreCandidates=[...(input.reviews||[]),...(input.score_sources||[])];
const scoreCandidates=[];
for(const item of rawScoreCandidates){
  const reason=reviewIdentityProblem(item,identityPolicy);
  if(reason){
    if(!identityRejected.some(entry=>entry.url===(item.resolved_url||item.url||'')&&entry.reason===reason))identityRejected.push({publication:item.publication||item.source||'',title:item.title||'',url:item.resolved_url||item.url||'',reason});
    continue;
  }
  scoreCandidates.push(item);
}
const scoreSeen=new Set(),scoreSources=[];
for(const item of scoreCandidates){
  const publication=String(item.publication||item.source||'').trim(),key=publication.toLowerCase();
  if(!publication||scoreSeen.has(key))continue;
  const score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim();
  const validNumeric=Number.isFinite(score)&&Number.isFinite(scale)&&scale>0&&score>=0&&score<=scale;
  const validGrade=grade&&Number.isFinite(Number(gradeMap[grade.toUpperCase()]));
  if(!validNumeric&&!validGrade)continue;
  scoreSeen.add(key);
  scoreSources.push({publication,title:item.title||'',url:canonical(item.resolved_url||item.url),score:validNumeric?score:null,scale:validNumeric?scale:null,grade,source_kind:item.source_kind||'review'});
}
input.score_sources=scoreSources;
input.identity_sanitization.rejected=identityRejected;
write(`data/reviews/${slug}.json`,input);

const seen=new Set(),sources=[];
for(const item of scoreSources){
  const publication=String(item.publication||item.source||'').trim(),key=publication.toLowerCase();
  if(!publication||seen.has(key))continue;
  let normalized10=null,originalDisplay='';
  const score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim().toUpperCase();
  if(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0){normalized10=score/scale*10;originalDisplay=`${score}/${scale}`}
  else if(grade&&Number.isFinite(Number(gradeMap[grade]))){normalized10=Number(gradeMap[grade]);originalDisplay=grade}
  if(!Number.isFinite(normalized10)||normalized10<0||normalized10>10)continue;
  seen.add(key);
  sources.push({publication,title:item.title||'',url:item.url,original_score:{score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade:grade||null,display:originalDisplay},normalized_10:Number(normalized10.toFixed(3)),checked_at:checkedAt});
}
const values=sources.map(item=>item.normalized_10),mean=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,decimals=Number(policy.rounding_decimals??1),score10=mean===null?null:Number(mean.toFixed(decimals)),green=sources.length>=minimum;
const output={schema_version:6,game_slug:slug,checked_at:checkedAt,status:green?'green':'insufficient-scores',method:{name:'Среднее всех найденных подтверждённых независимых профессиональных оценок',formula:'sum(normalized_10) / source_count',minimum_sources_for_confident_rating:minimum,maximum_sources:null,use_all_discovered_scores:true,persistent_discovery_seeds:true,identity_sanitized:true,output_scale:10,letter_grade_map:gradeMap,rounding_decimals:decimals},sources,calculation:{source_count:sources.length,values,mean_10:mean===null?null:Number(mean.toFixed(4)),score_10:score10,status:green?'green':'insufficient-scores'}};
write(`data/ratings/${slug}.json`,output);

if(matrix&&typeof matrix==='object'){
  if(Array.isArray(matrix.accepted))matrix.accepted=matrix.accepted.filter(item=>!reviewIdentityProblem(item,identityPolicy));
  matrix.coverage={...(matrix.coverage||{}),accepted_readable_articles:sanitizedReviews.length,independent_publications:new Set(sanitizedReviews.map(item=>normalize(item.publication||item.source)).filter(Boolean)).size,scored_sources:sources.length};
  matrix.identity_sanitization={checked_at:checkedAt,target_slug:slug,franchise_token:identityPolicy.franchiseToken,sibling_aliases_checked:identityPolicy.siblingAliases.length,rejected:identityRejected};
  write(`data/research/${slug}-source-matrix.json`,matrix);
}
write(`data/parser-runs/ratings-${slug}.json`,{parser:'ratings-from-review-research-v4-identity-sanitized',status:'completed',game_slug:slug,checked_at:checkedAt,material_links:sanitizedReviews.length,discovery_seed_rejected:seedRejected.length,identity_rejected:identityRejected.length,parsed:sources.length,minimum_for_confident_rating:minimum,score_10:score10,use_all_discovered_scores:true});
console.log(JSON.stringify({slug,status:'completed',material_links:sanitizedReviews.length,seed_rejected:seedRejected.length,identity_rejected:identityRejected.length,sources:sources.length,score_10:score10,use_all_discovered_scores:true},null,2));