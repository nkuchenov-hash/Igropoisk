import fs from 'node:fs';
import path from 'node:path';
import { buildMediaIntersection } from './lib/release-media-panel.mjs';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';
import { loadPublicationSourceRegistry, releaseMediaPanelConfig } from './lib/publication-source-registry.mjs';

const root=process.cwd();
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`,'utf8')};
const policy=read('config/release-media-sources.json',{source_registry:'config/parsers/review-source-registry.json',coverage_window_days:180,research_candidate_limit:160});
const publicationRegistry=loadPublicationSourceRegistry(policy.source_registry);
const config=releaseMediaPanelConfig(publicationRegistry,policy);
if(!config.sources.length)throw new Error('Publication Registry has no sources with release role coverage');
const releasesDoc=read('data/releases/current.json',{releases:[]});
const popularDoc=read('data/popular/current.json',{ranking:[]});
const checkedAt=new Date().toISOString();
const now=Date.now();
const coverageDays=Math.max(30,Number(config.coverage_window_days||180));
const candidateLimit=Math.max(1,Number(config.research_candidate_limit||160));
const suffixPatterns=[/\s*[™®]$/i,/\s*[-:]?\s*(demo|prologue|playtest)$/i];
const identity=title=>normalizeGameIdentity(title,suffixPatterns);

function decode(value=''){return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim()}
function xmlTag(block,names){for(const name of names){const match=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));if(match)return decode(match[1])}return''}
function parseGoogleNews(xml){return(String(xml||'').match(/<item\b[\s\S]*?<\/item>/gi)||[]).map(block=>({title:xmlTag(block,['title']),date:xmlTag(block,['pubDate','published','updated']),publisher:xmlTag(block,['source'])||decode(block.match(/\s+-\s+([^<]{2,100})<\/title>/i)?.[1]||''),url:xmlTag(block,['link','guid'])})).filter(item=>item.title&&item.publisher)}
async function fetchText(url,locale){const response=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseMediaPanel/1.2','accept-language':locale==='ru'?'ru-RU,ru;q=0.9,en;q=0.6':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()}
function substantive(item,title){const wanted=identity(title),headline=identity(String(item.title||'').replace(/\s+-\s+[^-]{2,100}$/,''));if(!wanted||!headline.includes(wanted))return false;if(/\b(official\s+)?(launch|release date|announcement|gameplay|overview)?\s*trailer\b/i.test(item.title||''))return false;const remainder=headline.replace(wanted,'').trim();return remainder.split(' ').filter(Boolean).length>=2}
async function research(game,locale){const ru=locale==='ru';const query=ru?`\"${game.title}\" (игра OR релиз OR \"дата выхода\" OR превью OR интервью OR обзор) when:${coverageDays}d`:`\"${game.title}\" (game OR gaming OR release OR preview OR interview OR hands-on) when:${coverageDays}d`;const suffix=ru?'hl=ru&gl=RU&ceid=RU%3Aru':'hl=en-US&gl=US&ceid=US%3Aen';const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${suffix}`,locale);return parseGoogleNews(xml).filter(item=>substantive(item,game.title)).map(item=>({publisher:item.publisher,title:item.title,url:item.url,observed_at:item.date||null,origin:ru?'google-news-ru':'google-news-en'}))}
function primaryEvent(game){return(game.events||[]).slice().sort((a,b)=>String(a.date_start||a.date||'9999').localeCompare(String(b.date_start||b.date||'9999')))[0]||{}}
function monthKey(game){const event=primaryEvent(game);return String(event.date_start||event.date||'tbd').slice(0,7)||'tbd'}
function inHorizon(game){const event=primaryEvent(game);if(!event.date_start)return true;const value=Date.parse(`${event.date_start}T12:00:00Z`);if(!Number.isFinite(value))return true;const days=(value-now)/86400000;return days>=-45&&days<=540}
function priority(game){const anticipation=game.anticipation||{};const quality=game.editorial_quality||{};const popular=Number(anticipation.popular_index||0);const press=Number(anticipation.independent_publication_count||quality.independent_source_count||0);const steam=Number(anticipation.steam_popular_position||999);return press*100+popular*4+(steam<999?Math.max(0,100-steam):0)}
function selectAcrossMonths(games,limit){const buckets=new Map();for(const game of games.filter(inHorizon)){const key=monthKey(game);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(game)}for(const bucket of buckets.values())bucket.sort((a,b)=>priority(b)-priority(a)||String(a.title).localeCompare(String(b.title),'en'));const keys=[...buckets.keys()].sort((a,b)=>a==='tbd'?1:b==='tbd'?-1:a.localeCompare(b));const selected=[];let moved=true;while(selected.length<limit&&moved){moved=false;for(const key of keys){const game=buckets.get(key)?.shift();if(!game)continue;selected.push(game);moved=true;if(selected.length>=limit)break}}return selected}
function popularMatch(game){const gid=String(game.game_id||'');if(gid){const exact=(popularDoc.ranking||[]).find(item=>String(item.game_id||item.gameId||'')===gid);if(exact)return exact}const wanted=identity(game.title);return(popularDoc.ranking||[]).find(item=>identity(item.title||'')===wanted)||null}
async function runPool(items,concurrency,worker){let cursor=0;const workers=Array.from({length:Math.min(concurrency,Math.max(1,items.length))},async()=>{while(cursor<items.length){const index=cursor++;await worker(items[index])}});await Promise.all(workers)}

const releases=(releasesDoc.releases||[]).map(item=>({...item,editorial_quality:{...(item.editorial_quality||{})},anticipation:{...(item.anticipation||{})}}));
const selected=selectAcrossMonths(releases,candidateLimit);
const researched=new Map();let queryErrors=0;
await runPool(selected,10,async game=>{const evidence=[];let failed=0;for(const result of await Promise.allSettled([research(game,'en'),research(game,'ru')])){if(result.status==='fulfilled')evidence.push(...result.value);else{failed++;queryErrors++}}researched.set(game.id,{evidence,failed})});

let withCoverage=0,cisCoverage=0,maxIntersection=0;
for(const game of releases){
  const steamId=Number(game.external_ids?.steam);
  if(Number.isFinite(steamId))game.image={...(game.image||{}),candidate_urls:[...new Set([...(game.image?.candidate_urls||[]),`https://cdn.cloudflare.steamstatic.com/steam/apps/${steamId}/library_600x900_2x.jpg`])].filter(Boolean)};
  const popular=popularMatch(game);
  const previousNames=[...(game.editorial_quality?.media_publishers||[]),...(game.anticipation?.independent_publishers||[]),...(popular?.news_publishers||[])];
  const fresh=researched.get(game.id);
  const intersection=buildMediaIntersection({publisherNames:previousNames,evidence:fresh?.evidence||[],config,generatedAt:checkedAt});
  if(fresh?.failed===2&&game.media_intersection?.overall_count>intersection.overall_count)game.media_intersection={...game.media_intersection,research_status:'stale-fallback',generated_at:checkedAt};
  else game.media_intersection={...intersection,research_status:fresh?(fresh.failed?'partial':'fresh'):'not-prioritized'};
  const publishers=game.media_intersection.publishers||[];
  const families=game.media_intersection.publisher_families||[];
  const count=Number(game.media_intersection.overall_count||0);
  game.editorial_quality={...(game.editorial_quality||{}),media_publishers:publishers,media_publisher_families:families,media_intersection_count:count,media_region_counts:game.media_intersection.region_counts||{}};
  game.anticipation={...(game.anticipation||{}),independent_publishers:publishers,independent_publisher_families:families,independent_publication_count:count,media_intersection_count:count,media_region_counts:game.media_intersection.region_counts||{},media_panel_size:Number(game.media_intersection.panel_size||0)};
  if(count>0)withCoverage++;if(Number(game.media_intersection.region_counts?.cis||0)>0)cisCoverage++;maxIntersection=Math.max(maxIntersection,count);
}

write('data/releases/current.json',{...releasesDoc,generated_at:checkedAt,releases});
write('data/parser-runs/release-media-panel.json',{schema_version:2,parser_id:'release-media-panel',checked_at:checkedAt,status:queryErrors?'partial':'success',source_registry:policy.source_registry,source_registry_id:config.source_registry_id,panel_size:(config.sources||[]).length,research_candidate_limit:candidateLimit,researched_candidates:selected.length,represented_months:[...new Set(selected.map(monthKey))].sort(),releases_with_editorial_coverage:withCoverage,releases_with_cis_coverage:cisCoverage,max_media_intersection:maxIntersection,query_errors:queryErrors,rule:'Every registered publication with release role coverage counts once per publisher family. Stores and official pages are excluded from editorial intersection.'});
console.log(JSON.stringify({status:queryErrors?'partial':'success',source_registry_id:config.source_registry_id,panel_size:(config.sources||[]).length,researched_candidates:selected.length,represented_months:[...new Set(selected.map(monthKey))].sort(),with_coverage:withCoverage,cis_coverage:cisCoverage,max_intersection:maxIntersection,query_errors:queryErrors},null,2));
