import assert from 'node:assert/strict';
import { parseCalendarDate, extractCalendarClaims, claimsToPublicationRecords, mergePublicationRecords } from './lib/release-publication-discovery.mjs';
import { loadOfficialSourceRegistry, attachOfficialSourceChecks, summarizeOfficialSourceCoverage } from './lib/official-source-registry.mjs';

const exactEn=parseCalendarDate('Metal Gear Solid — August 27, 2026',2026);
assert.equal(exactEn.precision,'exact');
assert.equal(exactEn.date,'2026-08-27');
const exactRu=parseCalendarDate('Star Wars — 27 августа 2026',2026);
assert.equal(exactRu.precision,'exact');
assert.equal(exactRu.date,'2026-08-27');
const monthOnly=parseCalendarDate('BOMBANANA! — August 2026',2026);
assert.equal(monthOnly.precision,'month');
assert.equal(monthOnly.date,null);
assert.equal(monthOnly.date_start,'2026-08-01');
assert.equal(monthOnly.date_end,'2026-08-31');

const source={id:'pc-gamer',name:'PC Gamer',publisher_family:'pc-gamer',release:{roles:['calendar_discovery'],platform_focus:['PC']}};
const html='<section><h2>August 27, 2026</h2><a href="/games/star-wars-zero-company/">Star Wars: Zero Company</a></section>';
const claims=extractCalendarClaims(html,{source,url:'https://www.pcgamer.com/games/new-pc-games-2026/',now:Date.parse('2026-08-14T00:00:00Z'),horizonDays:180});
assert.equal(claims.length,1);
assert.equal(claims[0].date_claim.date,'2026-08-27');
const publication=claimsToPublicationRecords(claims,'2026-08-14T00:00:00Z');
assert.equal(publication.length,1);
assert.equal(publication[0].events[0].platforms[0],'PC');
assert.equal(publication[0].editorial_quality.independent_source_count,1);

const steamRecord={
  id:'steam:123',slug:'star-wars-zero-company',title:'Star Wars: Zero Company',external_ids:{steam:123},
  sources:[{id:'steam:123',family:'official_store',title:'Steam',url:'https://store.steampowered.com/app/123/',status:'success'}],
  events:[{id:'steam-event',date:'2026-08-27',date_start:'2026-08-27',date_end:'2026-08-27',precision:'exact',region:'worldwide',platforms:['PC'],source_ids:['steam:123'],confidence:0.97}],
  editorial_quality:{signals:[],source_families:[],independent_source_count:0},
};
const merged=mergePublicationRecords([steamRecord],publication);
assert.equal(merged.length,1);
assert.ok(merged[0].sources.some(item=>item.registry_source_id==='pc-gamer'));
assert.equal(merged[0].editorial_quality.independent_source_count,1);

const officialRegistry=loadOfficialSourceRegistry('config/parsers/official-source-registry.json');
const officialRecord={
  ...steamRecord,
  events:[{...steamRecord.events[0],platforms:['PC','PlayStation 5']}],
};
const checked=attachOfficialSourceChecks([officialRecord],officialRegistry,'2026-08-14T00:00:00Z');
const steamCheck=checked[0].official_source_checks.checks.find(item=>item.source_id==='steam');
const playstationCheck=checked[0].official_source_checks.checks.find(item=>item.source_id==='playstation-store');
assert.equal(steamCheck.applicable,true);
assert.equal(steamCheck.checked,true);
assert.equal(playstationCheck.applicable,true);
assert.equal(playstationCheck.checked,false);
const coverage=summarizeOfficialSourceCoverage(checked,officialRegistry);
assert.equal(coverage.applicable_checks,2);
assert.equal(coverage.completed_checks,1);
assert.equal(coverage.pending_checks,1);

console.log(JSON.stringify({status:'green',date_precision_cases:3,publication_claims:claims.length,official_applicable_checks:coverage.applicable_checks,official_pending_checks:coverage.pending_checks},null,2));
