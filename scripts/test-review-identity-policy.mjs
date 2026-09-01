import assert from 'node:assert/strict';
import { reviewIdentityProblem } from './lib/review-identity-policy.mjs';

const policy={
  slug:'fallout',
  targetAliases:['fallout','fallout a post nuclear role playing game'],
  franchiseToken:'fallout',
  siblingAliases:['fallout new vegas','fallout 76','fallout 2'],
};

const ok=(title,url)=>assert.equal(reviewIdentityProblem({title,url},policy),'',`${title} should be accepted`);
const bad=(title,url,fragment)=>assert.match(reviewIdentityProblem({title,url},policy),new RegExp(fragment),`${title} should be rejected`);

bad('Fallout: New Vegas review','https://www.pcgamer.com/fallout-new-vegas-review','different-game-in-series');
bad('Review: Fallout New Vegas','https://example.com/reviews/fallout-new-vegas','different-game-in-series');
bad('Fallout 76 hands-on gameplay','https://example.com/fallout-76-hands-on-gameplay','different-game-in-series');
bad('Fallout','https://www.ign.com','homepage-not-direct-review');
bad('Fallout','https://www.webcitation.org/x?url=http%3A%2F%2Fwww.gamerankings.com%2Fpc%2F197289-fallout%2Findex.html','wrapped-forbidden-host');
bad('The Elder Scrolls review','https://example.com/the-elder-scrolls-review','target-game-identity-not-evidenced');

ok('Fallout review: why New Vegas improved companions','https://example.com/fallout-review-1997');
ok('Fallout retrospective comparing Fallout 2 and Fallout New Vegas','https://example.com/features/fallout-retrospective-review');
ok('Fallout compared with Fallout New Vegas review scores','https://example.com/reviews/fallout-comparison');
ok('Fallout: A Post Nuclear Role Playing Game review','https://example.com/reviews/fallout');

console.log('Review identity policy regression cases passed.');
