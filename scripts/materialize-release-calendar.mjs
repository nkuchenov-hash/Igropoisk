import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { attachAudienceAffinity, buildPersonalizedReleases, validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';
import { enrichRawReleasesFromSteamEditorial } from './lib/release-steam-editorial-discovery.mjs';
import { applyGlobalNotabilityGate, validateGlobalNotability } from './lib/release-notability.mjs';
import { ensureVisibleReleaseCovers, validateVisibleReleaseCovers } from './lib/release-cover-resolver.mjs';

const ROOT = process.cwd();
const paths = {
  raw: path.join(ROOT, 'data/releases/current.json'),
  editorial: path.join(ROOT, 'data/release-candidates/editorial.json'),
  claims: path.join(ROOT, 'config/release-official-claims.json'),
  policy: path.join(ROOT, 'config/release-calendar.json'),
  news: path.join(ROOT, 'data/news-events.json'),
  rankedNews: path.join(ROOT, 'data/news.json'),
  popular: path.join(ROOT, 'data/popular/current.json'),
  candidates: path.join(ROOT, 'data/release-candidates/current.json'),
  public: path.join(ROOT, 'data/releases/public.json'),
  report: path.join(ROOT, 'data/releases/materialization-report.json'),
};
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${path.relative(ROOT, file)}: ${error.message}`); }
}
function deduplicateCandidates(candidates) {
  const byId = new Map(); const statusRank = {rejected:0,review:1,published:2};
  for (const candidate of candidates) {
    const previous=byId.get(candidate.id); if(!previous){byId.set(candidate.id,candidate);continue}
    const previousScore=Number(previous.significance?.score||0), candidateScore=Number(candidate.significance?.score||0);
    const previousRank=statusRank[previous.moderation?.status]??0, candidateRank=statusRank[candidate.moderation?.status]??0;
    if(candidateScore>previousScore||(candidateScore===previousScore&&candidateRank>previousRank))byId.set(candidate.id,candidate);
  }
  return [...byId.values()];
}
function items(doc){return Array.isArray(doc)?doc:(Array.isArray(doc?.items)?doc.items:[])}

const [raw,editorial,claimsDoc,policy,newsDoc,rankedNewsDoc,popularDoc]=await Promise.all([
  readJson(paths.raw,{releases:[]}),readJson(paths.editorial,{schema_version:1,decisions:{}}),readJson(paths.claims,{schema_version:1,claims:[]}),readJson(paths.policy,{}),readJson(paths.news,{items:[]}),readJson(paths.rankedNews,{items:[]}),readJson(paths.popular,{ranking:[]}),
]);
const generatedAt=new Date().toISOString();
const steamEditorial=await enrichRawReleasesFromSteamEditorial(Array.isArray(raw?.releases)?raw.releases:[],policy,generatedAt);
const rawById=new Map(steamEditorial.releases.map(item=>[item.id,item]));
let rawCandidates=buildCandidates({rawReleases:steamEditorial.releases,editorial,officialClaims:Array.isArray(claimsDoc?.claims)?claimsDoc.claims:[],policy});
rawCandidates=rawCandidates.map(candidate=>{const source=rawById.get(candidate.id)||{};return {...candidate,editorial_quality:source.editorial_quality||{},anticipation:source.anticipation||null}});
const deduplicatedCandidates=deduplicateCandidates(rawCandidates);
const registryMigration=migrateRepository(ROOT,{dryRun:true,now:generatedAt,baseCommit:process.env.GITHUB_SHA||null,publicBaseUrl:'/game'});
const linkage=linkReleaseCandidatesToRegistry(deduplicatedCandidates,registryMigration.registry);
const newsEvents=[...items(newsDoc),...items(rankedNewsDoc)];
const popularRanking=Array.isArray(popularDoc?.ranking)?popularDoc.ranking:[];
let candidates=attachAudienceAffinity(linkage.candidates,newsEvents,policy);
candidates=applyGlobalNotabilityGate(candidates,{newsEvents,popularRanking,policy});

const personalizedPreview=buildPersonalizedReleases(candidates,policy);
const visibleIds=new Set([
  ...candidates.filter(candidate=>candidate.moderation?.status==='published'&&!candidate.moderation?.publication_forbidden).map(candidate=>candidate.id),
  ...personalizedPreview.map(release=>release.id),
]);
const coverQuality={minimumBytes:40_000,minimumWidth:600,minimumHeight:900,minimumRatio:0.62,maximumRatio:0.72};
const coverResolution=await ensureVisibleReleaseCovers(candidates,{root:ROOT,visibleIds,...coverQuality,concurrency:6});
candidates=coverResolution.candidates;

let publicCalendar=buildPublicCalendar(candidates,generatedAt);
publicCalendar=attachCanonicalGameIdsToPublicCalendar(publicCalendar,candidates);
const candidateById=new Map(candidates.map(candidate=>[candidate.id,candidate]));
publicCalendar.releases=(publicCalendar.releases||[]).map(release=>{const candidate=candidateById.get(release.id);return {...release,global_notability:candidate?.global_notability||null,audience_affinity:candidate?.audience_affinity||null,regional_notability:candidate?.regional_notability||null}});
publicCalendar.personalized_releases=buildPersonalizedReleases(candidates,policy);
publicCalendar.personalization={
  model:'broad-global-or-niche-global-or-strong-user-region-v3',
  rule:'Global releases qualify through broad global attention or established niche/franchise attention. A non-global release may additionally appear only for users whose region has strong measured repeated/corroborated audience attention. Origin or language support alone never qualifies.',
  client_minimum_score:Number(policy.personalized_client_minimum_score||90),
};
publicCalendar.statistics.personalized=publicCalendar.personalized_releases.length;
publicCalendar.statistics.coverage_percent=coverResolution.statistics.coverage_percent;
const errors=[
  ...validateCalendar({candidates,publicCalendar,policy}),
  ...validateGlobalNotability({candidates,publicCalendar}),
  ...validatePersonalizedReleases({candidates,publicCalendar,policy}),
  ...validateVisibleReleaseCovers(publicCalendar,coverQuality),
];

const validatedCoverById=new Map(
  candidates
    .filter(candidate=>candidate?.image?.local_url&&candidate?.image?.status==='downloaded_verified'&&candidate?.image?.verified===true)
    .map(candidate=>[candidate.id,candidate.image])
);
let synchronizedHomeFeedCovers=0;
let synchronizedRaw=raw;
if(!errors.length&&validatedCoverById.size){
  synchronizedRaw={
    ...raw,
    releases:(raw.releases||[]).map(release=>{
      const image=validatedCoverById.get(release.id);
      if(!image)return release;
      const previous=release.image||{};
      if(previous.local_url===image.local_url&&previous.status===image.status&&previous.verified===image.verified)return release;
      synchronizedHomeFeedCovers++;
      return {...release,image};
    }),
  };
}

const candidateDocument={schema_version:5,generated_at:generatedAt,raw_generated_at:raw?.generated_at||null,news_generated_at:newsDoc?.generatedAt||null,popular_generated_at:popularDoc?.generated_at||null,candidates,statistics:publicCalendar.statistics};
const report={
  schema_version:5,generated_at:generatedAt,
  sources:{
    active_discovery:['Steam coming-soon/appdetails (PC only)','Steam Popular Upcoming discovery signal','Steam Popular New discovery signal'],
    release_notability:{model:'broad global OR established niche/franchise global OR strong personalized regional attention',global_requirements:policy.global_notability||{},regional_requirements:policy.regional_notability||{},rule:'Steam/store rank is never sufficient by itself. Regional qualification is based on measured audience attention, never developer/game origin.'},
    steam_editorial_discovery:{discovered_candidates:steamEditorial.discovered,sources:steamEditorial.sources},
    release_cover_resolution:{strategy:'every globally or personally visible release must keep its place and receive a verified portrait cover before publication',preferred:'Steam library 600x900 cover',fallbacks:['verified existing portrait cover','trusted official store/publisher/developer portrait artwork','identity-verified reference cover'],...coverResolution.statistics,unresolved:coverResolution.unresolved},
    home_release_cover_sync:{strategy:'copy every validated downloaded visible-release cover back into data/releases/current.json before the full home-feed snapshot is published',synchronized:synchronizedHomeFeedCovers},
    audience_relevance:['Canonical game_id first','Audience regions from explicit audience metadata or configured source audience','Topic/location words are not accepted as audience geography','Repeated high-score regional coverage can qualify only the matching user region'],
    optional_auxiliary:['RAWG enrichment when RAWG_API_KEY is configured'],
    supported_auxiliary:['IGDB/RAWG claims are discovery/cross-check only and cannot confirm a date alone'],
    console_authority:['Official platform stores','publisher/developer sites','official announcements via config/release-official-claims.json'],
  },
  statistics:publicCalendar.statistics,
  game_registry_linkage:{canonical_games_considered:registryMigration.report.canonicalGames,...linkage.statistics},
  notability:{
    broad_global:candidates.filter(item=>item.global_notability?.qualification==='broad-global').length,
    niche_global:candidates.filter(item=>item.global_notability?.qualification==='niche-global').length,
    personalized_regional:publicCalendar.personalized_releases.length,
    blocked:candidates.filter(item=>!item.global_notability?.eligible&&!item.regional_notability?.eligible&&!item.moderation?.rejection_reason).length,
  },
  validation_errors:errors,
};
await Promise.all([fs.mkdir(path.dirname(paths.candidates),{recursive:true}),fs.mkdir(path.dirname(paths.public),{recursive:true})]);
const writes=[
  fs.writeFile(paths.candidates,`${JSON.stringify(candidateDocument,null,2)}\n`),
  fs.writeFile(paths.public,`${JSON.stringify(publicCalendar,null,2)}\n`),
  fs.writeFile(paths.report,`${JSON.stringify(report,null,2)}\n`),
];
if(!errors.length&&synchronizedHomeFeedCovers)writes.push(fs.writeFile(paths.raw,`${JSON.stringify(synchronizedRaw,null,2)}\n`));
await Promise.all(writes);
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
