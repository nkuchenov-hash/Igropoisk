import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const feeds = [
  { source: 'Игромания', url: 'https://www.igromania.ru/rss/rss_all.xml', language: 'ru', authority: 1.05 },
  { source: 'StopGame', url: 'https://stopgame.ru/rss/news.xml', language: 'ru', authority: 1.05 },
  { source: 'PlayGround.ru', url: 'https://www.playground.ru/rss/news.xml', language: 'ru', authority: 0.9 }
];
const regionalSeeds = [
  {
    source: 'Игромания',
    language: 'ru',
    sourceWeight: 1.05,
    title: 'Atomic Heart выпустили в Steam для игроков из России и ряда стран СНГ',
    summary: 'Atomic Heart стала доступна в Steam для игроков из России, Казахстана и ряда стран СНГ после прежней эксклюзивности VK Play.',
    publishedAt: '2026-08-03T00:00:00.000Z',
    url: 'https://www.igromania.ru/news/167724/atomic-heart-vyipustili-v-steam-dlya-igrokov-iz-rossii-i-kazahstana/',
    regions: ['cis']
  }
];
const file = 'data/news.json';
const imageDirectory = 'assets/news';
const userAgent = 'IgropoiskRegionalNewsBot/1.1 (+https://github.com/nkuchenov-hash/Igropoisk)';
const maxAgeDays = 7;

const regionRules = [
  { id: 'cis', countries: ['RU','KZ','BY','AM','AZ','GE','KG','MD','TJ','TM','UZ'], pattern: /росси|казахстан|беларус|снг|армени|азербайджан|грузи|кыргыз|молдов|таджик|туркмен|узбекистан|рубл|тенге|vk play/i },
  { id: 'europe', countries: ['EU','GB','NO','CH','IS'], pattern: /европ|евросоюз|\beu\b|великобритан|британи|германи|франци|итали|испан|польш/i },
  { id: 'north-america', countries: ['US','CA','MX'], pattern: /сша|америк|канад|мексик|\bus\b/i },
  { id: 'japan', countries: ['JP'], pattern: /япони|японск/i },
  { id: 'korea', countries: ['KR'], pattern: /коре|корейск/i },
  { id: 'china', countries: ['CN','HK','MO','TW'], pattern: /кита|китайск|гонконг|тайван/i },
  { id: 'latam', countries: ['BR','AR','CL','CO','PE'], pattern: /бразил|аргентин|чили|колумби|перу|латинск.*америк/i },
  { id: 'mena', countries: ['AE','SA','TR','IL','EG'], pattern: /ближн.*восток|саудов|эмират|турци|израил|егип/i },
  { id: 'sea', countries: ['SG','MY','ID','TH','VN','PH'], pattern: /юго-восточн.*ази|сингапур|малайзи|индонези|таиланд|вьетнам|филиппин/i },
  { id: 'oceania', countries: ['AU','NZ'], pattern: /австрали|нов.*зеланд/i }
];

const regionalImpact = /(?:выш\w*|появ\w*|вернул\w*|стал\w* доступ|недоступ|запрет|блокир|огранич|снят\w* с продаж|продаж\w* прекращ|эксклюзив|локализац|русск\w* язык|региональн\w* цен|цены? в|steam|playstation store|xbox store|nintendo eshop|epic games store|vk play)/i;

function decode(value='') { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function strip(value='') { return decode(value).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function tag(block,names) { for (const name of names) { const match=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i')); if(match) return decode(match[1]).trim(); } return ''; }
function attr(text,name) { return text.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1] || ''; }
function absolute(value,base) { try { const u=new URL(value,base); return /^https?:$/.test(u.protocol)?u.href:''; } catch { return ''; } }
function normalize(value='') { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function tokens(value='') { return new Set(normalize(value).split(' ').filter(x=>x.length>=3)); }
function similarity(a,b) { const x=tokens(a), y=tokens(b); if(!x.size||!y.size)return 0; let n=0; for(const t of x) if(y.has(t)) n++; return n/Math.min(x.size,y.size); }
function regionsFor(text) { return regionRules.filter(rule=>rule.pattern.test(text)).map(rule=>rule.id); }

async function fetchText(url, timeout=18000, accept='text/html,application/xml;q=0.9,*/*;q=0.8') {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
  try { const response=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':userAgent,accept}}); if(!response.ok) throw new Error(`${response.status} ${response.statusText}`); return {text:await response.text(),finalUrl:response.url||url,contentType:response.headers.get('content-type')||''}; }
  finally { clearTimeout(timer); }
}

function parseFeed(xml,feed) {
  const blocks=[...(xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]),...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi)||[])];
  return blocks.slice(0,80).map(block=>{
    const title=strip(tag(block,['title']));
    const linkTag=block.match(/<link\b[^>]*>/i)?.[0]||'';
    const url=absolute(strip(tag(block,['link']))||attr(linkTag,'href'),feed.url);
    const summary=strip(tag(block,['description','summary','content:encoded','content'])).slice(0,420);
    const rawDate=strip(tag(block,['pubDate','published','updated','dc:date']));
    const date=new Date(rawDate||Date.now());
    const publishedAt=Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();
    const text=`${title} ${summary}`;
    return {title,summary,url,publishedAt,source:feed.source,language:feed.language,sourceWeight:feed.authority,regions:regionsFor(text)};
  }).filter(item=>item.title&&item.url&&item.regions.length&&regionalImpact.test(`${item.title} ${item.summary}`)&&Date.now()-new Date(item.publishedAt).getTime()<=maxAgeDays*864e5);
}

function extractImage(html,articleUrl) {
  const metas=html.match(/<meta\b[^>]*>/gi)||[];
  for(const key of ['og:image:secure_url','og:image','twitter:image','twitter:image:src']) for(const meta of metas){
    const name=(attr(meta,'property')||attr(meta,'name')).toLowerCase();
    if(name===key){const candidate=absolute(attr(meta,'content'),articleUrl);if(candidate)return candidate;}
  }
  return '';
}

async function downloadImage(imageUrl,id,articleUrl) {
  const response=await fetch(imageUrl,{redirect:'follow',headers:{'user-agent':userAgent,accept:'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',referer:articleUrl}});
  if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  const ext=type==='image/png'?'.png':type==='image/avif'?'.avif':type==='image/webp'?'.webp':'.jpg';
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<1024||bytes.length>20*1024*1024) throw new Error('invalid image size');
  const filename=`${id}${ext}`; await fs.writeFile(path.join(imageDirectory,filename),bytes); return `assets/news/${filename}`;
}

const payload=JSON.parse(await fs.readFile(file,'utf8'));
const existing=payload.items||[];
const gathered=[
  ...(await Promise.all(feeds.map(async feed=>{try{return parseFeed((await fetchText(feed.url,15000)).text,feed);}catch(error){console.error(`[regional/feed] ${feed.source}: ${error.message}`);return[];}}))).flat(),
  ...regionalSeeds.filter(item=>Date.now()-new Date(item.publishedAt).getTime()<=maxAgeDays*864e5)
];
const clusters=[];
for(const item of gathered.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt))){
  const cluster=clusters.find(c=>similarity(c.items[0].title,item.title)>=0.48&&Math.abs(new Date(c.items[0].publishedAt)-new Date(item.publishedAt))<=72*36e5);
  if(cluster)cluster.items.push(item);else clusters.push({items:[item]});
}

const additions=[];
for(const cluster of clusters){
  const representative=[...cluster.items].sort((a,b)=>b.sourceWeight-a.sourceWeight)[0];
  if(existing.some(item=>item.url===representative.url||similarity(item.title||item.titleRu||'',representative.title)>=0.68)) continue;
  const id=createHash('sha1').update(representative.url).digest('hex').slice(0,16);
  try{
    const article=await fetchText(representative.url);
    const imageUrl=extractImage(article.text,article.finalUrl);
    if(!imageUrl) throw new Error('original article image not found');
    const image=await downloadImage(imageUrl,id,article.finalUrl);
    const sources=[...new Set(cluster.items.map(item=>item.source))];
    additions.push({...representative,id,url:article.finalUrl,image,imageSourceUrl:imageUrl,sourceCount:sources.length,sources,discussionMentions:0,trendScore:Math.round(110+sources.length*45),regionalEligible:true,globalEligible:sources.length>=3,regions:[...new Set(cluster.items.flatMap(item=>item.regions))]});
  }catch(error){console.error(`[regional/article] ${representative.url}: ${error.message}`);}
}

const items=[...existing,...additions].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
await fs.writeFile(file,`${JSON.stringify({...payload,generatedAt:new Date().toISOString(),regionalBackfillDays:maxAgeDays,items},null,2)}\n`);
console.log(`[regional] added ${additions.length} regionally significant events from the previous ${maxAgeDays} days`);
