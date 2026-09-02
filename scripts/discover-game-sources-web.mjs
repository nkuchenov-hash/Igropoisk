#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/discover-game-sources-web.mjs <game-slug>');
const started=Date.now();
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const outPath=`data/research/${slug}-independent-web-sources.json`;
const cached=read(outPath,null);
if(cached&&process.env.IGROPOISK_SOURCE_DISCOVERY_REFRESH!=='1'){
  console.log(JSON.stringify({...cached,cached:true,sources:undefined},null,2));
  process.exit(0);
}

const draft=read(`data/drafts/${slug}.json`);
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const cfg=read('config/parsers/review-synthesis.json',{});
const quality=read('config/game-page-quality-v2.json',{});
const policy=quality.game_source_corpus||{};
const title=String(draft.identity.title);
const year=Number(String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const minProfessional=Number(policy.minimum_professional_sources||10);
const minScored=Number(quality.rating?.minimum_sources||5);
const checkedAt=new Date().toISOString();
const headers={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36','accept-language':'en-US,en;q=.9,ru;q=.8'};
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const canonical=v=>{try{const u=new URL(String(v||''),'https://duckduckgo.com');if(u.hostname.endsWith('duckduckgo.com')&&u.pathname.startsWith('/l/')){const x=u.searchParams.get('uddg');if(x)return canonical(decodeURIComponent(x))}if(/google\./i.test(u.hostname)&&u.pathname==='/url'){const x=u.searchParams.get('q')||u.searchParams.get('url');if(x)return canonical(x)}u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return''}};
const host=v=>{try{return new URL(v).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const technical=v=>{try{return/(^|\/)(?:_?captcha|login|signin|search)(?:[/?#]|$)/i.test(new URL(v).pathname)}catch{return true}};
const excludedHost=v=>/(metacritic\.com|opencritic\.com|kritikanstvo\.ru|steambase\.io|reddit\.com|steamcommunity\.com|youtube\.com|youtu\.be|rutube\.ru|vkvideo\.ru|fandom\.com|spotify\.com|podbean\.com|zencastr\.com)/i.test(host(v));
const badText=v=>/(walkthrough|guide|wiki|tips|cheat|news|preview|interview|podcast|episode|how[- ]?to|прохожд|гайд|новост|превью|интервью|подкаст)/i.test(String(v||''));
const tokens=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim().split(/\s+/).filter(t=>t.length>1||/^\d+$/.test(t));
const identity=v=>{const h=' '+String(v||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim()+' ';return tokens.every(t=>h.includes(` ${t} `))};
const reviewSignal=v=>/(review|reviewed|retrospective|opinion|verdict|score|rating|реценз|обзор|ретро|мнение|вердикт)/i.test(String(v||''));

const pubs=(cfg.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial').map(s=>{try{return{name:String(s.name||s.id),domain:new URL(s.url).hostname.replace(/^www\./,'').toLowerCase()}}catch{return null}}).filter(Boolean);
for(const x of [
  ['DTF','dtf.ru'],['VGTimes','vgtimes.ru'],['iXBT.games','ixbt.games'],['GameMAG.ru','gamemag.ru'],['Shazoo','shazoo.ru'],
  ['HonestGamers','honestgamers.com'],['Cubed3','cubed3.com'],['Gaming Nexus','gamingnexus.com'],['Old-Games.ru','old-games.ru'],
  ['Absolute Games','ag.ru'],['GameGuru','gameguru.ru'],['Rock Paper Shotgun','rockpapershotgun.com'],['RPGFan','rpgfan.com'],['GameBoomers','gameboomers.com']
])if(!pubs.some(p=>p.domain===x[1]))pubs.push({name:x[0],domain:x[1]});
const publicationFor=url=>pubs.find(p=>host(url)===p.domain||host(url).endsWith('.'+p.domain));
const editorialScoreAllowed=url=>!/(dtf\.ru|stopgame\.ru|vgtimes\.ru|old-games\.ru|gameguru\.ru|gamer\.ru|8gamers\.net)/i.test(host(url));

async function bing(q){const u=new URL('https://www.bing.com/search');u.searchParams.set('format','rss');u.searchParams.set('count','50');u.searchParams.set('q',q);try{const r=await fetch(u,{headers,signal:AbortSignal.timeout(4500)});if(!r.ok)return{ok:false,items:[]};const xml=await r.text(),items=[];for(const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)){const b=m[1],pick=t=>decode((b.match(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`,'i'))||[])[1]||''),url=canonical(pick('link'));if(url)items.push({url,title:pick('title'),description:pick('description')})}return{ok:true,items}}catch{return{ok:false,items:[]}}}
async function google(q){const u=new URL('https://www.google.com/search');u.searchParams.set('q',q);u.searchParams.set('num','20');u.searchParams.set('filter','0');try{const r=await fetch(u,{headers,signal:AbortSignal.timeout(4500)});if(!r.ok)return{ok:false,items:[]};const html=await r.text(),items=[];for(const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const url=canonical(m[1]),t=decode(m[2]);if(url&&/^https?:/.test(url)&&!/(google\.|gstatic\.|googleusercontent\.)/i.test(host(url)))items.push({url,title:t,description:''})}return{ok:true,items}}catch{return{ok:false,items:[]}}}
async function ddg(q){const u=new URL('https://lite.duckduckgo.com/lite/');u.searchParams.set('q',q);try{const r=await fetch(u,{headers,signal:AbortSignal.timeout(4500)});if(!r.ok)return{ok:false,items:[]};const html=await r.text(),items=[];for(const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const url=canonical(m[1]),t=decode(m[2]);if(url&&/^https?:/.test(url)&&!host(url).includes('duckduckgo.com'))items.push({url,title:t,description:''})}return{ok:true,items}}catch{return{ok:false,items:[]}}}
async function search(q){const rr=await Promise.all([bing(q),google(q),ddg(q)]),m=new Map();for(const r of rr)for(const x of r.items){const u=canonical(x.url);if(u&&!m.has(u))m.set(u,{...x,url:u})}return{providers:{bing:rr[0].ok,google:rr[1].ok,duckduckgo_lite:rr[2].ok},items:[...m.values()]}}

const candidates=new Map();
function ingest(items,origin){for(const x of items){const url=canonical(x.url),pub=publicationFor(url),text=`${x.title} ${x.description||''} ${url}`;if(!url||technical(url)||excludedHost(url)||badText(text)||!identity(text))continue;if(!pub&&!reviewSignal(text)&&!/(review|reviews|article|recens|obzor|реценз|обзор)/i.test(new URL(url).pathname))continue;if(!candidates.has(url))candidates.set(url,{publication:pub?.name||host(url),title:x.title||`${title} review`,url,source_kind:/retro|ретро/i.test(text)?'retrospective_review':'review',score:null,scale:null,grade:'',provenance:origin})}}
const providerStats={bing:0,google:0,duckduckgo_lite:0,broad_queries:0,targeted_queries:0};
async function runQueries(qs,origin){const all=await Promise.all(qs.map(async q=>await search(q)));for(const r of all){for(const k of Object.keys(r.providers))if(r.providers[k])providerStats[k]++;ingest(r.items,origin)}return qs.length}

const broad=[`"${title}" review`,`"${title}" reviews`,`"${title}" game review`,`"${title}" retrospective`,`"${title}" рецензия`,`"${title}" обзор`,year?`"${title}" review ${year}`:`"${title}" review`,`"${title}" рейтинг обзор`];
providerStats.broad_queries=await runQueries([...new Set(broad)],'broad-web-search');

function extractScore(html,text){
  for(const [rx,reverse] of [[/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,300}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,false],[/"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,300}?"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,true]]){const m=html.match(rx);if(m){const score=Number(reverse?m[2]:m[1]),scale=Number(reverse?m[1]:m[2]);if(score>=0&&scale>0&&score<=scale)return{score,scale,grade:''}}}
  for(const rx of [/(?:overall\s+score|final\s+score|review\s+score|score|rating|verdict|оценк\w*)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)/i,/\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|20|100)\b/i]){const m=text.match(rx);if(m){const score=Number(m[1]),scale=Number(m[2]);if(score>=0&&score<=scale)return{score,scale,grade:''}}}
  const pct=text.match(/(?:overall\s+score|final\s+score|review\s+score|score|rating|verdict|оценк\w*)\s*[:\-]?\s*([0-9]{1,3})\s*%/i);if(pct){const score=Number(pct[1]);if(score<=100)return{score,scale:100,grade:''}}
  const plain=text.match(/(?:overall\s+score|final\s+score|review\s+score|rating|verdict|оценка)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)(?!\s*\/)/i);if(plain){const score=Number(plain[1]);if(score>=0&&score<=100)return{score,scale:score>10?100:10,grade:''}}
  const share=text.match(/\b([0-9](?:\.[0-9])?|10)\s+(?:[A-Z][A-Za-z0-9 .,'’'&()\-]{0,80}\s+)?Share article\b/i);if(share){const score=Number(share[1]);if(score>=0&&score<=10)return{score,scale:10,grade:''}}
  const grade=text.match(/(?:grade|rating|verdict|оценка)\s*[:\-]?\s*([ABCDF][+-]?)(?:\s|<|$)/i);return{score:null,scale:null,grade:grade?grade[1].toUpperCase():''};
}
async function probe(raw){try{const r=await fetch(raw.url,{redirect:'follow',headers,signal:AbortSignal.timeout(6500)});if(!r.ok)return null;const url=canonical(r.url||raw.url);if(technical(url)||excludedHost(url))return null;const type=(r.headers.get('content-type')||'').toLowerCase();if(!/html|text/.test(type))return null;const html=await r.text(),text=decode(html).slice(0,700000);if(!identity(`${raw.title} ${text.slice(0,25000)}`))return null;const found=extractScore(html,text),eligible=editorialScoreAllowed(url)&&Boolean((Number.isFinite(found.score)&&Number.isFinite(found.scale)&&found.scale>0)||found.grade);return{...raw,url,score:eligible?found.score:null,scale:eligible?found.scale:null,grade:eligible?found.grade:'',score_eligible:eligible,checked_at:checkedAt,validation:{status:'accepted-readable-link',http_status:r.status,checked_at:checkedAt,method:'parallel-direct-editorial-v7'}}}catch{return null}}
async function probeAll(raws){let i=0;const out=[];async function worker(){while(i<raws.length){const x=raws[i++],v=await probe(x);if(v)out.push(v)}}await Promise.all(Array.from({length:Math.min(24,raws.length||1)},worker));return out}
const stats=list=>{const m=new Map();for(const x of list){const k=host(x.url)||x.publication.toLowerCase(),old=m.get(k);if(!old||(!old.score_eligible&&x.score_eligible))m.set(k,x)}return{count:m.size,scored:[...m.values()].filter(x=>x.score_eligible).length}};

let unique=new Map();
for(const x of await probeAll([...candidates.values()]))unique.set(canonical(x.url).toLowerCase(),x);
let sources=[...unique.values()];

// Exhaustively scan every still-unrepresented registered editorial domain. Reaching the minimum
// is an acceptance threshold, not a reason to stop source discovery.
const represented=new Set(sources.map(x=>host(x.url)));
const priority=['cubed3.com','gamingnexus.com','rpgfan.com','gamerevolution.com','ign.com','gamespot.com','eurogamer.net','pcgamer.com','igromania.ru','ag.ru','stopgame.ru','vgtimes.ru','gameguru.ru'];
const missing=pubs.filter(p=>![...represented].some(h=>h===p.domain||h.endsWith('.'+p.domain))).sort((a,b)=>{const ai=priority.indexOf(a.domain),bi=priority.indexOf(b.domain);return(ai<0?999:ai)-(bi<0?999:bi)});
const targeted=[];
for(const p of missing){targeted.push(`"${title}" site:${p.domain}`,`"${title}" review site:${p.domain}`);if(p.domain.endsWith('.ru'))targeted.push(`"${title}" обзор site:${p.domain}`)}
for(let n=0;n<targeted.length;n+=12){
  providerStats.targeted_queries+=await runQueries(targeted.slice(n,n+12),'targeted-publication-search');
  const known=new Set(sources.map(x=>canonical(x.url).toLowerCase()));
  for(const x of await probeAll([...candidates.values()].filter(x=>!known.has(canonical(x.url).toLowerCase()))))unique.set(canonical(x.url).toLowerCase(),x);
  sources=[...unique.values()];
}

sources.sort((a,b)=>Number(b.score_eligible)-Number(a.score_eligible)||a.publication.localeCompare(b.publication,'en'));
const s=stats(sources);
const result={schema_version:7,game_slug:slug,title,checked_at:checkedAt,elapsed_ms:Date.now()-started,providers:providerStats,queries:providerStats.broad_queries+providerStats.targeted_queries,candidates:candidates.size,accepted:sources.length,publication_count:s.count,scored:s.scored,registered_publications_scanned:pubs.length,targeted_publications_scanned:missing.length,minimum_professional_sources:minProfessional,minimum_scored_sources:minScored,coverage_passed:s.count>=minProfessional&&s.scored>=minScored,sources};
write(outPath,result);
write(`data/parser-runs/independent-web-sources-${slug}.json`,{parser:'independent-game-source-web-discovery-v7',status:result.coverage_passed?'green':'needs_revision',checked_at:checkedAt,game_slug:slug,elapsed_ms:result.elapsed_ms,accepted:sources.length,publication_count:s.count,scored:s.scored,registered_publications_scanned:pubs.length,targeted_publications_scanned:missing.length,providers:providerStats,output:outPath});
console.log(JSON.stringify({...result,sources:undefined},null,2));
