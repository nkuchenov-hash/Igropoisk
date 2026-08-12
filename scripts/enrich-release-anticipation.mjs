import fs from 'node:fs';
import path from 'node:path';
import { normalizeGameIdentity } from './lib/home-feed-identity.mjs';

const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const releases=read('data/releases/current.json');
const popular=read('data/popular/current.json');
const checkedAt=new Date().toISOString();
const suffixPatterns=[/\s*[™®]$/i,/\s*[-:]?\s*(demo|prologue|playtest)$/i];
const identity=title=>normalizeGameIdentity(title,suffixPatterns);

const popularByIdentity=new Map((popular.ranking||[]).map(item=>[identity(item.title),item]).filter(([key])=>key));
const steamPositions=new Map();
let steamStatus='success';
let steamError=null;

function decode(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim()}
function parseSteamRows(html){
  const rows=String(html||'').match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi)||[];
  return rows.map(row=>({
    appid:Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1]||'').split(',')[0]),
    title:decode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1]||'')
  })).filter(item=>item.appid&&item.title);
}

try{
  const url='https://store.steampowered.com/search/results/?query&start=0&count=100&dynamic_data=&filter=popularcomingsoon&infinite=1&cc=us&l=english&json=1';
  const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'Mozilla/5.0 IgropoiskReleaseAnticipation/3.0','accept-language':'en-US,en;q=0.9'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const payload=await response.json();
  parseSteamRows(payload.results_html).forEach((item,index)=>steamPositions.set(String(item.appid),index+1));
}catch(error){
  steamStatus='partial';
  steamError=String(error.message||error);
}

for(const game of releases.releases||[]){
  const key=identity(game.title);
  const popularItem=popularByIdentity.get(key)||null;
  const steamId=String(game.external_ids?.steam||'');
  const previous=game.anticipation||{};
  const steamPosition=steamPositions.get(steamId)||Number(previous.steam_popular_upcoming_position||0)||null;
  const families=[...new Set((popularItem?.families||previous.evidence_families||[]).filter(Boolean))];
  const independentPublishers=[...new Set((popularItem?.news_publishers||previous.independent_publishers||[]).filter(Boolean))];
  const publicationCount=Math.max(Number(popularItem?.news_sources||0),independentPublishers.length,Number(previous.independent_publication_count||0));
  const popularIndex=popularItem?Number(popularItem.score||0):Number(previous.popular_index||0)||null;
  const popularConfidence=popularItem?Number(popularItem.confidence||0):Number(previous.popular_confidence||0)||null;
  const nonSteamFamilies=families.filter(family=>!['steam_chart','steam','official_store','store','rawg'].includes(String(family).toLowerCase()));
  const crossSiteCoverage=publicationCount>=2&&nonSteamFamilies.length>=2;
  const strongCrossSite=Boolean(popularItem)&&popularIndex>=10&&popularConfidence>=0.5&&crossSiteCoverage;
  const broadCoverage=Boolean(popularItem)&&publicationCount>=3&&nonSteamFamilies.length>=2&&popularIndex>=8&&popularConfidence>=0.45;
  const strongSteamWithIndependent=Boolean(popularItem)&&Boolean(steamPosition&&steamPosition<=10)&&publicationCount>=2&&nonSteamFamilies.length>=1&&popularIndex>=8;
  const manuallyFeatured=game.editorial_quality?.manual_anticipated===true;
  const homepageEligible=manuallyFeatured||strongCrossSite||broadCoverage||strongSteamWithIndependent;
  const steamScore=steamPosition?Math.max(0,30-Math.min(29,steamPosition-1)*2):0;
  const breadthScore=Math.min(30,publicationCount*4)+Math.min(20,nonSteamFamilies.length*6);
  const anticipationScore=Math.round((Math.min(50,Number(popularIndex||0))+steamScore+breadthScore)*10)/10;

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
    source:'Steam Popular Upcoming corroborated by independent news, Reddit, YouTube and Twitch/Popular signals'
  };

  const quality=game.editorial_quality||{};
  const retainedSignals=(quality.signals||[]).filter(signal=>!['published_page','current_popular','cross_site_coverage','steam_popular_upcoming'].includes(signal));
  const anticipationSignals=[
    strongCrossSite||broadCoverage?'current_popular':null,
    crossSiteCoverage?'cross_site_coverage':null,
    strongSteamWithIndependent?'steam_popular_upcoming':null
  ].filter(Boolean);
  game.editorial_quality={
    ...quality,
    homepage_eligible:homepageEligible,
    anticipation_score:anticipationScore,
    steam_popular_upcoming_position:steamPosition,
    independent_source_count:publicationCount,
    source_families:[...new Set([...(quality.source_families||[]),...families])],
    signals:[...new Set([...retainedSignals,...anticipationSignals])],
    homepage_reason:homepageEligible
      ? manuallyFeatured?'manual_editorial_mark':strongCrossSite?'cross_site_popularity':broadCoverage?'broad_cross_site_coverage':'steam_top10_plus_cross_site_confirmation'
      : 'insufficient_global_anticipation_evidence'
  };
}

releases.anticipation={
  measured_at:checkedAt,
  steam_popular_upcoming_count:steamPositions.size,
  popular_snapshot_generated_at:popular.generated_at||null,
  steam_status:steamStatus,
  homepage_policy:'Global anticipation needs several independent signals; Steam/store rank or a published page alone never qualifies.'
};
write('data/releases/current.json',releases);
write('data/parser-runs/release-anticipation.json',{
  schema_version:3,
  status:steamStatus,
  checked_at:checkedAt,
  steam_popular_upcoming_count:steamPositions.size,
  releases_enriched:(releases.releases||[]).length,
  popular_matches:(releases.releases||[]).filter(game=>game.anticipation?.popular_index!==null).length,
  homepage_eligible:(releases.releases||[]).filter(game=>game.anticipation?.homepage_eligible===true).length,
  error:steamError
});
console.log(JSON.stringify({status:steamStatus,steam_popular_upcoming:steamPositions.size,releases_enriched:(releases.releases||[]).length,popular_matches:(releases.releases||[]).filter(game=>game.anticipation?.popular_index!==null).length,homepage_eligible:(releases.releases||[]).filter(game=>game.anticipation?.homepage_eligible===true).length},null,2));
