import assert from 'node:assert/strict';
import { evaluateHomeReleaseQuality } from '../scripts/lib/home-release-quality.mjs';

const base={title:'Cleaning Up The Puzzle Gallery',release_type:'full',events:[{date:'2026-08-20',precision:'exact'}],image:{verified:true,source_url:'https://example.test/cover.jpg'},editorial:{status:'published',has_page:true,readiness:100},sources:[{family:'steam',status:'ok'}]};
const obscure=evaluateHomeReleaseQuality(base,{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(obscure.homepage_eligible,false,'Published page alone must not make an upcoming release anticipated');
assert.ok(obscure.reasons.includes('no_anticipation_signal'));

const steam=evaluateHomeReleaseQuality({...base,anticipation:{steam_popular_upcoming_position:12}},{minimumQuality:7,maximumSteamWishlistPosition:100,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(steam.homepage_eligible,true,'A high Steam popular-upcoming position should qualify');
assert.ok(steam.signals.includes('steam_popular_upcoming'));

const covered=evaluateHomeReleaseQuality({...base,anticipation:{independent_publication_count:3,evidence_families:['news','youtube']}},{minimumQuality:7,minimumIndependentCoverage:2,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(covered.homepage_eligible,true,'Cross-site coverage should qualify an upcoming release');
assert.ok(covered.signals.includes('cross_site_coverage'));
console.log('home release anticipation policy passed');
