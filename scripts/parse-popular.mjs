import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJSON = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = readJSON('config/parsers/popular.json');
const catalog = readJSON('data/catalog-visible.json');
const now = Date.now();
const checkedAt = new Date(now).toISOString();
const timeout = 25_000;

const canonical = value => String(value || '')
  .normalize('NFKD').toLowerCase().replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const slugify = value => canonical(value).replace(/\s+/g, '-').slice(0, 90);
const decode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const fetchText = async url => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {'user-agent':'Mozilla/5.0 IgropoiskPopularityParser/4.0','accept-language':'en-US,en;q=0.9'}
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};
const fetchJSON = async url => JSON.parse(await fetchText(url));

const drafts = new Map();
const draftDir = path.join(root, 'data', 'drafts');
if (fs.existsSync(draftDir)) {
  for (const filename of fs.readdirSync(draftDir).filter(name => name.endsWith('.json'))) {
    try {
      const draft = readJSON(`data/drafts/${filename}`);
      if (draft?.identity?.slug) drafts.set(draft.identity.slug, draft);
    } catch {}
  }
}

const media = {
  'grand-theft-auto-vi': 'https://www.igrandtheftauto.com/content/images/grand-theft-auto-vi-official-cover-art-hi-res.jpg'
};
const games = [];
const bySlug = new Map();
const byTitle = new Map();
const byAppid = new Map();

function registerGame(input) {
  const title = String(input.title || input.name || '').trim();
  if (!title) return null;
  const slug = input.slug || slugify(title);
  let game = bySlug.get(slug) || byTitle.get(canonical(title));
  if (!game) {
    game = {slug,title,year:input.year || null,steam_appid:Number(input.steam_appid || input.appid) || null,image:input.image || media[slug] || '',aliases:[],in_catalog:Boolean(input.in_catalog)};
    games.push(game); bySlug.set(slug, game);
  }
  game.year ||= input.year || null;
  game.steam_appid ||= Number(input.steam_appid || input.appid) || null;
  game.image ||= input.image || media[slug] || '';
  game.in_catalog ||= Boolean(input.in_catalog);
  game.aliases = [...new Set([...(game.aliases || []),title,...(input.aliases || [])].filter(Boolean).map(canonical))].sort((a,b)=>b.length-a.length);
  byTitle.set(canonical(title), game);
  if (game.steam_appid) byAppid.set(game.steam_appid, game);
  return game;
}

for (const item of catalog) {
  const draft = drafts.get(item.slug);
  registerGame({...item,title:item.title || item.name,steam_appid:draft?.identity?.steam_appid || item.steam_appid,image:draft?.media?.cover || draft?.media?.hero || item.cover || item.hero || media[item.slug] || '',aliases:[item.slug.replace(/-/g,' ')],in_catalog:true});
}
for (const alias of config.aliases || []) registerGame(alias);

const signals = new Map();
const statuses = [];
function ensure(game) {
  if (!signals.has(game.slug)) signals.set(game.slug,{game,news:0,chart:0,publishers:new Set(),evidence:[]});
  return signals.get(game.slug);
}
function resolve(title) {
  const value = ` ${canonical(title)} `;
  let best = null;
  for (const game of games) {
    for (const alias of game.aliases || []) {
      const words = alias.split(' ').length;
      if (words === 1 && alias.length < 7) continue;
      if (value.includes(` ${alias} `) && (!best || alias.length > best.alias.length)) best = {game,alias};
    }
  }
  return best?.game || null;
}
function recency(date) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 0;
  const age = Math.max(0,(now-time)/3_600_000);
  if (age > 96) return 0;
  return Math.pow(.5,age/24);
}
function xmlTag(block,names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));
    if (match) return decode(match[1]);
  }
  return '';
}
function parseFeed(xml) {
  return (xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || []).map(block => ({
    title:xmlTag(block,['title']), date:xmlTag(block,['pubDate','published','updated']),
    publisher:xmlTag(block,['source','author','dc:creator']),
    url:block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || xmlTag(block,['link','guid'])
  })).filter(item=>item.title);
}
function publisherFrom(item, fallback) {
  if (item.publisher) return item.publisher;
  const suffix = item.title.match(/\s+-\s+([^–—|-]{2,80})$/)?.[1];
  return suffix || fallback;
}

const newsFeeds = [
  ...(config.sources || []).filter(item=>item.enabled !== false && item.type === 'rss'),
  {id:'google-news-gaming',name:'Google News Gaming',url:'https://news.google.com/rss/search?q=gaming%20OR%20%22video%20game%22%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen'},
  {id:'google-news-console-games',name:'Google News Console Games',url:'https://news.google.com/rss/search?q=PlayStation%20OR%20Xbox%20OR%20Nintendo%20OR%20Rockstar%20Games%20when%3A4d&hl=en-US&gl=US&ceid=US%3Aen'}
];

async function collectNews() {
  for (const source of newsFeeds) {
    const started = Date.now();
    try {
      const items = parseFeed(await fetchText(source.url));
      let matched = 0;
      for (const item of items) {
        const freshness = recency(item.date);
        if (!freshness) continue;
        const game = resolve(item.title);
        if (!game) continue;
        const row = ensure(game);
        const publisher = publisherFrom(item, source.name);
        const duplicate = row.evidence.some(e => e.url && e.url === item.url);
        if (duplicate) continue;
        row.news += freshness;
        row.publishers.add(publisher);
        row.evidence.push({source:publisher,title:item.title,url:item.url,observed_at:item.date,family:'news',value:Number(freshness.toFixed(3))});
        matched++;
      }
      statuses.push({id:source.id,status:'success',items:items.length,matched,duration_ms:Date.now()-started,url:source.url});
    } catch (error) {
      statuses.push({id:source.id,status:'error',error:error.message,duration_ms:Date.now()-started,url:source.url});
    }
  }
}

function parseSteam(html) {
  const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
  return rows.map(row=>({
    appid:Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]),
    title:decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '')
  })).filter(item=>item.appid && item.title);
}
async function collectSteam() {
  const url='https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=topsellers&infinite=1&cc=us&l=english&json=1';
  const started=Date.now();
  try {
    const items=parseSteam((await fetchJSON(url)).results_html || '');
    items.slice(0,50).forEach((item,index)=>{
      const game=byAppid.get(item.appid) || registerGame({title:item.title,appid:item.appid,image:`https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`});
      game.image=`https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`;
      const row=ensure(game);
      row.chart=Math.max(row.chart,1-index/50);
      row.evidence.push({source:'Steam Top Sellers',title:item.title,url:`https://store.steampowered.com/app/${item.appid}/`,position:index+1,appid:item.appid,family:'steam_chart',value:Number((1-index/50).toFixed(3))});
    });
    statuses.push({id:'steam-top-sellers',status:'success',items:items.length,matched:items.length,duration_ms:Date.now()-started,url});
  } catch(error) {statuses.push({id:'steam-top-sellers',status:'error',error:error.message,duration_ms:Date.now()-started,url});}
}

const started=Date.now();
await Promise.all([collectNews(),collectSteam()]);
const rows=[...signals.values()];
const maxNews=Math.max(...rows.map(row=>row.news),1);
const excluded=new Set(['steam-deck','steam-machine','valve-index','steam-controller','steam-link']);
const ranking=rows.map(row=>{
  if (excluded.has(row.game.slug)) return null;
  const news=row.news/maxNews;
  const breadth=Math.min(1,row.publishers.size/5);
  const chart=row.chart;
  const discussed=row.publishers.size>=2 && row.news>.08;
  if (!chart && !discussed) return null;
  const score=100*(.55*news+.35*chart+.10*breadth);
  return {slug:row.game.slug,title:row.game.title,year:row.game.year || null,image:row.game.image || '',score:Number(score.toFixed(1)),confidence:Number(Math.min(1,.5+.07*Math.min(row.publishers.size,5)+(chart? .12:0)).toFixed(2)),delta:null,families:[...(row.news?['news']:[]),...(chart?['steam_chart']:[])],signals:{news:row.news,steam_chart:chart},news_sources:row.publishers.size,in_catalog:row.game.in_catalog,evidence:row.evidence.sort((a,b)=>b.value-a.value).slice(0,16)};
}).filter(Boolean).sort((a,b)=>b.score-a.score || b.confidence-a.confidence).slice(0,30);

const output={schema_version:4,generated_at:checkedAt,window_hours:96,method:{formula:'55% global discussion + 35% Steam demand + 10% independent publisher breadth',family_weights:{news:.55,steam_chart:.35,breadth:.10}},ranking,discovered_unmatched:[],source_statuses:statuses};
fs.mkdirSync(path.join(root,'data','popular'),{recursive:true});
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','popular','current.json'),`${JSON.stringify(output,null,2)}\n`);
const run={parser:'popular',status:ranking.length>=10?'success':'warning',checked_at:checkedAt,duration_ms:Date.now()-started,ranked_count:ranking.length,sources_success:statuses.filter(item=>item.status==='success').length,sources_total:statuses.length,output:'data/popular/current.json',note:'Рейтинг рассчитан по глобальной обсуждаемости, независимым изданиям и спросу Steam.',source_statuses:statuses};
fs.writeFileSync(path.join(root,'data','parser-runs','popular.json'),`${JSON.stringify(run,null,2)}\n`);
console.log(JSON.stringify(run,null,2));
