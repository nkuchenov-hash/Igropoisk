import fs from 'node:fs';
import path from 'node:path';
import {buildReviewIdentityProfile,evaluateReviewSourceIdentity,normalizeReviewIdentity} from './lib/review-source-identity.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/enrich-review-native-sources.mjs <game-slug>');
const read=(rel,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'))}catch{return fallback}};
const write=(rel,value)=>{const target=path.join(root,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`);const feed=read(`data/reviews/${slug}.json`);
if(!draft||!feed)throw new Error(`Missing page research inputs for ${slug}`);
const title=String(draft.identity?.title||slug),checkedAt=new Date().toISOString();
const identityProfile=buildReviewIdentityProfile(draft,slug);
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const decode=value=>String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const normalize=normalizeReviewIdentity;
const tokens=normalize(title).split(' ').filter(t=>/^\d+$/.test(t)||t.length>1),identityPhrase=tokens.join(' ');
const identityMatches=value=>{const hay=` ${normalize(value)} `;return tokens.every(t=>hay.includes(` ${t} `))};
const strictIdentityMatches=value=>{const hay=normalize(value);if(!identityPhrase)return true;return hay.includes(identityPhrase)};
const reviewSignal=value=>/(review|retro(?:spective|view)?|opinion|recenz|реценз|обзор|ретро|мнение)/i.test(String(value||''));
async function fetchPage(url){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskNativeReviewDiscovery/1.3)','accept-language':'en-US,en;q=.9,ru;q=.8'}});if(!r.ok)return{ok:false,status:r.status,url:r.url||url,html:''};return{ok:true,status:r.status,url:r.url||url,html:await r.text()}}catch(error){return{ok:false,status:0,url,error:error.message,html:''}}}
function linksFrom(html,base,allowedHost=''){const out=[];for(const m of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){let href;try{href=new URL(m[1],base).href}catch{continue}const label=decode(m[2]);if(allowedHost){const h=host(href);if(h!==allowedHost&&!h.endsWith(`.${allowedHost}`))continue}if(strictIdentityMatches(`${label} ${href}`)&&reviewSignal(`${label} ${href}`))out.push({url:href,title:label||`${title} review`})}return out}
function extractScore(html){const text=decode(html);for(const rx of [/Overall\s+Score\s*([0-9]+(?:\.[0-9]+)?)/i,/(?:GameSpot|Score|Rating)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*(10|100))?/i,/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,100}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i]){const m=html.match(rx)||text.match(rx);if(!m)continue;const score=Number(m[1]),scale=m[2]?Number(m[2]):score>10?100:100;if(Number.isFinite(score)&&Number.isFinite(scale)&&score>=0&&score<=scale)return{score,scale}}return{score:null,scale:null}}
const raw=[];const add=(publication,configured_source_id,url,titleText,origin,published_at='')=>{if(!url)return;raw.push({publication,configured_source_id,url:canonical(url),title:titleText||`${title} review`,origin,published_at})};
add('RPGFan','rpgfan',`https://www.rpgfan.com/review/${slug}/`,`${title} Review`,'RPGFan canonical review slug');
add('RPGFan','rpgfan',`https://www.rpgfan.com/review/${slug}-2/`,`${title} Review`,'RPGFan secondary review slug');
add('RPGamer','rpgamer',`https://rpgamer.com/review/${slug}-review/`,`${title} Retroview`,'RPGamer canonical review slug');
for(const page of [
 {publication:'RPGFan',id:'rpgfan',url:`https://www.rpgfan.com/game/${slug}/`,host:'rpgfan.com'},
 {publication:'RPGamer',id:'rpgamer',url:`https://rpgamer.com/?s=${encodeURIComponent(title)}`,host:'rpgamer.com'},
 {publication:'GameSpot',id:'gamespot',url:`https://www.gamespot.com/games/${slug}/reviews/`,host:'gamespot.com'},
 {publication:'GameRevolution',id:'game-revolution',url:`https://www.gamerevolution.com/?s=${encodeURIComponent(title)}`,host:'gamerevolution.com'}
]){const result=await fetchPage(page.url);if(result.ok)for(const item of linksFrom(result.html,result.url,page.host))add(page.publication,page.id,item.url,item.title,`${page.publication} native index/search`)}
try{const result=await fetchPage(`https://www.gamerevolution.com/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=100`);if(result.ok){const rows=JSON.parse(result.html);for(const row of Array.isArray(rows)?rows:[])if(strictIdentityMatches(`${row.title||''} ${row.url||''}`)&&reviewSignal(`${row.title||''} ${row.url||''}`))add('GameRevolution','game-revolution',row.url,decode(row.title),`GameRevolution WP native search`)}}catch{}

const candidates=[];const seen=new Set();
for(const item of feed.reviews||[]){const url=canonical(item.resolved_url||item.url);if(!url)continue;const key=url.toLowerCase();if(seen.has(key))continue;seen.add(key);candidates.push({...item,url,origin:'existing corpus revalidation',existing:true})}
for(const item of raw){const key=item.url.toLowerCase();if(seen.has(key))continue;seen.add(key);candidates.push(item)}
const accepted=[];const rejected=[];
for(const item of candidates){
  if(!strictIdentityMatches(`${item.title} ${item.url}`)){rejected.push({...item,status:0,reason:'canonical game title missing from candidate title/url'});continue}
  const live=await fetchPage(item.url);
  if(!live.ok){rejected.push({...item,status:live.status||0,reason:'source unreadable during identity verification'});continue}
  const pageText=decode(live.html).slice(0,12000);
  if(!identityMatches(`${item.title} ${live.url} ${pageText}`)||!reviewSignal(`${item.title} ${live.url} ${pageText.slice(0,1600)}`)){rejected.push({...item,status:live.status,reason:'title/review signal mismatch'});continue}
  const identity=evaluateReviewSourceIdentity(identityProfile,{title:item.title,url:live.url,publication:item.publication,pageText,html:live.html,publishedAt:item.published_at});
  if(!identity.accepted){rejected.push({...item,status:live.status,reason:`game identity rejected: ${identity.reason}`,identity});continue}
  const scoreData=extractScore(live.html);
  const score=Number.isFinite(Number(item.score))?Number(item.score):scoreData.score;
  const scale=Number.isFinite(Number(item.scale))?Number(item.scale):scoreData.scale;
  accepted.push({id:'',configured_source_id:item.configured_source_id||'',publication:item.publication||host(live.url),title:item.title,url:item.url,resolved_url:canonical(live.url),source_kind:item.source_kind||(/retro/i.test(`${item.title} ${item.url}`)?'retrospective_review':'review'),platform:item.platform||'',version_context:item.version_context||'',published_at:item.published_at||'',author:item.author||'',language:item.language||'',score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade:item.grade||'',score_eligible:Number.isFinite(score)&&Number.isFinite(scale)&&scale>0,identity_evidence:`${identity.reason}; ${identity.evidence.join(', ')}`,domain:host(live.url),validation:{status:'accepted-readable-link',checked_at:checkedAt,http_status:live.status,method:'publisher-native-discovery-v1.3-strong-identity',origin:item.origin||'native discovery',identity}})
}
accepted.forEach((item,index)=>item.id=`source-${index+1}`);
const scoreSeen=new Set(),scores=[];for(const item of accepted){const publication=String(item.publication||item.source||'').trim(),key=publication.toLowerCase(),score=Number(item.score),scale=Number(item.scale),grade=String(item.grade||'').trim();if(!publication||scoreSeen.has(key)||(!(Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)&&!grade))continue;scoreSeen.add(key);scores.push({publication,title:item.title||'',url:canonical(item.resolved_url||item.url),score:Number.isFinite(score)?score:null,scale:Number.isFinite(scale)?scale:null,grade,source_kind:item.source_kind||'review'})}
const identityRejected=rejected.filter(item=>String(item.reason||'').includes('identity')).length;
feed.reviews=accepted;feed.score_sources=scores;feed.updated_at=checkedAt;feed.rejected=[...(feed.rejected||[]),...rejected].slice(-250);feed.publication_gate={...(feed.publication_gate||{}),maximum:null,accepted:accepted.length,identity_verified:true,identity_rejected:identityRejected,status:accepted.length===0&&identityRejected>0?'red-needs-revision':feed.publication_gate?.status};
write(`data/reviews/${slug}.json`,feed);write(`data/parser-runs/review-native-discovery-${slug}.json`,{parser:'publisher-native-review-discovery-v1.3-strong-identity',game_slug:slug,checked_at:checkedAt,accepted:accepted.length,rejected:rejected.length,identity_rejected:identityRejected,total_reviews:feed.reviews.length,total_score_sources:scores.length});console.log(JSON.stringify({slug,total_reviews:feed.reviews.length,total_score_sources:scores.length,rejected:rejected.length,identity_rejected:identityRejected,status:feed.publication_gate?.status},null,2));
