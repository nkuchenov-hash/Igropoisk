#!/usr/bin/env node
import fs from 'node:fs';

const source=fs.readFileSync('game/_shared/game-page-review-publication-control.js','utf8');
const fail=message=>{throw new Error(message)};
for(const marker of [
  'data/review-bootstrap/',
  'bootstrapReady',
  "feed?.igropoisk_article?.review_stage==='bootstrap'",
  "bootstrap?.review_stage==='bootstrap'",
  'bootstrap.sources.length>=3',
  'const green=fullReady||bootstrapReady',
  "reviewStage:fullReady?'full':bootstrapReady?'bootstrap':null"
])if(!source.includes(marker))fail(`Bootstrap review publication contract missing: ${marker}`);
if(source.includes("const green=feed?.publication_gate?.status==='green'\n    &&feed?.review_score?.status==='green'\n    &&Number.isFinite(canonical)\n    &&String(article?.publication_status"))fail('Game page still requires the full article before exposing any canonical review');
console.log('Game page bootstrap review publication contract passed.');
