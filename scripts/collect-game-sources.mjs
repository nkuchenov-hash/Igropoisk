#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/collect-game-sources.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const canonical=v=>{try{const u=new URL(String(v||''));u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return`${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(v||'').trim()}};
const host=v=>{try{return new URL(v).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const pathname=v=>{try{return new URL(v).pathname||'/'}catch{return'/'}};
const draft=read(`data/drafts/${slug}.json`);if(!draft?.identity?.title)throw new Error(`Missing game draft for ${slug}`);
const checkedAt=new Date().toISOString(),quality=read('config/game-page-quality-v2.json',{}),corpusPolicy=quality.game_source_corpus||quality.review_corpus||{},ratingPolicy=quality.rating||{};
const minimumProfessional=Number(corpusPolicy.minimum_professional_sources??corpusPolicy.minimum_sources??10),minimumScored=Number(ratingPolicy.minimum_sources??5);
let discovered=read(`data/research/${slug}-independent-web-sources.json`,null),webRun={status:0,cached:Boolean(discovered)};
if(!discovered){const run=spawnSync(process.execPath,[path.join(root,'scripts/discover-game-sources-web.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:24*1024*1024});webRun={status:run.status,cached:false};discovered=read(`data/research/${slug}-independent-web-sources.json`,{})}
let publicationHubs=read(`data/research/${slug}-publication-hubs.json`,null),hubRun={status:0,cached:Boolean(publicationHubs)};
if(!publicationHubs&&fs.existsSync(path.join(root,'scripts/discover-game-publication-hubs.mjs'))){const run=spawnSync(process.execPath,[path.join(root,'scripts/discover-game-publication-hubs.mjs'),slug],{cwd:root,env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});hubRun={status:run.status,cached:false};publicationHubs=read(`data/research/${slug}-publication-hubs.json`,{})}
const reviews=read(`data/reviews/${slug}.json`,{}),rating=read(`data/ratings/${slug}.json`,{}),parser=read(`data/parser-output/${slug}.json`,{}),seen=new Map();
const directReview=(raw,url)=>{
 const h=host(url),p=pathname(url),title=String(raw.title||raw.name||raw.publication||'');
 if(/(?:metacritic|opencritic|kritikanstvo|gamerankings)\./i.test(h))return false;
 if(p==='/'||p==='')return false;
 if(/^\/games\/[^/]+\/?$/i.test(p))return false;
 if(/\/game\/[^/]+\/?$/i.test(p))return false;
 if(/\/game\/[^/]+\/reviews\/?$/i.test(p)&&/stopgame\.ru$/i.test(h))return false;
 if(/пользовательск\w*\s+отзыв|user\s+reviews?|review\s+at\b/i.test(title))return false;
 const scorePresent=raw.score_eligible===true||(raw.score!==null&&raw.score!==undefined&&raw.score!==''&&raw.scale!==null&&raw.scale!==undefined&&raw.scale!=='');
 const signal=/(?:review|reviews|reviewed|retrospective|opinion|verdict|critic|реценз|обзор|мнение|вердикт)/i.test(`${title} ${p}`)||/^\/r-[^/]+/i.test(p);
 return Boolean(scorePresent||signal);
};
function add(raw={}){
 const url=canonical(raw.url||raw.resolved_url||raw.source_url||'');if(!url)return;const key=url.toLowerCase(),existing=seen.get(key),rawKind=String(raw.kind||raw.type||raw.source_kind||existing?.kind||'source');
 const requestedProfessional=Boolean(raw.professional??existing?.professional??rawKind==='professional-review');
 const professional=Boolean(requestedProfessional&&directReview(raw,url));
 const editorial=['editorial','review','retrospective_review','opinion','longread','professional-review'].includes(rawKind)||requestedProfessional;
 const kind=editorial?(professional?'professional-review':'editorial-source'):rawKind;
 const roles=[...new Set([...(existing?.roles||[]),...(editorial?['description','dna','review','media']:[]),...(professional?['rating']:[]),...(raw.roles||[])].filter(Boolean))];
 const hasScore=professional&&raw.score!==null&&raw.score!==''&&raw.scale!==null&&raw.scale!==''&&Number.isFinite(Number(raw.score))&&Number.isFinite(Number(raw.scale))&&Number(raw.scale)>0;
 const next={id:existing?.id||`source-${seen.size+1}`,name:String(raw.name||raw.publication||raw.source_name||raw.source||existing?.name||host(url)||'Источник'),title:String(raw.title||existing?.title||''),url,domain:host(url),kind,professional,roles,score:hasScore?Number(raw.score):(professional?existing?.score??null:null),scale:hasScore?Number(raw.scale):(professional?existing?.scale??null:null),grade:professional?String(raw.grade||existing?.grade||''):'',score_eligible:Boolean(professional&&(raw.score_eligible??existing?.score_eligible??false)),checked_at:String(raw.checked_at||raw.validation?.checked_at||existing?.checked_at||checkedAt),provenance:String(raw.provenance||existing?.provenance||'game-page-source-corpus')};
 if(professional&&Number.isFinite(next.score)&&Number.isFinite(next.scale)&&next.scale>0){next.score_eligible=true;next.normalized_10=Number((next.score/next.scale*10).toFixed(3))}else if(professional&&next.grade)next.score_eligible=true;else if(!professional){next.score=null;next.scale=null;next.grade='';next.score_eligible=false;delete next.normalized_10}
 seen.set(key,next)
}
for(const item of draft.sources||[])add({...item,roles:['facts','description','dna']});
if(parser?.source?.url)add({name:parser.source.name||'Parser source',url:parser.source.url,type:'structured-source',roles:['identity','facts','requirements','media']});
if(draft.links?.official)add({name:'Официальный сайт',url:draft.links.official,type:'official',roles:['identity','facts','media','description','dna']});
if(draft.links?.store)add({name:'Страница магазина',url:draft.links.store,type:'store',roles:['identity','facts','requirements','media','description','dna']});
for(const item of [...(draft.media?.screenshots||[]),...(draft.media?.artwork||[]),...(draft.media?.videos||[])])if(item&&typeof item==='object'&&item.source_url)add({name:item.source_name||'Медиа-источник',url:item.source_url,type:'media-source',roles:['media','dna']});
for(const item of reviews.reviews||[])add({...item,kind:'professional-review',professional:true});
for(const item of reviews.score_sources||[])add({...item,kind:'professional-review',professional:true});
for(const item of discovered?.sources||[])add({...item,provenance:item.provenance||'independent-web-search'});
for(const item of publicationHubs?.sources||[])add({...item,kind:'professional-review',professional:true,provenance:item.provenance||'publication-review-hub'});
for(const item of rating.sources||[])add({name:item.publication,title:item.title,url:item.url,kind:'professional-review',professional:true,score:item.original_score?.score,scale:item.original_score?.scale,grade:item.original_score?.grade,score_eligible:true});
const sources=[...seen.values()].sort((a,b)=>Number(b.professional)-Number(a.professional)||Number(b.score_eligible)-Number(a.score_eligible)||a.name.localeCompare(b.name,'ru'));
const professional=sources.filter(x=>x.professional&&x.kind==='professional-review'),pubs=new Map();for(const x of professional){const k=x.domain||x.name.toLowerCase(),old=pubs.get(k);if(!old||(!old.score_eligible&&x.score_eligible))pubs.set(k,x)}
const professionalCount=pubs.size,scoredCount=[...pubs.values()].filter(x=>x.score_eligible).length,scanComplete=professionalCount>=minimumProfessional&&scoredCount>=minimumScored;
const output={schema_version:9,game_slug:slug,game_id:draft.game_id||reviews.game_id||null,title:draft.identity.title,generated_at:checkedAt,ownership:'game-page-module',purpose:'Canonical reusable evidence corpus for game page, Game DNA, media, descriptions, rating and editorial review.',discovery:{method:'multi-engine-direct-review-discovery-plus-publication-hubs',complete:scanComplete,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,professional_minimum_passed:professionalCount>=minimumProfessional,scored_minimum_passed:scoredCount>=minimumScored,web_search_cached:webRun.cached,web_discovery_exit_code:webRun.status,publication_hubs_cached:hubRun.cached,publication_hubs_exit_code:hubRun.status,publication_hub_sources:publicationHubs?.sources?.length||0,providers:discovered?.providers||{},query_count:discovered?.queries||0,candidate_count:discovered?.candidates||0,accepted_count:discovered?.accepted||0,distinct_publications:professionalCount,ai_required:false,direct_review_only_for_professional_count:true},counts:{total:sources.length,scored:scoredCount,professional_reviews:professionalCount,editorial_sources:sources.filter(x=>x.kind==='editorial-source').length},sources};
write(`data/game-sources/${slug}.json`,output);write(`data/parser-runs/game-sources-${slug}.json`,{parser:'game-source-corpus',status:scanComplete?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,total_sources:sources.length,scored_sources:scoredCount,professional_reviews:professionalCount,minimum_professional_sources:minimumProfessional,minimum_scored_sources:minimumScored,web_search_cached:webRun.cached,web_discovery_exit_code:webRun.status,publication_hubs_exit_code:hubRun.status,scan_complete:scanComplete,output:`data/game-sources/${slug}.json`});
console.log(JSON.stringify({slug,status:scanComplete?'green':'needs_revision',total:sources.length,professional_reviews:professionalCount,scored:scoredCount,editorial_sources:output.counts.editorial_sources,publication_hub_sources:publicationHubs?.sources?.length||0,scan_complete:scanComplete,web_search_cached:webRun.cached,web_discovery_ms:discovered?.elapsed_ms??null},null,2));if(!scanComplete)process.exitCode=2;
