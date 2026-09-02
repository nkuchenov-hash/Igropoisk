#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/discover-game-sources-web.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`);if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const config=read('config/parsers/review-synthesis.json',{});
const quality=read('config/game-page-quality-v2.json',{});
const policy=quality.game_source_corpus||{};
const title=String(draft.identity.title),year=Number(String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const minimum=Number(policy.minimum_professional_sources||10),minimumScored=Number(quality.rating?.minimum_sources||5),checkedAt=new Date().toISOString();
const decodeHtml=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const canonical=v=>{try{const u=new URL(String(v||''), 'https://duckduckgo.com');if(u.hostname.endsWith('duckduckgo.com')&&u.pathname.startsWith('/l/')){const target=u.searchParams.get('uddg');if(target)return canonical(decodeURIComponent(target))}u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return''}};
const host=v=>{try{return new URL(v).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const blocked=v=>/(metacritic\.com|opencritic\.com|reddit\.com|steamcommunity\.com|youtube\.com|youtu\.be|fandom\.com)/i.test(host(v));
const bad=v=>/(walkthrough|guide|wiki|tips|cheat|news|preview|interview|how[- ]?to|прохожд|гайд|новост|превью|интервью)/i.test(String(v||''));
const tokens=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim().split(/\s+/).filter(t=>t.length>1||/^\d+$/.test(t));
const identity=v=>{const h=' '+String(v||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim()+' ';return tokens.every(t=>h.includes(` ${t} `))};
const reviewish=v=>/(review|reviewed|retrospective|opinion|verdict|score|rating|реценз|обзор|ретро|мнение|вердикт)/i.test(String(v||''));
const sourceDomains=(config.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial').map(s=>{try{return {name:String(s.name||s.id),domain:new URL(s.url).hostname.replace(/^www\./,'')}}catch{return null}}).filter(Boolean);
for(const extra of [{name:'DTF',domain:'dtf.ru'},{name:'VGTimes',domain:'vgtimes.ru'},{name:'iXBT.games',domain:'ixbt.games'},{name:'GameMAG.ru',domain:'gamemag.ru'},{name:'Shazoo',domain:'shazoo.ru'}])if(!sourceDomains.some(x=>x.domain===extra.domain))sourceDomains.push(extra);

async function ddg(query){
  const url=new URL('https://html.duckduckgo.com/html/');url.searchParams.set('q',query);
  try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36','accept-language':'en-US,en;q=.9,ru;q=.8'},signal:AbortSignal.timeout(12000)});if(!r.ok)return{ok:false,status:r.status,items:[]};const html=await r.text(),items=[];for(const m of html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const url=canonical(m[1]),name=decodeHtml(m[2]);if(url)items.push({url,title:name,description:''})}if(!items.length){for(const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const url=canonical(m[1]),name=decodeHtml(m[2]);if(url&&/^https?:/.test(url)&&!host(url).includes('duckduckgo.com'))items.push({url,title:name,description:''})}}return{ok:true,status:r.status,items}}catch(error){return{ok:false,status:0,error:error.message,items:[]}}
}
async function bing(query){const u=new URL('https://www.bing.com/search');u.searchParams.set('format','rss');u.searchParams.set('count','50');u.searchParams.set('q',query);try{const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=.9,ru;q=.8'},signal:AbortSignal.timeout(12000)});if(!r.ok)return{ok:false,status:r.status,items:[]};const xml=await r.text(),items=[];for(const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)){const b=m[1],pick=t=>decodeHtml((b.match(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`,'i'))||[])[1]||'');const url=pick('link');if(url)items.push({url,title:pick('title'),description:pick('description')})}return{ok:true,status:r.status,items}}catch(error){return{ok:false,status:0,error:error.message,items:[]}}}
async function search(query){const [d,b]=await Promise.all([ddg(query),bing(query)]);const map=new Map();for(const x of [...d.items,...b.items]){const u=canonical(x.url);if(u&&!map.has(u))map.set(u,{...x,url:u})}return{ok:d.ok||b.ok,providers:{duckduckgo:d.ok,bing:b.ok},items:[...map.values()]}}

const querySet=new Set([`"${title}" review`, `"${title}" game review`, `"${title}" retrospective`, `"${title}" рецензия`, `"${title}" обзор`, year?`"${title}" review ${year}`:`"${title}" review`]);
for(const s of sourceDomains)querySet.add(`"${title}" review site:${s.domain}`);
for(const s of sourceDomains.filter(s=>/\.ru$/.test(s.domain)))querySet.add(`"${title}" обзор site:${s.domain}`);
const queries=[...querySet],candidates=new Map(),providerStats={duckduckgo:0,bing:0,queries:queries.length};
let cursor=0;
async function worker(){while(cursor<queries.length){const q=queries[cursor++],res=await search(q);if(res.providers.duckduckgo)providerStats.duckduckgo++;if(res.providers.bing)providerStats.bing++;for(const item of res.items){const url=canonical(item.url),text=`${item.title} ${item.description} ${url}`;if(!url||blocked(url)||bad(text)||!identity(text)||!reviewish(text))continue;if(!candidates.has(url))candidates.set(url,{publication:sourceDomains.find(s=>host(url)===s.domain||host(url).endsWith('.'+s.domain))?.name||host(url),title:item.title||`${title} review`,url,source_kind:/retro|ретро/i.test(text)?'retrospective_review':'review',score:null,scale:null,grade:'',provenance:'independent-web-search'})}}}
await Promise.all(Array.from({length:Math.min(8,queries.length)},()=>worker()));

async function probe(raw){try{const r=await fetch(raw.url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36','accept-language':'en-US,en;q=.9,ru;q=.8'},signal:AbortSignal.timeout(12000)});if(!r.ok)return null;const type=(r.headers.get('content-type')||'').toLowerCase();if(!/html|text/.test(type))return null;const html=await r.text(),text=decodeHtml(html).slice(0,500000);if(!identity(`${raw.title} ${text.slice(0,10000)}`))return null;let score=null,scale=null,grade='';const json=html.match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,160}?"bestRating"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);if(json){score=Number(json[1]);scale=Number(json[2])}if(score===null){for(const rx of [/(?:score|rating|verdict|оценк\w*)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*(5|10|100)/i,/\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*(10|100)\b/i]){const m=text.match(rx);if(m){const a=Number(m[1]),b=Number(m[2]);if(a>=0&&a<=b){score=a;scale=b;break}}}}if(score===null){const g=text.match(/(?:grade|rating)\s*[:\-]?\s*([ABCDF][+-]?)(?:\s|<|$)/i);if(g)grade=g[1].toUpperCase()}return{...raw,url:canonical(r.url||raw.url),score,scale,grade,score_eligible:Boolean((Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)||grade),checked_at:checkedAt,validation:{status:'accepted-readable-link',http_status:r.status,checked_at:checkedAt,method:'independent-search-live-http-v1'}}}catch{return null}}
const raws=[...candidates.values()],accepted=[];let p=0;async function probeWorker(){while(p<raws.length){const item=raws[p++],live=await probe(item);if(live)accepted.push(live)}}await Promise.all(Array.from({length:Math.min(8,raws.length||1)},()=>probeWorker()));
const unique=new Map();for(const x of accepted){const k=canonical(x.url).toLowerCase();if(!unique.has(k))unique.set(k,x)}const sources=[...unique.values()];sources.sort((a,b)=>Number(b.score_eligible)-Number(a.score_eligible)||a.publication.localeCompare(b.publication,'en'));
const scored=sources.filter(x=>x.score_eligible).length;
const result={schema_version:1,game_slug:slug,title,checked_at:checkedAt,providers:providerStats,queries:queries.length,candidates:candidates.size,accepted:sources.length,scored,minimum_professional_sources:minimum,minimum_scored_sources:minimumScored,coverage_passed:sources.length>=minimum&&scored>=minimumScored,sources};
write(`data/research/${slug}-independent-web-sources.json`,result);write(`data/parser-runs/independent-web-sources-${slug}.json`,{parser:'independent-game-source-web-discovery',status:result.coverage_passed?'green':'needs_revision',checked_at:checkedAt,game_slug:slug,accepted:sources.length,scored,providers:providerStats,output:`data/research/${slug}-independent-web-sources.json`});console.log(JSON.stringify({...result,sources:undefined},null,2));
