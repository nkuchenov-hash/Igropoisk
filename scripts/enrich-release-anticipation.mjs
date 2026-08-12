import fs from 'node:fs';
import path from 'node:path';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';
import { canonicalPressText, pressPublisherGroup, pressTitleMatches } from './lib/release-press-quality.mjs';

const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const releases=read('data/releases/current.json');
const popular=read('data/popular/current.json');
const popularConfig=read('config/parsers/popular.json');
const checkedAt=new Date().toISOString();
const now=Date.now();
const suffixPatterns=[/\s*[™®]$/i,/\s*[-:]?\s*(demo|prologue|playtest)$/i];
const identity=title=>normalizeGameIdentity(title,suffixPatterns);

const popularByIdentity=new Map((popular.ranking||[]).map(item=>[identity(item.title),item]).filter(([key])=>key));
const steamPositions=new Map();
const pressResearch=new Map();
let steamStatus='success';
let steamError=null;
let pressStatus='success';
let pressError=null;

const trustedPublisherGroups=new Set([
  ...(popularConfig.sources||[]).filter(source=>source.family==='news').map(source=>pressPublisherGroup(source.name)),
  'gamesradar','vgc','game informer','push square','nintendo life','pure xbox','vg247','kotaku','destructoid','gematsu','thegamer','gamesbeat','digital trends','the verge','windows central','techradar','pcgamesn','shacknews','hardcore gamer','gamingbolt','wccftech','dualshockers','playstation lifestyle','gamingtrend','meristation','gamepressure','gamereactor','game developer'
].map(pressPublisherGroup).filter(Boolean));
const officialPublisherPattern=/\b(steam|electronic arts|ea games|playstation|xbox|nintendo|bandai namco|ubisoft|rockstar games|bethesda|focus entertainment|lucasfilm|starwars\.com|epic games|developer|publisher)\b/i;

function decode(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim()}
function xmlTag(block,names){for(const name of names){const match=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));if(match)return decode(match[1])}return''}
function parseSteamRows(html){
  const rows=String(html||'').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi)||[];
  return rows.map(row=>({appid:Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1]||'').split(',')[0]),title:decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1]||'')})).filter(item=>item.appid&&item.title);
}
function parseGoogleNews(xml){
  return (String(xml||'').match(/<item\b[\s\S]*?<\/item>/gi)||[]).map(block=>({
    title:xmlTag(block,['title']),
    date:xmlTag(block,['pubDate','published','updated']),
    publisher:xmlTag(block,['source'])||decode(block.match(/\s+-\s+([^<]{2,100})<\/title>/i)?.[1]||''),
    url:xmlTag(block,['link','guid'])
  })).filter(item=>item.title&&item.publisher);
}
function isTrustedPublisher(value){
  const raw=canonicalPressText(value);
  const group=pressPublisherGroup(value);
  if(!raw||!group||officialPublisherPattern.test(raw))return false;
  if(trustedPublisherGroups.has(group))return true;
  return [...trustedPublisherGroups].some(trusted=>group===trusted||group.includes(trusted)||trusted.includes(group));
}
function eventDate(game){const event=(game.events||[])[0]||{};return event.date||event.date_start||event.date_end||null}
function daysFromNow(value){const parsed=value?Date.parse(`${value}T12:00:00Z`):NaN;return Number.isFinite(parsed)?Math.round((parsed-now)/86400000):null}
function researchPriority(game){
  const steamId=String(game.external_ids?.steam||'');
  const position=steamPositions.get(steamId)||Number(game.anticipation?.steam_popular_upcoming_position||0)||999;
  const popularItem=popularByIdentity.get(identity(game.title));
  const delta=daysFromNow(eventDate(game));
  const relevantDate=Number.isFinite(delta)&&delta>=-14&&delta<=180;
  if(!relevantDate&&!popularItem)return null;
  if(position<=100)return position;
  if(popularItem)return 120-Number(popularItem.score||0);
  return null;
}
async function fetchText(url){const response=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseAnticipation/4.1','accept-language':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()}
async function researchPress(game){
  const cleanTitle=String(game.title||'').replace(/[™®]/g,'').trim();
  if(cleanTitle.length<3)return {publishers:[],evidence:[]};
  const query=`\"${cleanTitle}\" (game OR gaming OR preview OR release) when:120d`;
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US%3Aen`;
  const items=parseGoogleNews(await fetchText(url));
  const publishers=new Map();
  const evidence=[];
  for(const item of items){
    const observed=Date.parse(item.date||'');
    if(Number.isFinite(observed)&&now-observed>120*86400000)continue;
    if(!pressTitleMatches(cleanTitle,item.title))continue;
    if(!isTrustedPublisher(item.publisher))continue;
    const publisherGroup=pressPublisherGroup(item.publisher);
    if(publishers.has(publisherGroup))continue;
    publishers.set(publisherGroup,publisherGroup);
    evidence.push({publisher:publisherGroup,publisher_display:item.publisher,title:item.title,url:item.url,observed_at:item.date||null,family:'gaming_news'});
  }
  return {publishers:[...publishers.keys()],evidence:evidence.slice(0,12)};
}
async function runPool(items,worker,concurrency=6){
  let cursor=0;
  const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const index=cursor++;const item=items[index];try{await worker(item)}catch(error){pressStatus='partial';pressError=pressError||String(error.message||error)}}});
  await Promise.all(workers);
}

try{
  const url='https://store.steampowered.com/search/results/?query&start=0&count=100&dynamic_data=&filter=popularcomingsoon&infinite=1&cc=us&l=english&json=1';
  const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseAnticipation/4.1','accept-language':'en-US,en;q=0.9'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const payload=await response.json();
  parseSteamRows(payload.results_html).forEach((item,index)=>steamPositions.set(String(item.appid),index+1));
}catch(error){steamStatus='partial';steamError=String(error.message||error)}

const researchCandidates=(releases.releases||[]).map(game=>({game,priority:researchPriority(game)})).filter(row=>row.priority!==null).sort((a,b)=>a.priority-b.priority).slice(0,48).map(row=>row.game);
await runPool(researchCandidates,async game=>{pressResearch.set(identity(game.title),await researchPress(game))},6);

for(const game of releases.releases||[]){
  const key=identity(game.title);
  const popularItem=popularByIdentity.get(key)||null;
  const press=pressResearch.get(key)||{publishers:[],evidence:[]};
  const steamId=String(game.external_ids?.steam||'');
  const previous=game.anticipation||{};
  const steamPosition=steamPositions.get(steamId)||Number(previous.steam_popular_upcoming_position||0)||null;
  const publisherGroups=new Set([
    ...(popularItem?.news_publishers||[]).map(pressPublisherGroup),
    ...(previous.independent_publishers||[]).map(pressPublisherGroup),
    ...press.publishers.map(pressPublisherGroup)
  ].filter(Boolean));
  const independentPublishers=[...publisherGroups].sort();
  const publicationCount=independentPublishers.length;
  const popularIndex=popularItem?Number(popularItem.score||0):Number(previous.popular_index||0)||null;
  const popularConfidence=popularItem?Number(popularItem.confidence||0):Number(previous.popular_confidence||0)||null;
  const families=[...new Set([...(popularItem?.families||[]),...(previous.evidence_families||[]),...(press.publishers.length?['gaming_news']:[]),...(steamPosition?['steam_chart']:[])].filter(Boolean))];
  const nonSteamFamilies=families.filter(family=>!['steam_chart','steam','official_store','store','rawg'].includes(String(family).toLowerCase()));
  const multiPublicationCoverage=publicationCount>=3;
  const multiFamilyCoverage=publicationCount>=2&&nonSteamFamilies.length>=2;
  const crossSiteCoverage=multiPublicationCoverage||multiFamilyCoverage;
  const pressDominant=publicationCount>=5;
  const pressPlusStrongSteam=publicationCount>=3&&Boolean(steamPosition&&steamPosition<=50);
  const pressPlusPopular=publicationCount>=2&&Boolean(popularItem)&&Number(popularIndex||0)>=8&&Number(popularConfidence||0)>=0.4;
  const strongCrossSite=Boolean(popularItem)&&Number(popularIndex||0)>=10&&Number(popularConfidence||0)>=0.5&&crossSiteCoverage;
  const manuallyFeatured=game.editorial_quality?.manual_anticipated===true;
  const homepageEligible=manuallyFeatured||pressDominant||pressPlusStrongSteam||pressPlusPopular||strongCrossSite;
  const steamScore=steamPosition?Math.max(0,30-Math.min(29,steamPosition-1)*1.25):0;
  const pressScore=Math.min(36,publicationCount*6);
  const familyScore=Math.min(16,nonSteamFamilies.length*5);
  const anticipationScore=Math.round((Math.min(40,Number(popularIndex||0))+steamScore+pressScore+familyScore)*10)/10;

  game.anticipation={
    measured_at:checkedAt,
    steam_popular_upcoming_position:steamPosition,
    popular_index:popularIndex,
    popular_confidence:popularConfidence,
    independent_publication_count:publicationCount,
    independent_publishers:independentPublishers,
    evidence_families:families,
    independent_evidence_families:nonSteamFamilies,
    cross_site_coverage:crossSiteCoverage,
    homepage_eligible:homepageEligible,
    anticipation_score:anticipationScore,
    press_evidence:press.evidence,
    source:'Steam Popular Upcoming + 120-day cross-site gaming press research + current Popular signals; regional editions count as one publisher group'
  };

  const quality=game.editorial_quality||{};
  const retainedSignals=(quality.signals||[]).filter(signal=>!['published_page','current_popular','cross_site_coverage','steam_popular_upcoming','gaming_press'].includes(signal));
  const anticipationSignals=[popularItem?'current_popular':null,crossSiteCoverage?'cross_site_coverage':null,steamPosition?'steam_popular_upcoming':null,press.publishers.length?'gaming_press':null].filter(Boolean);
  game.editorial_quality={
    ...quality,
    homepage_eligible:homepageEligible,
    anticipation_score:anticipationScore,
    steam_popular_upcoming_position:steamPosition,
    independent_source_count:publicationCount,
    source_families:[...new Set([...(quality.source_families||[]),...families])],
    signals:[...new Set([...retainedSignals,...anticipationSignals])],
    homepage_reason:homepageEligible?manuallyFeatured?'manual_editorial_mark':pressDominant?'broad_gaming_press_coverage':pressPlusStrongSteam?'steam_top50_plus_three_gaming_publications':pressPlusPopular?'current_popular_plus_gaming_press':'cross_site_popularity':'insufficient_global_anticipation_evidence'
  };
}

const eligibleGames=(releases.releases||[]).filter(game=>game.anticipation?.homepage_eligible===true);
releases.anticipation={measured_at:checkedAt,steam_popular_upcoming_count:steamPositions.size,popular_snapshot_generated_at:popular.generated_at||null,steam_status:steamStatus,press_status:pressStatus,press_candidates_researched:researchCandidates.length,homepage_policy:'Global anticipation requires independent publisher groups. Regional editions of one brand count once. Ambiguous one-word titles are matched fail-closed. Store rank or a published page alone never qualifies.'};
write('data/releases/current.json',releases);
write('data/parser-runs/release-anticipation.json',{schema_version:5,status:steamStatus==='success'&&pressStatus==='success'?'success':'partial',checked_at:checkedAt,steam_popular_upcoming_count:steamPositions.size,press_candidates_researched:researchCandidates.length,releases_enriched:(releases.releases||[]).length,popular_matches:(releases.releases||[]).filter(game=>game.anticipation?.popular_index!==null).length,homepage_eligible:eligibleGames.length,homepage_eligible_titles:eligibleGames.slice().sort((a,b)=>Number(b.anticipation?.anticipation_score||0)-Number(a.anticipation?.anticipation_score||0)).slice(0,24).map(game=>({title:game.title,score:game.anticipation?.anticipation_score,steam_position:game.anticipation?.steam_popular_upcoming_position,independent_publications:game.anticipation?.independent_publication_count,publishers:game.anticipation?.independent_publishers})),errors:[steamError,pressError].filter(Boolean)});
console.log(JSON.stringify({status:steamStatus==='success'&&pressStatus==='success'?'success':'partial',steam_popular_upcoming:steamPositions.size,press_candidates_researched:researchCandidates.length,releases_enriched:(releases.releases||[]).length,popular_matches:(releases.releases||[]).filter(game=>game.anticipation?.popular_index!==null).length,homepage_eligible:eligibleGames.length,homepage_eligible_titles:eligibleGames.slice().sort((a,b)=>Number(b.anticipation?.anticipation_score||0)-Number(a.anticipation?.anticipation_score||0)).slice(0,12).map(game=>game.title)},null,2));
