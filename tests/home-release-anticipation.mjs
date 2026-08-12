import assert from 'node:assert/strict';
import { evaluateHomeReleaseQuality } from '../scripts/lib/home-release-quality.mjs';
import { normalizeGameIdentity } from '../scripts/lib/home-feed-identity.mjs';

const title='Cleaning Up The Puzzle Gallery';
const base={title,release_type:'full',events:[{date:'2026-08-20',precision:'exact'}],image:{verified:true,source_url:'https://example.test/cover.jpg'},editorial:{status:'published',has_page:true,readiness:100},sources:[{family:'steam',status:'ok'}]};
const obscure=evaluateHomeReleaseQuality(base,{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(obscure.homepage_eligible,false,'Published page alone must not make an upcoming release anticipated');
assert.ok(obscure.reasons.includes('no_global_anticipation_signal'));

const steamOnly=evaluateHomeReleaseQuality({...base,anticipation:{steam_popular_upcoming_position:5}},{minimumQuality:7,maximumSteamWishlistPosition:10,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(steamOnly.homepage_eligible,false,'Steam Popular Upcoming alone must not qualify a release globally');
assert.ok(steamOnly.signals.includes('steam_popular_upcoming'));
assert.ok(steamOnly.reasons.includes('no_global_anticipation_signal'));

const popularIdentities=new Set([normalizeGameIdentity(title,[])]);
const covered=evaluateHomeReleaseQuality({...base,anticipation:{independent_publication_count:3,evidence_families:['news','youtube'],popular_index:16,popular_confidence:0.72}},{minimumQuality:7,minimumIndependentCoverage:2,popularIdentities,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(covered.homepage_eligible,true,'Cross-site coverage plus measured popularity should qualify an upcoming release');
assert.ok(covered.signals.includes('cross_site_coverage'));
assert.ok(covered.signals.includes('current_popular'));

const corroboratedSteam=evaluateHomeReleaseQuality({...base,anticipation:{steam_popular_upcoming_position:4,independent_publication_count:2,evidence_families:['news','youtube'],popular_index:12,popular_confidence:0.62}},{minimumQuality:7,maximumSteamWishlistPosition:10,popularIdentities,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(corroboratedSteam.homepage_eligible,true,'Top Steam interest may qualify only when independent cross-site evidence also exists');
assert.ok(corroboratedSteam.signals.includes('steam_popular_upcoming'));
assert.ok(corroboratedSteam.signals.includes('cross_site_coverage'));
console.log('home release anticipation policy passed');
