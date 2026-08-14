#!/usr/bin/env node
import assert from 'node:assert/strict';
import {rankSitemapReviewUrls} from './lib/review-publisher-sitemap.mjs';

{
  const ranked=rankSitemapReviewUrls([
    'https://www.pcgamer.com/metal-gear-solid-5-review-roundup-nothing-but-love/',
    'https://www.pcgamer.com/metal-gear-solid-5-review/',
    'https://www.pcgamer.com/unrelated-review/'
  ],{title:'Metal Gear Solid V: The Phantom Pain'});
  assert.equal(ranked[0]?.url,'https://www.pcgamer.com/metal-gear-solid-5-review/');
}
{
  const ranked=rankSitemapReviewUrls([
    'https://www.pcgamer.com/dark-souls-3-the-ringed-city-review/',
    'https://www.pcgamer.com/dark-souls-3-ashes-of-ariandel-review/',
    'https://www.pcgamer.com/dark-souls-3-review/'
  ],{title:'Dark Souls III'});
  assert.equal(ranked[0]?.url,'https://www.pcgamer.com/dark-souls-3-review/');
}
{
  const ranked=rankSitemapReviewUrls([
    'https://www.pcgamer.com/pillars-of-eternity-2-deadfire-review/',
    'https://www.pcgamer.com/red-dead-redemption-2-review/'
  ],{title:'Red Dead Redemption 2'});
  assert.equal(ranked.length,1);
  assert.equal(ranked[0]?.url,'https://www.pcgamer.com/red-dead-redemption-2-review/');
}
{
  const ranked=rankSitemapReviewUrls(['https://www.gamesradar.com/ghost-recon-wildlands-review/'],{title:"Tom Clancy's Ghost Recon Wildlands"});
  assert.equal(ranked.length,1);
}
console.log('Publisher sitemap discovery contract passed.');
