import assert from 'node:assert/strict';
import { parserRunBelongsToSlug } from './lib/game-page-target-artifacts.mjs';

for (const name of [
  'ratings-fallout.json',
  'review-research-fallout.json',
  'quality-control-review-fallout.json',
  'historical-score-recovery-fallout.json',
  'fallout.json',
]) assert.equal(parserRunBelongsToSlug(name, 'fallout'), true, `${name} should belong to fallout`);

for (const name of [
  'ratings-fallout-2.json',
  'ratings-fallout-3.json',
  'ratings-fallout-76.json',
  'review-native-discovery-fallout-new-vegas.json',
  'quality-control-review-fallout-tactics-brotherhood-of-steel.json',
  'review-output-fallout-4.json',
]) assert.equal(parserRunBelongsToSlug(name, 'fallout'), false, `${name} must not belong to fallout`);

console.log('Game Page target artifact matcher regression cases passed.');
