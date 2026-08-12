import fs from 'node:fs';
import path from 'node:path';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';

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
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const popularByIdentity=new Map((popular.ranking||[]).map(item=>[identity(item.title),item]).filter(([key])=>key));
const steamUpcomingPositions=new Map();
const steamNewPositions=new Map();
const pressResearch=new Map();
let steamStatus='success';
let steamError=null;
let pressStatus='success';
let pressError=null;

const trustedPublishers=new Set([
  ...(popularConfig.sources||[]).filter(source=>source.family==='news').map(source=>canonical(source.name)),
  'gamesradar','video games chronicle','vgc','game informer','push square','nintendo life','pure xbox','vg247','kotaku','destructoid','gematsu','the gamer','thegamer','gamesbeat','digital trends','the verge','windows central','techradar','pcgamesn','shacknews','hardcore gamer','gamingbolt','wccftech','dualshockers','playstation lifestyle','gamingtrend','meristation','gamepressure','game reactor','gamereactor','game developer','pc gamer','rock paper shotgun'
].map(canonical).filter(Boolean));
const publisherAliases=new Map([
  ['gamesradar+','gamesradar'],['rock paper shotgun','rock paper shotgun'],['video games chronicle','video games chronicle'],['v g c','vgc'],['pcgamesn','pcgamesn'],['pc gamer','pc gamer']
].map(([from,to])=>[canonical(from),canonical(to)]));
const officialPublisherPattern=/\b(steam|electronic arts|ea games|playstation|xbox|nintendo|bandai namco|ubisoft|rockstar games|bethesda|focus entertainment|lucasfilm|starwars\.com|epic games|developer|publisher)\b/i;
const franchiseStopWords=new Set(['series','game','games','edition','remastered','remaster','complete','ultimate','definitive','deluxe','simulator','simulation','the','a','an']);

function decode(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim()}
function xmlTag(block,names){for(const name of names){const match=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));if(match)return decode(match[1])}return''}
function parseSteamRows(html){const rows=String(html||'').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi)||[];return rows.map(row=>({appid:Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1]||'').split(',')[0]),title:decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1]||'')})).filter(item=>item.appid&&item.title)}
function parseGoogleNews(xml){return(String(xml||'').match(/<item\b[\s\S]*?<\/item>/gi)||[]).map(block=>({title:xmlTag(block,['title']),date:xmlTag(block,['pubDate','published','updated']),publisher:xmlTag(block,['source'])||decode(block.match(/\s+-\s+([^<]{2,100})<\/title>/i)?.[1]||''),url:xmlTag(block,['link','guid'])})).filter(item=>item.title&&item.publisher)}
function normalizedPublisher(value){const key=canonical(value);return publisherAliases.get(key)||key}
function isTrustedPublisher(value){const key=normalizedPublisher(value);if(!key||officialPublisherPattern.test(key))return false;if(trustedPublishers.has(key))return true;return[...trustedPublishers].some(trusted=>key===trusted||key.includes(trusted)||trusted.includes(key))}
function eventDate(game){const event=(game.events||[])[0]||{};return event.date||event.date_start||event.date_end||null}
function daysFromNow(value){const parsed=value?Date.parse(`${value}T12:00:00Z`):NaN;return Number.isFinite(parsed)?Math.round((parsed-now)/86400000):null}
function chartPosition(game){const steamId=String(game.external_ids?.steam||'');const positions=[steamUpcomingPositions.get(steamId),steamNewPositions.get(steamId)].filter(Number.isFinite);return positions.length?Math.min(...positions):null}
function franchiseTerm(title=''){
  const clean=String(title).replace(/[™®]/g,'').trim();
  const alphaNumeric=clean.match(/\b[\p{L}]{1,10}-\d{1,4}\b/u)?.[0];
  if(alphaNumeric)return alphaNumeric;
  const segments=clean.split(/[.:;—–]\s*/).map(value=>value.trim()).filter(Boolean);
  const cleanSegment=value=>value.split(/\s+/).filter(token=>{const key=canonical(token);return key&&!franchiseStopWords.has(key)&&!/^(19|20)\d{2}$/.test(key)}).slice(0,3).join(' ');
  if(segments.length>1){for(const segment of [...segments].reverse()){const term=cleanSegment(segment);if(term.length>=3)return term}}
  return cleanSegment(clean);
}
function researchPriority(game){
  const position=chartPosition(game)||Number(game.anticipation?.steam_popular_position||game.anticipation?.steam_popular_upcoming_position||0)||999;
  const popularItem=popularByIdentity.get(identity(game.title));
  const delta=daysFromNow(eventDate(game));
  const relevantDate=Number.isFinite(delta)&&delta>=-45&&delta<=180;
  if(!relevantDate&&!popularItem)return null;
  if(position<=100)return position;
  if(popularItem)return 120-Number(popularItem.score||0);
  return null;
}
async function fetchText(url){const response=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseAnticipation/6.0','accept-language':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()}
async function researchQuery(term,days,family){
  if(String(term||'').trim().length<3)return{publishers:[],evidence:[]};
  const query=`\"${term}\" (game OR gaming OR simulator OR preview OR release) when:${days}d`;
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US%3Aen`;
  const items=parseGoogleNews(await fetchText(url));const publishers=new Map();const evidence=[];const wanted=identity(term);
  for(const item of items){const observed=Date.parse(item.date||'');if(Number.isFinite(observed)&&now-observed>days*86400000)continue;const titleIdentity=identity(item.title);if(wanted&&!titleIdentity.includes(wanted))continue;if(!isTrustedPublisher(item.publisher))continue;const publisher=normalizedPublisher(item.publisher);if(publishers.has(publisher))continue;publishers.set(publisher,item.publisher);evidence.push({publisher:item.publisher,title:item.title,url:item.url,observed_at:item.date||null,family})}
  return{publishers:[...publishers.values()],evidence:evidence.slice(0,16)};
}
async function researchPress(game){
  const cleanTitle=String(game.title||'').replace(/[™®]/g,'').trim();
  const franchise=franchiseTerm(cleanTitle);
  const [current,historical]=await Promise.all([researchQuery(cleanTitle,120,'gaming_news'),researchQuery(franchise,730,'franchise_history')]);
  return{current,historical,franchise};
}
async function runPool(items,worker,concurrency=6){let cursor=0;const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const index=cursor++;const item=items[index];try{await worker(item)}catch(error){pressStatus='partial';pressError=pressError||String(error.message||error)}}});await Promise.all(workers)}
async function fetchSteamChart(filter,sortBy,target){const url=`https://store.steampowered.com/search/results/?query&start=0&count=100&dynamic_data=&sort_by=${encodeURIComponent(sortBy)}&filter=${encodeURIComponent(filter)}&infinite=1&cc=us&l=english&json=1`;const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseAnticipation/6.0','accept-language':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`${filter}: HTTP ${response.status}`);const payload=await response.json();parseSteamRows(payload.results_html).forEach((item,index)=>target.set(String(item.appid),index+1))}

try{await Promise.all([fetchSteamChart('popularcomingsoon','Released_ASC',steamUpcomingPositions),fetchSteamChart('popularnew','Released_DESC',steamNewPositions)])}catch(error){steamStatus='partial';steamError=String(error.message||error)}
const researchCandidates=(releases.releases||[]).map(game=>({game,priority:researchPriority(game)})).filter(row=>row.priority!==null).sort((a,b)=>a.priority-b.priority).slice(0,64).map(row=>row.game);
await runPool(researchCandidates,async game=>{pressResearch.set(identity(game.title),await researchPress(game))},6);

for(const game of releases.releases||[]){
  const key=identity(game.title);const popularItem=popularByIdentity.get(key)||null;const research=pressResearch.get(key)||{current:{publishers:[],evidence:[]},historical:{publishers:[],evidence:[]},franchise:franchiseTerm(game.title)};const steamId=String(game.external_ids?.steam||'');const previous=game.anticipation||{};
  const upcomingPosition=steamUpcomingPositions.get(steamId)||Number(previous.steam_popular_upcoming_position||0)||null;
  const newPosition=steamNewPositions.get(steamId)||Number(previous.steam_popular_new_position||0)||null;
  const steamPosition=[upcomingPosition,newPosition].filter(Number.isFinite).sort((a,b)=>a-b)[0]||null;
  const popularPublishers=(popularItem?.news_publishers||[]).filter(Boolean);
  const independentPublishers=[...new Map([...popularPublishers,...(previous.independent_publishers||[]),...research.current.publishers].map(value=>[normalizedPublisher(value),value])).values()].filter(Boolean);
  const franchisePublishers=[...new Map([...(previous.franchise_independent_publishers||[]),...research.historical.publishers].map(value=>[normalizedPublisher(value),value])).values()].filter(Boolean);
  const publicationCount=Math.max(Number(popularItem?.news_sources||0),independentPublishers.length,Number(previous.independent_publication_count||0));
  const franchisePublicationCount=Math.max(franchisePublishers.length,Number(previous.franchise_independent_publication_count||0));
  const popularIndex=popularItem?Number(popularItem.score||0):Number(previous.popular_index||0)||null;const popularConfidence=popularItem?Number(popularItem.confidence||0):Number(previous.popular_confidence||0)||null;
  const families=[...new Set([...(popularItem?.families||[]),...(previous.evidence_families||[]),...(research.current.publishers.length?['gaming_news']:[]),...(steamPosition?['steam_chart']:[])].filter(Boolean))];
  const nonSteamFamilies=families.filter(family=>!['steam_chart','steam','official_store','store','rawg'].includes(String(family).toLowerCase()));
  const multiPublicationCoverage=publicationCount>=3;const multiFamilyCoverage=publicationCount>=2&&nonSteamFamilies.length>=2;const crossSiteCoverage=multiPublicationCoverage||multiFamilyCoverage;
  const pressDominant=publicationCount>=5;const pressPlusStrongSteam=publicationCount>=3&&Boolean(steamPosition&&steamPosition<=50);const pressPlusPopular=publicationCount>=2&&Boolean(popularItem)&&Number(popularIndex||0)>=8&&Number(popularConfidence||0)>=0.4;const strongCrossSite=Boolean(popularItem)&&Number(popularIndex||0)>=10&&Number(popularConfidence||0)>=0.5&&crossSiteCoverage;
  const homepageEligible=game.editorial_quality?.manual_anticipated===true||pressDominant||pressPlusStrongSteam||pressPlusPopular||strongCrossSite;
  const steamScore=steamPosition?Math.max(0,30-Math.min(29,steamPosition-1)*1.25):0;const pressScore=Math.min(36,publicationCount*6);const familyScore=Math.min(16,nonSteamFamilies.length*5);const anticipationScore=Math.round((Math.min(40,Number(popularIndex||0))+steamScore+pressScore+familyScore)*10)/10;
  game.anticipation={measured_at:checkedAt,steam_popular_position:steamPosition,steam_popular_upcoming_position:upcomingPosition,steam_popular_new_position:newPosition,popular_index:popularIndex,popular_confidence:popularConfidence,independent_publication_count:publicationCount,independent_publishers:independentPublishers,franchise_query:research.franchise,franchise_independent_publication_count:franchisePublicationCount,franchise_independent_publishers:franchisePublishers,evidence_families:families,independent_evidence_families:nonSteamFamilies,cross_site_coverage:crossSiteCoverage,homepage_eligible:homepageEligible,anticipation_score:anticipationScore,press_evidence:research.current.evidence,franchise_evidence:research.historical.evidence,source:'Steam Popular Upcoming + Popular New + 120-day current gaming press + 730-day measured franchise/niche history + current Popular signals'};
  const quality=game.editorial_quality||{};const retainedSignals=(quality.signals||[]).filter(signal=>!['published_page','current_popular','cross_site_coverage','steam_popular_upcoming','steam_popular_new','gaming_press','franchise_history'].includes(signal));const anticipationSignals=[popularItem?'current_popular':null,crossSiteCoverage?'cross_site_coverage':null,upcomingPosition?'steam_popular_upcoming':null,newPosition?'steam_popular_new':null,research.current.publishers.length?'gaming_press':null,franchisePublicationCount?'franchise_history':null].filter(Boolean);
  game.editorial_quality={...quality,homepage_eligible:homepageEligible,anticipation_score:anticipationScore,steam_popular_position:steamPosition,steam_popular_upcoming_position:upcomingPosition,steam_popular_new_position:newPosition,independent_source_count:publicationCount,franchise_independent_source_count:franchisePublicationCount,source_families:[...new Set([...(quality.source_families||[]),...families])],signals:[...new Set([...retainedSignals,...anticipationSignals])],homepage_reason:homepageEligible?'measured_global_attention':'insufficient_broad_global_attention'};
}

const eligibleGames=(releases.releases||[]).filter(game=>game.anticipation?.homepage_eligible===true);
releases.anticipation={measured_at:checkedAt,steam_popular_upcoming_count:steamUpcomingPositions.size,steam_popular_new_count:steamNewPositions.size,popular_snapshot_generated_at:popular.generated_at||null,steam_status:steamStatus,press_status:pressStatus,press_candidates_researched:researchCandidates.length,homepage_policy:'Release notability is measured separately: broad global attention, established niche/franchise attention, and strong regional audience attention. Steam ranking alone never qualifies.'};
write('data/releases/current.json',releases);
write('data/parser-runs/release-anticipation.json',{schema_version:6,status:steamStatus==='success'&&pressStatus==='success'?'success':'partial',checked_at:checkedAt,steam_popular_upcoming_count:steamUpcomingPositions.size,steam_popular_new_count:steamNewPositions.size,press_candidates_researched:researchCandidates.length,releases_enriched:(releases.releases||[]).length,popular_matches:(releases.releases||[]).filter(game=>game.anticipation?.popular_index!==null).length,homepage_eligible:eligibleGames.length,errors:[steamError,pressError].filter(Boolean)});
console.log(JSON.stringify({status:steamStatus==='success'&&pressStatus==='success'?'success':'partial',steam_popular_upcoming:steamUpcomingPositions.size,steam_popular_new:steamNewPositions.size,press_candidates_researched:researchCandidates.length,releases_enriched:(releases.releases||[]).length,homepage_eligible:eligibleGames.length},null,2));
