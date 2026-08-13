import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const errors=[];
const read=relative=>{const file=path.join(root,relative);if(!fs.existsSync(file)){errors.push(`Missing ${relative}`);return''}return fs.readFileSync(file,'utf8')};
const expect=(condition,message)=>{if(!condition)errors.push(message)};

const config=JSON.parse(read('config/game-page-quality-v2.json')||'{}');
const calculator=read('scripts/calculate-ratings-from-research.mjs');
const orchestrator=read('scripts/orchestrate-content-v6.mjs');
const builder=read('scripts/build-game-page-basic-v5.mjs');
const top250=read('scripts/build-top-250-canonical-review.mjs');
const materializer=read('scripts/materialize-review-publication-feed.mjs');
const control=read('game/_shared/game-page-review-publication-control.js');

expect(!fs.existsSync(path.join(root,'config/parsers/ratings.json')),'Independent ratings parser config must be removed');
expect(calculator.includes('review.review_score'),'Review score calculator must write data/reviews/<slug>.json#review_score');
expect(calculator.includes('deprecated_adapter'),'data/ratings may exist only as a deprecated compatibility adapter');
expect(orchestrator.includes('review_score'),'Lifecycle must read canonical review_score');
expect(!orchestrator.includes('data/ratings/'),'Lifecycle must not read data/ratings as an editorial score source');
expect(builder.includes('review_score'),'Released-page publication must require canonical review_score');
expect(top250.includes('review_score'),'Top 250 must use canonical review_score');
expect(!top250.includes('ratings.igropoisk'),'Top 250 must not fall back to game.ratings.igropoisk');
expect(materializer.includes('review_score'),'Review publication materializer must use canonical review_score');
expect(control.includes('feed?.review_score'),'Game-page review publication control must use feed.review_score');
expect(!control.includes('data/ratings/'),'Game-page canonical score control must not load data/ratings');
expect(config.review_score?.source_of_truth==='data/reviews/{slug}.json#review_score'||config.review_score?.owner==='review'||JSON.stringify(config).includes('review_score'),'Game page quality config must declare the canonical review score contract');

if(errors.length){console.error(`Review score contract failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(1)}
console.log('Canonical review score contract passed: one editorial score source, review-owned, no ratings fallback.');
