#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/discover-game-publication-hubs.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`,{});
const title=String(draft?.identity?.title||'').trim();
if(!title)throw new Error(`Missing draft/title for ${slug}`);
const checkedAt=new Date().toISOString();
const headers={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36','accept-language':'en-US,en;q=.9'};
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const canonical=(v,base)=>{try{const u=new URL(String(v||''),base);u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(k);return`${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return''}};
const tokens=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim().split(/\s+/).filter(t=>t.length>1||/^\d+$/.test(t));
const identity=v=>{const h=' '+String(v||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim()+' ';return tokens.every(t=>h.includes(` ${t} `))};
async function fetchHtml(url,ms=7000){try{const r=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(ms)});if(!r.ok)return null;return{url:r.url,status:r.status,html:await r.text()}}catch{return null}}
function links(html,base){const out=[];for(const m of String(html||'').matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){const url=canonical(m[1],base),label=decode(m[2]);if(url)out.push({url,label})}return out}
function scoreFrom(html,text){
 for(const [rx,scale] of [[/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,null],[/\b(?:GameSpot|review)\s*(?:score)?\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10\b/i,10],[/\b([0-9]+(?:\.[0-9]+)?)\s*\/\s*10\b/i,10]]){const m=String(html||text).match(rx);if(m){const n=Number(m[1]);if(Number.isFinite(n)&&n>=0&&n<=10)return{score:n,scale:scale||10}}}
 const json=[...String(html||'').matchAll(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi)].map(m=>Number(m[1])).filter(n=>n>=0&&n<=10);if(json.length)return{score:json[0],scale:10};
 return{score:null,scale:null};
}
const sources=[];
async function gameSpot(){
 const hub=`https://www.gamespot.com/games/${slug}/reviews/`;
 const page=await fetchHtml(hub);if(!page)return;
 const candidates=new Map();
 for(const x of links(page.html,hub)){
   if(!/gamespot\.com\/reviews\//i.test(x.url))continue;
   if(!identity(`${x.label} ${x.url}`)&&!/arx-fatalis|review/i.test(x.label))continue;
   candidates.set(x.url,{url:x.url,label:x.label});
 }
 // Search-result pages occasionally hide the canonical review link from simple anchors; use embedded URLs too.
 for(const m of page.html.matchAll(/https?:\\?\/\\?\/(?:www\.)?gamespot\.com\/reviews\/[A-Za-z0-9_\-\/]+/gi)){
   const u=canonical(m[0].replace(/\\\//g,'/'),hub);if(u)candidates.set(u,{url:u,label:`${title} Review`});
 }
 let checked=0;
 for(const c of [...candidates.values()].slice(0,12)){
   const r=await fetchHtml(c.url);if(!r)continue;checked++;
   const text=decode(r.html).slice(0,500000),heading=decode((r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');
   if(!identity(`${heading} ${text.slice(0,15000)}`)||!/(review)/i.test(`${heading} ${new URL(r.url).pathname}`))continue;
   const score=scoreFrom(r.html,text);
   sources.push({publication:'GameSpot',title:heading||c.label||`${title} Review`,url:canonical(r.url,hub),source_kind:'review',professional:true,score:score.score,scale:score.scale,grade:'',score_eligible:Number.isFinite(score.score),checked_at:checkedAt,provenance:'gamespot-review-hub',validation:{status:'accepted-direct-review',http_status:r.status,checked_at:checkedAt,method:'publication-review-hub-v1'}});
 }
 return{hub,checked,candidates:candidates.size};
}
const gameSpotStats=await gameSpot();
const unique=[...new Map(sources.map(x=>[x.url.toLowerCase(),x])).values()];
const output={schema_version:1,game_slug:slug,title,checked_at:checkedAt,adapters:{gamespot:gameSpotStats||null},sources:unique};
write(`data/research/${slug}-publication-hubs.json`,output);
console.log(JSON.stringify({slug,sources:unique.length,adapters:output.adapters},null,2));
