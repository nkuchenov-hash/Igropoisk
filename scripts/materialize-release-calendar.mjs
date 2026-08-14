import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { migrateRepository } from './lib/game-registry-migration.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { attachAudienceAffinity, buildPersonalizedReleases, validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';
import { enrichRawReleasesFromSteamEditorial } from './lib/release-steam-editorial-discovery.mjs';
import { applyGlobalNotabilityGate, validateGlobalNotability } from './lib/release-notability.mjs';
import { ensureVisibleReleaseCovers, validateVisibleReleaseCovers } from './lib/release-cover-resolver.mjs';
import { loadPublicationSourceRegistry, publicationRegistryStats } from './lib/publication-source-registry.mjs';
import { loadOfficialSourceRegistry, attachOfficialSourceChecks, summarizeOfficialSourceCoverage, validateOfficialSourceRegistryWiring } from './lib/official-source-registry.mjs';
import { mergePublicationRecords } from './lib/release-publication-discovery.mjs';

const ROOT = process.cwd();
const paths = {
  raw: path.join(ROOT, 'data/releases/current.json'),
  publicationDiscovery: path.join(ROOT, 'data/release-candidates/publication-discovery.json'),
  editorial: path.join(ROOT, 'data/release-candidates/editorial.json'),
  claims: path.join(ROOT, 'config/release-official-claims.json'),
  policy: path.join(ROOT, 'config/release-calendar.json'),
  parserConfig: path.join(ROOT, 'config/parsers/releases.json'),
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

const [raw,publicationDiscovery,editorial,claimsDoc,policy,parserConfig,newsDoc,rankedNewsDoc,popularDoc]=await Promise.all([
  readJson(paths.raw,{releases:[]}),readJson(paths.publicationDiscovery,{schema_version:1,releases:[],statistics:{},sources:[]}),readJson(paths.editorial,{schema_version:1,decisions:{}}),readJson(paths.claims,{schema_version:1,claims:[]}),readJson(paths.policy,{}),readJson(paths.parserConfig,{}),readJson(paths.news,{items:[]}),readJson(paths.rankedNews,{items:[]}),readJson(paths.popular,{ranking:[]}),
]);
const generatedAt=new Date().toISOString();
if(!parserConfig.publication_source_registry)throw new Error('Release parser must configure publication_source_registry');
if(!parserConfig.official_source_registry)throw new Error('Release parser must configure official_source_registry');
const publicationRegistry=loadPublicationSourceRegistry(parserConfig.publication_source_registry);
const officialRegistry=loadOfficialSourceRegistry(parserConfig.official_source_registry);
const publicationStats=publicationRegistryStats(publicationRegistry);
if(publicationDiscovery.registry_id&&publicationDiscovery.registry_id!==publicationRegistry.id)throw new Error(`Publication discovery snapshot registry mismatch: ${publicationDiscovery.registry_id} != ${publicationRegistry.id}`);

const rawBaseWithOfficialChecks={
  ...raw,
  releases:attachOfficialSourceChecks(Array.isArray(raw?.releases)?raw.releases:[],officialRegistry,generatedAt),
};
const publicationRecords=Array.isArray(publicationDiscovery?.releases)?publicationDiscovery.releases:[];
const discoveryMerged=mergePublicationRecords(rawBaseWithOfficialChecks.releases,publicationRecords);
const discoveryMergedWithOfficialChecks=attachOfficialSourceChecks(discoveryMerged,officialRegistry,generatedAt);
const officialCoverage=summarizeOfficialSourceCoverage(discoveryMergedWithOfficialChecks,officialRegistry);
const steamEditorial=await enrichRawReleasesFromSteamEditorial(discoveryMergedWithOfficialChecks,policy,generatedAt);
const rawById=new Map(steamEditorial.releases.map(item=>[item.id,item]));
let rawCandidates=buildCandidates({rawReleases:steamEditorial.releases,editorial,officialClaims:Array.isArray(claimsDoc?.claims)?claimsDoc.claims:[],policy});
rawCandidates=rawCandidates.map(candidate=>{const source=rawById.get(candidate.id)||{};return {...candidate,editorial_quality:source.editorial_quality||{},anticipation:source.anticipation||null,media_intersection:source.media_intersection||null,official_source_checks:source.official_source_checks||null}});
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
const coverResolution=await ensureVisibleReleaseCovers(candidates,{root:ROOT,visibleIds,minimumBytes:4_000,concurrency:6});
candidates=coverResolution.candidates;

let publicCalendar=buildPublicCalendar(candidates,generatedAt);
publicCalendar=attachCanonicalGameIdsToPublicCalendar(publicCalendar,candidates);
const candidateById=new Map(candidates.map(candidate=>[candidate.id,candidate]));
publicCalendar.releases=(publicCalendar.releases||[]).map(release=>{const candidate=candidateById.get(release.id);return {...release,global_notability:candidate?.global_notability||null,media_intersection:candidate?.media_intersection||null,audience_affinity:candidate?.audience_affinity||null,regional_notability:candidate?.regional_notability||null,official_source_checks:candidate?.official_source_checks||null}});
publicCalendar.personalized_releases=buildPersonalizedReleases(candidates,policy);
publicCalendar.personalization={
  model:'fixed-media-intersection-or-niche-or-strong-user-region-v1',
  rule:'Global releases qualify through the permanent editorial media intersection or established niche/franchise attention. A non-global release may additionally appear only for users whose region has strong measured editorial or audience attention. Origin or language support alone never qualifies.',
  client_minimum_score:Number(policy.personalized_client_minimum_score||90),
};
publicCalendar.statistics.personalized=publicCalendar.personalized_releases.length;
publicCalendar.statistics.coverage_percent=coverResolution.statistics.coverage_percent;
const errors=[
  ...validateCalendar({candidates,publicCalendar,policy}),
  ...validateGlobalNotability({candidates,publicCalendar}),
  ...validatePersonalizedReleases({candidates,publicCalendar,policy}),
  ...validateVisibleReleaseCovers(publicCalendar),
  ...validateOfficialSourceRegistryWiring({registry:officialRegistry,records:discoveryMergedWithOfficialChecks}),
];
if(publicationStats.release_coverage_sources<1)errors.push('Publication Registry has no release coverage sources');
if(publicationStats.calendar_discovery_sources<1)errors.push('Publication Registry has no calendar discovery sources');

const validatedCoverById=new Map(
  candidates
    .filter(candidate=>candidate?.image?.local_url&&candidate?.image?.status==='downloaded_verified'&&candidate?.image?.verified===true)
    .map(candidate=>[candidate.id,candidate.image])
);
let synchronizedHomeFeedCovers=0;
let synchronizedRaw=rawBaseWithOfficialChecks;
if(!errors.length&&validatedCoverById.size){
  synchronizedRaw={
    ...rawBaseWithOfficialChecks,
    releases:(rawBaseWithOfficialChecks.releases||[]).map(release=>{
      const image=validatedCoverById.get(release.id);
      if(!image)return release;
      const previous=release.image||{};
      if(previous.local_url===image.local_url&&previous.status===image.status&&previous.verified===image.verified)return release;
      synchronizedHomeFeedCovers++;
      return {...release,image};
    }),
  };
}

const candidateDocument={schema_version:8,generated_at:generatedAt,raw_generated_at:raw?.generated_at||null,publication_discovery_generated_at:publicationDiscovery?.generated_at||null,news_generated_at:newsDoc?.generatedAt||null,popular_generated_at:popularDoc?.generated_at||null,candidates,statistics:publicCalendar.statistics,source_registries:{publication:publicationStats,official:officialCoverage},publication_discovery:publicationDiscovery?.statistics||{}};
const intersections=candidates.map(item=>Number(item.media_intersection?.overall_count||0));
const report={
  schema_version:8,generated_at:generatedAt,
  sources:{
    active_discovery:['Steam coming-soon/appdetails (PC only)','Publication Registry calendar discovery snapshot','Publication Registry editorial coverage/upcoming signals','Steam Popular Upcoming discovery signal','Steam Popular New discovery signal'],
    publication_registry:{path:parserConfig.publication_source_registry,...publicationStats},
    publication_calendar_discovery:{path:'data/release-candidates/publication-discovery.json',generated_at:publicationDiscovery?.generated_at||null,status:publicationDiscovery?.status||'missing',statistics:publicationDiscovery?.statistics||{},source_statuses:publicationDiscovery?.sources||[]},
    official_source_registry:{path:parserConfig.official_source_registry,registry_id:officialRegistry.id,registered_sources:officialRegistry.sources.length,policy:officialRegistry.policies},
    release_notability:{model:'permanent editorial media intersection OR established niche/franchise global OR strong personalized regional attention',global_requirements:policy.global_notability||{},regional_requirements:policy.regional_notability||{},rule:'Every configured editorial publisher family counts once and the intersection count is not capped. Steam/store rank is never sufficient by itself.'},
    steam_editorial_discovery:{discovered_candidates:steamEditorial.discovered,sources:steamEditorial.sources},
    release_cover_resolution:{strategy:'verified local asset required for every globally or personally visible release',preferred:'Steam library 600x900 cover',fallbacks:['existing official image','Steam capsule','Steam header','Steam background','Steam screenshot'],...coverResolution.statistics,unresolved:coverResolution.unresolved},
    home_release_cover_sync:{strategy:'copy every validated downloaded visible-release cover back into data/releases/current.json before the full home-feed snapshot is published',synchronized:synchronizedHomeFeedCovers},
    audience_relevance:['Canonical game_id first','Permanent editorial media-panel region counts','Audience regions from explicit audience metadata or configured source audience','Topic/location words are not accepted as audience geography'],
    optional_auxiliary:['RAWG enrichment when RAWG_API_KEY is configured'],
    supported_auxiliary:['IGDB/RAWG claims are discovery/cross-check only and cannot confirm a date alone'],
    console_authority:officialRegistry.policies?.date_authority_order||[],
  },
  official_source_coverage:officialCoverage,
  statistics:publicCalendar.statistics,
  media_intersection:{max:Math.max(0,...intersections),average:intersections.length?Number((intersections.reduce((sum,value)=>sum+value,0)/intersections.length).toFixed(2)):0,with_any:candidates.filter(item=>Number(item.media_intersection?.overall_count||0)>0).length,with_cis:candidates.filter(item=>Number(item.media_intersection?.region_counts?.cis||0)>0).length},
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
if(!errors.length)writes.push(fs.writeFile(paths.raw,`${JSON.stringify(synchronizedRaw,null,2)}\n`));
await Promise.all(writes);
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
