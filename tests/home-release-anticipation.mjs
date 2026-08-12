import assert from 'node:assert/strict';
import { evaluateHomeReleaseQuality } from '../scripts/lib/home-release-quality.mjs';
import { normalizeGameIdentity } from '../scripts/lib/home-feed-identity.mjs';
import { pressPublisherGroup, pressTitleMatches } from '../scripts/lib/release-press-quality.mjs';

assert.equal(pressPublisherGroup('IGN India'),'ign');
assert.equal(pressPublisherGroup('IGN Africa'),'ign');
assert.equal(pressPublisherGroup('IGN France'),'ign');
assert.equal(pressPublisherGroup('IGN'),'ign');
assert.equal(new Set(['IGN','IGN India','IGN Africa','IGN France'].map(pressPublisherGroup)).size,1,'Regional IGN editions must count as one publisher');
assert.equal(pressTitleMatches('Chainsaw','Chainsaw Man Devil Hunters Use Chainsaw to Destroy Demons'),false,'Ambiguous one-word game title must not match Chainsaw Man');
assert.equal(pressTitleMatches('Chainsaw','One of my favorite survival games adds a chainsaw'),false,'Generic mention must not qualify an ambiguous one-word game title');
assert.equal(pressTitleMatches('Duskfade','Duskfade Preview - A Dreamlike Platformer'),true);
assert.equal(pressTitleMatches('STAR WARS Zero Company','Star Wars Zero Company release date and gameplay details'),true);

const title='Cleaning Up The Puzzle Gallery';
const base={title,release_type:'full',events:[{date:'2026-08-20',precision:'exact',confidence:0.99}],image:{verified:true,source_url:'https://example.test/cover.jpg'},editorial:{status:'published',has_page:true,readiness:100},sources:[{family:'steam',status:'ok'}]};
const obscure=evaluateHomeReleaseQuality(base,{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(obscure.homepage_eligible,false,'Published page alone must not make an upcoming release anticipated');
assert.ok(obscure.reasons.includes('no_global_anticipation_signal'));

const steamOnly=evaluateHomeReleaseQuality({...base,anticipation:{steam_popular_upcoming_position:5}},{minimumQuality:7,maximumSteamWishlistPosition:50,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(steamOnly.homepage_eligible,false,'Steam Popular Upcoming alone must not qualify a release globally');
assert.ok(steamOnly.signals.includes('steam_popular_upcoming'));
assert.ok(steamOnly.reasons.includes('no_global_anticipation_signal'));

const popularIdentities=new Set([normalizeGameIdentity(title,[])]);
const covered=evaluateHomeReleaseQuality({...base,anticipation:{independent_publication_count:3,evidence_families:['news','youtube'],popular_index:16,popular_confidence:0.72}},{minimumQuality:7,minimumIndependentCoverage:2,popularIdentities,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(covered.homepage_eligible,true,'Cross-site coverage plus measured popularity should qualify an upcoming release');

const threePressPlusSteam=evaluateHomeReleaseQuality({...base,anticipation:{steam_popular_upcoming_position:32,independent_publication_count:3,evidence_families:['gaming_news']}},{minimumQuality:7,maximumSteamWishlistPosition:50,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(threePressPlusSteam.homepage_eligible,true,'Three independent gaming publications plus Steam Top 50 should qualify');

const fivePressNoSteam=evaluateHomeReleaseQuality({...base,anticipation:{independent_publication_count:5,evidence_families:['gaming_news']}},{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(fivePressNoSteam.homepage_eligible,true,'Broad coverage in five independent gaming publications should qualify without Steam chart support');

const twoPressOnly=evaluateHomeReleaseQuality({...base,anticipation:{independent_publication_count:2,evidence_families:['gaming_news']}},{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(twoPressOnly.homepage_eligible,false,'Two publications alone are insufficient without a current Popular signal');

const staleSourceOnly=evaluateHomeReleaseQuality({...base,title:'STAR WARS Zero Company',image:{verified:true,status:'remote_fallback',source_url:'https://example.test/star-wars.jpg'},editorial:{status:'needs_review',needs_review:true,notes:['Запись исчезла из текущей выдачи источника']},anticipation:{independent_publication_count:5,evidence_families:['gaming_news']}},{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(staleSourceOnly.homepage_eligible,true,'A strongly corroborated exact-date release must not be blocked only because it disappeared from the current source listing');
assert.ok(staleSourceOnly.signals.includes('source_disappearance_override'));

const substantiveReview=evaluateHomeReleaseQuality({...base,title:'Needs Manual Review',editorial:{status:'needs_review',needs_review:true,notes:['Дата требует ручной проверки']},anticipation:{independent_publication_count:6,evidence_families:['gaming_news']}},{minimumQuality:7,now:Date.parse('2026-08-11T00:00:00Z')});
assert.equal(substantiveReview.homepage_eligible,false,'Substantive needs_review reasons must remain fail-closed');
assert.ok(substantiveReview.reasons.includes('needs_review'));
console.log('home release anticipation policy passed');
