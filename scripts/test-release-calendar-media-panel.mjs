import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMediaIntersection } from './lib/release-media-panel.mjs';

const config=JSON.parse(fs.readFileSync('config/release-media-sources.json','utf8'));
assert.equal(config.sources.length,33);
const result=buildMediaIntersection({publisherNames:['IGN','IGN France','GameSpot','PC Gamer','VGC','Игромания','VGTimes','Канобу','PlayGround.ru','GameGuru','VK Play Media'],config});
assert.equal(result.overall_count,10);
assert.equal(result.region_counts.cis,6);
assert.equal(result.rules.no_intersection_count_cap,true);
console.log('release media panel smoke test passed');
