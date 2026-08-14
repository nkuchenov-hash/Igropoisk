#!/usr/bin/env node
import assert from 'node:assert/strict';
import {loadReviewSourceRegistry,findRegisteredSource} from './lib/review-source-registry.mjs';
import {extractExplicitEditorialScore} from './lib/review-score-extractor.mjs';

const registry=loadReviewSourceRegistry('config/parsers/review-source-registry.json');
const source=id=>{const value=findRegisteredSource(registry,{configured_source_id:id});assert.ok(value,`${id} must be registered`);return value};
const score=(id,html)=>extractExplicitEditorialScore(html,source(id));

{
  const hit=score('game-revolution','<ul class="xe-review-reports"><li>Pro</li></ul><div class="xe-review-reports__rating"><p>10</p></div>');
  assert.equal(hit?.score,10);assert.equal(hit?.scale,10);assert.equal(hit?.method,'registry:game-revolution');
}
{
  const hit=score('worthplaying','<p><strong>Score: 7.0/10</strong></p>');
  assert.equal(hit?.score,7);assert.equal(hit?.scale,10);assert.equal(hit?.method,'registry:worthplaying');
}
{
  const hit=score('gry-online','<div class="oce-game-box oce-gre cf cf-jc"><div class="oce-rate">9.1</div></div><div><p class="mb0">GRYOnline</p></div><div class="oce-game-box"><div class="oce-rate">9.0</div></div><p>Gracze</p>');
  assert.equal(hit?.score,9.1);assert.equal(hit?.scale,10);assert.equal(hit?.method,'registry:gry-online');
}
{
  assert.equal(score('gry-online','<div class="oce-rate">9.0</div><p>Gracze</p>'),null,'reader score must not become GRYOnline editorial score');
  assert.equal(score('game-revolution','<abbr class="rating">10</abbr>'),null,'unscoped site rating must not become GameRevolution editorial score');
  assert.equal(score('worthplaying','<div>Reader Score: 9.5/10</div>'),null,'reader score must not become WorthPlaying editorial score');
}
console.log('Source-specific editorial score adapter contract passed.');
