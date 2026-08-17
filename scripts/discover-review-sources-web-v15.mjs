#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadReviewSourceRegistry,editorialSources} from './lib/review-source-registry.mjs';
import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: node scripts/discover-review-sources-web-v15.mjs <slug> [--all]');
const auditAll=process.argv.includes('--all');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const decode=value=>String(value||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const visible=html=>decode(String(html||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const escapeRx=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const sourceNameVariants=source=>[source.name,...(source.aliases||[]),String(source.name||'').replace(/([a-z])([A-Z])/g,'$1 $2')].map(value=>String(value||'').trim()).filter(Boolean);
const userGenerated=item=>{
  const title=String(item?.title||''),url=String(item?.resolved_url||item?.url||'');
  return /(?:отзыв\s+об\s+игре[\s\S]{0,160}?от\s+пользователя|\buser\s+review\s+(?:by|from)\b|\breader\s+review\b|\bcommunity\s+review\b)/i.test(title)
    ||/^https?:\/\/(?:www\.)?stopgame\.ru\/game\/[^/]+\/review\/\d+/i.test(url);
};

const legacyArgs=[slug,...(auditAll?['--all']:[])];
const legacyTimeout=Math.max(30000,Math.min(240000,Number(process.env.REVIEW_LEGACY_STACK_TIMEOUT_MS||150000)));
function runLegacy(script){
  const result=spawnSync('node',[script,...legacyArgs],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,timeout:legacyTimeout,maxBuffer:32*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return{script,status:result.status,signal:result.signal||null,error:result.error?.message||'',timed_out:Boolean(result.error?.code==='ETIMEDOUT')};
}
let legacy=runLegacy('scripts/discover-review-sources-web-v14.mjs');
let matrixAfterLegacy=read(`data/research/${slug}-source-matrix.json`,null);
const legacyUsable=[0,2].includes(Number(legacy.status))&&(!auditAll||matrixAfterLegacy?.policy?.audit_all===true);
let fallback=null;
if(!legacyUsable){fallback=runLegacy('scripts/discover-review-sources-web-v8.mjs');matrixAfterLegacy=read(`data/research/${slug}-source-matrix.json`,null)}

const draft=read(`data/drafts/${slug}.json`,{});
const year=Number(String(draft?.release?.canonical_date_text||draft?.release?.date_text||draft?.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const historical=year>0&&year<2010;
const released=String(draft?.release?.status||'').toLowerCase()==='released'||Boolean(year&&year<=new Date().getUTCFullYear());
const registry=loadReviewSourceRegistry('config/parsers/review-source-registry.json');
const sources=editorialSources(registry,{historical});
const title=String(draft?.identity?.title||slug.replace(/-/g,' ')).trim();
const checkedAt=new Date().toISOString();

function platformTokens(){
  const out=[];const add=value=>{if(value&&!out.includes(value))out.push(value)};
  for(const raw of draft?.classification?.platforms||[]){
    const value=String(raw||'').toLowerCase();
    if(/windows|\bpc\b/.test(value))add('pc');
    if(/playstation\s*2|\bps2\b/.test(value))add('playstation-2');
    if(/playstation\s*3|\bps3\b/.test(value))add('playstation-3');
    if(/playstation\s*4|\bps4\b/.test(value))add('playstation-4');
    if(/playstation\s*5|\bps5\b/.test(value))add('playstation-5');
    if(/xbox\s*360/.test(value))add('xbox-360');
    else if(/xbox\s*one/.test(value))add('xbox-one');
    else if(/xbox\s*series/.test(value))add('xbox-series-x');
    else if(/\bxbox\b/.test(value))add('xbox');
    if(/ios|iphone|ipad/.test(value))add('ios');
    if(/android/.test(value))add('android');
    if(/switch/.test(value))add('nintendo-switch');
  }
  return out;
}

function extractOriginalUrl(html,publication,indexUrl){
  const raw=String(html||''),variants=sourceNameVariants(publication);
  for(const name of variants){
    const lower=raw.toLowerCase(),needle=name.toLowerCase();let at=0;
    while((at=lower.indexOf(needle,at))>=0){
      const window=raw.slice(Math.max(0,at-1800),Math.min(raw.length,at+7000));
      for(const match of window.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,500}?FULL\s+REVIEW[\s\S]{0,100}?<\/a>/gi)){
        try{const resolved=new URL(decode(match[1]),indexUrl).href;if(!/metacritic\.com/i.test(new URL(resolved).hostname))return resolved}catch{}
      }
      at+=needle.length;
    }
  }
  return'';
}

function parseMetacriticCritics(html,indexUrl){
  const text=visible(html),rows=[];
  for(const source of sources){
    for(const name of sourceNameVariants(source)){
      const flexible=escapeRx(name).replace(/\\\s+/g,'\\s+');
      const match=text.match(new RegExp(`(?:^|\\s)(100|[1-9]?\\d)\\s+${flexible}(?=\\s|$)`,'i'));
      if(!match)continue;
      const score=Number(match[1]);if(!Number.isFinite(score)||score<0||score>100)continue;
      const after=text.slice((match.index||0)+match[0].length,(match.index||0)+match[0].length+900);
      const quote=after.split(/\b(?:PC|PS[2345]|Xbox|Switch|Wii|Mac|iOS|Android)\b\s*(?:FULL\s+REVIEW)?/i)[0].trim().slice(0,700);
      rows.push({configured_source_id:source.id,publication:source.name,score,scale:100,quote,original_review_url:extractOriginalUrl(html,source,indexUrl)});break;
    }
  }
  return rows;
}

async function fetchIndex(url,platform){
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(10000),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskCriticIndex/15.2)','accept-language':'en-US,en;q=.9'}});
    if(!response.ok)return{url,platform,reachable:false,status:response.status,rows:[]};
    const html=await response.text();return{url,platform,reachable:true,status:response.status,rows:parseMetacriticCritics(html,response.url||url)};
  }catch(error){return{url,platform,reachable:false,status:0,error:error.message,rows:[]}}
}

async function fetchCriticIndex(){
  if(!released)return{url:'',platform:'',reachable:false,status:0,rows:[],attempts:[]};
  const base=`https://www.metacritic.com/game/${slug}/critic-reviews/`,attempts=[];
  const primary=await fetchIndex(base,'primary');attempts.push({url:primary.url,platform:primary.platform,status:primary.status,rows:primary.rows.length});
  if(primary.rows.length>=3)return{...primary,attempts};
  let best=primary;
  for(const token of platformTokens()){
    const result=await fetchIndex(`${base}?platform=${encodeURIComponent(token)}`,token);attempts.push({url:result.url,platform:result.platform,status:result.status,rows:result.rows.length});
    if(result.rows.length>best.rows.length)best=result;
    if(best.rows.length>=5)break;
  }
  return{...best,attempts};
}

function recompute(matrix,review,indexResult){
  const oldAccepted=Array.isArray(matrix.accepted)?matrix.accepted:[];
  const accepted=oldAccepted.filter(item=>!userGenerated(item));
  const removedUserGenerated=oldAccepted.length-accepted.length;
  const bySource=new Map(accepted.map(item=>[item.configured_source_id,item]));
  let indexedAdded=0,indexedScoresAdded=0;
  const method=historical?'historical-critic-index-attribution':'critic-index-attribution';
  for(const row of indexResult.rows){
    const source=sources.find(item=>item.id===row.configured_source_id);if(!source?.review)continue;
    const evidence={method,scope:'editorial_review',checked_at:checkedAt,url:indexResult.url,configured_source_id:source.id,direct_publisher:false,historical,index_source:'metacritic',index_platform:indexResult.platform||'primary',attributed_publication:source.name,aggregate_score_used:false,user_score_used:false,original_review_url:row.original_review_url||''};
    const current=bySource.get(source.id);
    if(current){if(!isTrustedEditorialScore(current)){current.score=row.score;current.scale=100;current.grade='';current.score_eligible=true;current.score_evidence=evidence;indexedScoresAdded++;if(row.quote&&!current.evidence_points?.length)current.evidence_points=[row.quote]}continue}
    const item={id:'',configured_source_id:source.id,publication:source.name,title:`${title} — ${source.name} review`,url:row.original_review_url||indexResult.url,resolved_url:row.original_review_url||indexResult.url,source_kind:'review',platform:indexResult.platform||'',version_context:'',published_at:'',author:'',language:source.language||'',score:row.score,scale:100,grade:'',score_eligible:true,canonical_score_eligible:true,version_validation:{score_eligible:true,reason:'canonical_version'},identity_evidence:`Critic review for ${title} attributed by Metacritic to ${source.name}.`,evidence_points:row.quote?[row.quote]:[],praise:[],criticism:[],mechanics:[],domain:row.original_review_url?(()=>{try{return new URL(row.original_review_url).hostname.replace(/^www\./,'')}catch{return''}})():'metacritic.com',validation:{status:'accepted-critic-index',checked_at:checkedAt,method:'metacritic-critic-attribution-v15.2',index_url:indexResult.url,index_platform:indexResult.platform||'primary',original_review_url:row.original_review_url||''},score_evidence:evidence};
    accepted.push(item);bySource.set(source.id,item);indexedAdded++;
  }
  accepted.forEach((item,index)=>item.id=`source-${index+1}`);
  const quality=read('config/game-page-quality-v2.json',{}),minimum=Number(matrix?.policy?.minimum_sources||review?.publication_gate?.minimum||5),target=Number(matrix?.policy?.target_sources||review?.publication_gate?.target||20),maximum=Number(matrix?.policy?.maximum_sources||review?.publication_gate?.maximum||20),regionalComplete=matrix?.regional_discovery?.complete===true,contemporary=accepted.filter(item=>item.source_kind==='review').length,minContemporary=Number(historical?quality?.review_corpus?.minimum_contemporary_historical:quality?.review_corpus?.minimum_contemporary_modern)||3,green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete,scored=accepted.filter(item=>item.score_eligible&&isTrustedEditorialScore(item)).length,contextOnly=accepted.filter(item=>item.canonical_score_eligible===false).length;
  matrix.schema_version=Math.max(Number(matrix.schema_version||11),13);matrix.generated_at=checkedAt;matrix.accepted=accepted;matrix.rejected=[...(matrix.rejected||[]),...(removedUserGenerated?[{publication:'StopGame',url:'',reasons:[`removed ${removedUserGenerated} user-generated review record(s) during professional-only cleanup`]}]:[])];matrix.policy={...(matrix.policy||{}),critic_index:'metacritic',critic_index_scope:historical?'historical':'released_fallback',metascore_as_vote:false,user_scores_as_votes:false,professional_only:true};matrix.coverage={...(matrix.coverage||{}),accepted:accepted.length,scored,context_only_versions:contextOnly,contemporary,green,passed:green,needs_more:Math.max(0,minimum-accepted.length),critic_index_rows:indexResult.rows.length,critic_index_added:indexedAdded,critic_index_scores_added:indexedScoresAdded,critic_index_platform:indexResult.platform||'',removed_user_generated:removedUserGenerated};
  review.schema_version=Math.max(Number(review.schema_version||11),13);review.updated_at=checkedAt;review.reviews=accepted;review.rejected=matrix.rejected;review.publication_gate={minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision'};review.regional_discovery=matrix.regional_discovery;
  return{accepted,green,scored,indexedAdded,indexedScoresAdded,removedUserGenerated};
}

const matrix=read(`data/research/${slug}-source-matrix.json`,{}),review=read(`data/reviews/${slug}.json`,{}),indexResult=await fetchCriticIndex(),result=recompute(matrix,review,indexResult);
write(`data/research/${slug}-source-matrix.json`,matrix);if(!auditAll)write(`data/reviews/${slug}.json`,review);
const run=read(`data/parser-runs/review-web-discovery-${slug}.json`,{});write(`data/parser-runs/review-web-discovery-${slug}.json`,{...run,parser:'review-professional-critic-index-v15.2',status:result.green?'green':'needs_revision',checked_at:checkedAt,accepted:result.accepted.length,scored:result.scored,professional_only:true,legacy_stack:{primary:legacy,fallback},critic_index:{provider:'metacritic',url:indexResult.url,platform:indexResult.platform,reachable:indexResult.reachable,status:indexResult.status||0,rows:indexResult.rows.length,attempts:indexResult.attempts||[],added_sources:result.indexedAdded,added_scores:result.indexedScoresAdded,metascore_as_vote:false,user_scores_as_votes:false},removed_user_generated:result.removedUserGenerated});
console.log(JSON.stringify({slug,historical,released,professional_only:true,legacy_status:legacy.status,fallback_status:fallback?.status??null,accepted:result.accepted.length,scored:result.scored,critic_index_platform:indexResult.platform||null,critic_index_rows:indexResult.rows.length,indexed_sources_added:result.indexedAdded,indexed_scores_added:result.indexedScoresAdded,removed_user_generated:result.removedUserGenerated,status:result.green?'green':'red-needs-revision'},null,2));
process.exitCode=result.green?0:2;
