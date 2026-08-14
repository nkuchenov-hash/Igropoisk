import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';
import { attachCanonicalGameIdsToPublicCalendar, linkReleaseCandidatesToRegistry } from './lib/release-game-registry-adapter.mjs';
import { attachAudienceAffinity, buildPersonalizedReleases, validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';
import { applyGlobalNotabilityGate, validateGlobalNotability } from './lib/release-notability.mjs';
import { parseReleaseDateClaim } from './lib/release-date-precision.mjs';
import { rawReleaseFromSteamDetails } from './lib/release-steam-editorial-discovery.mjs';
import { applyReleaseScores } from './lib/release-scores.mjs';
import { createGameEntity, createRegistry, rebuildIndexes } from './lib/game-registry.mjs';

const steamSource=id=>({id:`steam:${id}`,family:'official_store',title:'Steam',url:`https://store.steampowered.com/app/${id}/`,platforms:['PC']});
const event=(id,title,platforms=['PC'],sourceIds=[`steam:${id}`],date='2026-10-10')=>({
  id:`steam:${id}`,slug:title.toLowerCase().replace(/[^a-z0-9]+/g,'-'),title,release_type:'full',external_ids:{steam:id},sources:[steamSource(id)],
  events:[{id:`e:${id}`,date,date_start:date,date_end:date,precision:'exact',region:'worldwide',platforms,confidence:0.97,source_ids:sourceIds}],
  editorial_quality:{homepage_eligible:true,quality_score:10,signals:['current_popular']},
});

// Exclusions, manual decisions and platform confirmation still work.
const raw=[event(1,'Important Game'),event(2,'Important Game Demo'),event(3,'Important Game Playtest'),event(4,'Important Game Deluxe Edition'),event(5,'Console Leak',['PlayStation 5'])];
const editorial={decisions:{'steam:1':{decision:'rejected',rejection_reason:'editorial ban',publication_forbidden:true,locked_fields:['decision']}}};
const claims=[{slug:'console-leak',platforms:['PlayStation 5'],date:'2026-10-12',source:{id:'ps-store:5',family:'platform_store',title:'PlayStation Store',url:'https://store.playstation.com/example',platforms:['PlayStation 5']},confidence:0.98}];
const basePolicy={minimum_significance_score:1,signal_weights:{current_popular:18}};
const candidates=buildCandidates({rawReleases:raw,editorial,officialClaims:claims,policy:basePolicy});
const byId=new Map(candidates.map(candidate=>[candidate.id,candidate]));
assert.equal(byId.get('steam:1').moderation.status,'rejected');
assert.equal(byId.get('steam:2').moderation.rejection_reason,'demo');
assert.equal(byId.get('steam:3').moderation.rejection_reason,'playtest');
assert.equal(byId.get('steam:4').moderation.rejection_reason,'duplicate_edition');
assert.equal(byId.get('steam:5').events.some(item=>item.platform_confirmations['PlayStation 5']?.includes('ps-store:5')),true);

// Public quantity is never a quality criterion: all 25 eligible releases on one day remain public.
const crowdedRaw=Array.from({length:25},(_,index)=>event(1000+index,`Eligible ${index}`));
const crowdedCandidates=buildCandidates({rawReleases:crowdedRaw,editorial:{decisions:{}},officialClaims:[],policy:basePolicy});
assert.equal(crowdedCandidates.filter(item=>item.moderation.status==='published').length,25);
assert.equal(crowdedCandidates.some(item=>item.moderation.automatic_reasons?.includes('daily_cap')),false);
const crowdedCalendar=buildPublicCalendar(crowdedCandidates,'2026-08-14T00:00:00Z');
assert.equal(crowdedCalendar.releases.length,25);
assert.equal(crowdedCalendar.statistics.max_exact_releases_in_one_day,25);
assert.equal(crowdedCalendar.statistics.public_quantity_cap,null);
assert.deepEqual(validateCalendar({candidates:crowdedCandidates,publicCalendar:crowdedCalendar,policy:{...basePolicy,max_public_releases_per_day:1}}),[],'legacy cap config must not truncate or invalidate public releases');

// Game Registry linking remains canonical and ambiguity-safe.
const registry=createRegistry({generatedAt:'2026-08-14T00:00:00Z'});
const exactGame=createGameEntity({title:'Canonical Exact Game',steamAppId:9001,releaseYear:2026,kind:'game'},{now:'2026-08-14T00:00:00Z'});
const conflictingGame=createGameEntity({title:'Shared Identity',releaseYear:2026,kind:'game'},{now:'2026-08-14T00:00:00Z'});
registry.games[exactGame.id]=exactGame;registry.games[conflictingGame.id]=conflictingGame;rebuildIndexes(registry);
const adapterCandidates=[{...event(9001,'Store Title Changed'),moderation:{status:'published'}},{...event(9002,'Shared Identity'),release_type:'expansion',external_ids:{},moderation:{status:'review'}},{...event(9003,'Completely Unknown'),external_ids:{},moderation:{status:'review'}}];
const linked=linkReleaseCandidatesToRegistry(adapterCandidates,registry);
const linkedById=new Map(linked.candidates.map(candidate=>[candidate.id,candidate]));
assert.equal(linkedById.get('steam:9001').game_resolution.status,'matched');
assert.equal(linkedById.get('steam:9001').game_id,exactGame.id);
assert.equal(linkedById.get('steam:9002').game_resolution.status,'needs_review');
assert.equal(Object.hasOwn(linkedById.get('steam:9002'),'game_id'),false);
assert.equal(linkedById.get('steam:9003').game_resolution.status,'unresolved');
const linkedPublic=attachCanonicalGameIdsToPublicCalendar({releases:adapterCandidates.map(candidate=>({id:candidate.id,title:candidate.title}))},linked.candidates);
assert.equal(linkedPublic.releases.find(item=>item.id==='steam:9001').game_id,exactGame.id);
assert.deepEqual(linked.statistics,{matched:1,needs_review:1,unresolved:1});

// Steam alone cannot make a game notable; independent coverage or established niche attention can.
const notabilityPolicy={global_notability:{broad_press_minimum:4,corroborated_press_minimum:3,intense_cross_site_press_minimum:2,popular_minimum_score:10,popular_minimum_confidence:0.5,popular_minimum_families:2,intense_cross_site_popular_score_minimum:15,intense_cross_site_popular_confidence_minimum:0.6,intense_cross_site_popular_families_minimum:3,global_score_minimum:450,trend_score_minimum:450,discussion_minimum:3,niche_current_press_minimum:1,niche_historical_franchise_press_minimum:4,niche_cross_site_families_minimum:2}};
const steamOnly={...event(7001,'Steam Only'),game_id:'game-steam',moderation:{status:'published',automatic_reasons:[]},significance:{score:28,signals:['steam_popular_upcoming']},editorial_quality:{signals:['steam_popular_upcoming'],independent_source_count:0}};
const globallyTalked={...event(7002,'Global Blockbuster'),game_id:'game-global',moderation:{status:'review',automatic_reasons:[]},significance:{score:8,signals:[]},editorial_quality:{signals:[],independent_source_count:4}};
const nicheKnown={...event(7003,'Established Specialist Simulator'),game_id:'game-niche',moderation:{status:'review',automatic_reasons:[]},significance:{score:8,signals:[]},editorial_quality:{signals:[],independent_source_count:1,franchise_independent_source_count:5},anticipation:{independent_publication_count:1,franchise_independent_publication_count:5,franchise_query:'Established Simulator',independent_evidence_families:['gaming_news','youtube'],cross_site_coverage:true}};
const gated=applyGlobalNotabilityGate([steamOnly,globallyTalked,nicheKnown],{newsEvents:[],popularRanking:[],policy:notabilityPolicy});
assert.equal(gated.find(item=>item.id==='steam:7001').moderation.status,'review');
assert.equal(gated.find(item=>item.id==='steam:7002').moderation.status,'published');
assert.equal(gated.find(item=>item.id==='steam:7003').moderation.status,'published');
assert.deepEqual(validateGlobalNotability({candidates:gated,publicCalendar:{releases:[{id:'steam:7002'},{id:'steam:7003'}]}}),[]);

// Expected score and release confidence are independent dimensions.
const scorePolicy={expected_score:{consensus_points_per_source:8,consensus_cap:48,steam_signal_points:4}};
const editorialSources=['pc-gamer','gamespot','stopgame','vgc','gamepressure'].map(id=>({id:`publication:${id}`,registry_source_id:id,family:'editorial_calendar',title:id,url:`https://${id}.example/`,status:'success'}));
const important={...event(8100,'Consensus Game'),sources:[steamSource(8100),...editorialSources],events:[{...event(8100,'x').events[0],source_ids:['steam:8100',...editorialSources.map(item=>item.id)]}],significance:{signals:['steam_popular_upcoming']},global_notability:{metrics:{media_intersection_count:5}},anticipation:{independent_publication_count:5}};
const scored=applyReleaseScores([important],scorePolicy)[0];
assert.equal(scored.release_confidence.status,'official-store-confirmed');
assert.ok(scored.release_confidence.score>=0.95);
assert.ok(scored.expected_score.score>=40,'five-publication consensus must dominate expected score');
assert.ok(scored.expected_score.components.steam_signal<=4,'Steam must remain a minor expected-score signal');

// Regional personalization remains separate from global publication.
const regionalPolicy={regional_notability:{strong_score_minimum:220,strong_event_minimum:2,strong_source_minimum:1,corroborated_score_minimum:170,corroborated_source_minimum:2},audience_source_regions:{'PlayGround.ru':['cis']},max_personalized_releases_per_day:6,max_personalized_pool:80};
const il2={...event(777,'Korea. IL-2 Series'),game_id:'game-il2',moderation:{status:'review'},global_notability:{eligible:false,metrics:{historical_franchise_publications:0}}};
const regionalEvents=[
  {id:'news-il2-a',titleEn:'Korea. IL-2 Series launches',regionalEligible:true,regionalScore:275,regions:['korea'],gameIds:['game-il2'],primarySource:'PlayGround.ru',sources:[{name:'PlayGround.ru',official:false}]},
  {id:'news-il2-b',titleEn:'Players discuss Korea. IL-2 Series release',regionalEligible:true,regionalScore:260,regions:['korea'],gameIds:['game-il2'],primarySource:'PlayGround.ru',sources:[{name:'PlayGround.ru',official:false}]},
];
const audience=attachAudienceAffinity([il2],regionalEvents,regionalPolicy)[0];
assert.equal(audience.audience_affinity.regions.cis,275);
assert.equal(Object.hasOwn(audience.audience_affinity.regions,'korea'),false);
assert.equal(audience.regional_notability.eligible,true);
const personalized=buildPersonalizedReleases([audience],regionalPolicy);
assert.equal(personalized.length,1);
assert.deepEqual(validatePersonalizedReleases({candidates:[audience],publicCalendar:{releases:[],personalized_releases:personalized}}),[]);

// Approximate dates never become invented exact days.
const month=parseReleaseDateClaim('August 2026');
assert.deepEqual(month,{precision:'month',date:null,date_start:'2026-08-01',date_end:'2026-08-31',raw_date:'August 2026'});
const discoveredMonth=rawReleaseFromSteamDetails({type:'game',name:'Month Only Game',release_date:{date:'August 2026'},genres:[],developers:['Studio'],publishers:['Publisher']},8080,['steam_popular_upcoming'],'2026-08-01T00:00:00Z');
assert.equal(discoveredMonth.events[0].precision,'month');
assert.equal(discoveredMonth.events[0].date,null);
assert.equal(discoveredMonth.events[0].date_start,'2026-08-01');
const exact=parseReleaseDateClaim('Aug 4, 2026');
assert.equal(exact.precision,'exact');
assert.equal(exact.date,'2026-08-04');

const runtime=await fs.readFile('assets/release-calendar.js','utf8');
new Function(runtime);
assert.match(runtime,/home-feeds\/manifests\/current\.json/);
assert.match(runtime,/repository-fallback/);
assert.match(runtime,/mergePersonalized\(/);

console.log(JSON.stringify({status:'green',public_cap_removed:true,crowded_day_releases:crowdedCalendar.releases.length,release_confidence:scored.release_confidence.score,expected_score:scored.expected_score.score},null,2));
