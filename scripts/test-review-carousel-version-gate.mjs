#!/usr/bin/env node
import fs from 'node:fs';
import {isWrongVersionReview} from './lib/review-version-gate.mjs';

const read=path=>fs.readFileSync(path,'utf8');
const policy=JSON.parse(read('config/parsers/review-media-policy.json'));
const local=read('scripts/enrich-review-media-local.mjs');
const github=read('scripts/enrich-review-media-github-models.mjs');
const openai=read('scripts/enrich-review-media.mjs');
const renderer=read('scripts/render-review-pages.mjs');
const runtime=read('article/_shared/review-carousel.js');
const fail=message=>{throw new Error(message)};
const carousel=policy.article_balance?.carousel_policy||{};
if(Number(carousel.minimum_carousels)!==2||Number(carousel.target_carousels)!==3||Number(carousel.minimum_images_per_carousel)!==2||Number(carousel.maximum_images_per_carousel)!==4)fail('Review carousel policy must be 2-3 meaningful carousels with 2-4 images each');
if(policy.discovery_policy?.continue_search_until_every_section_is_filled!==false)fail('Media discovery still tries to fill every section');
if(policy.publication_gate?.missing_one_image_in_any_section_is_failure!==false)fail('Review publication still requires an image in every section');
for(const [name,source] of [['local',local],['github',github],['openai',openai]]){
  for(const marker of ['minimumCarousels','minimumImages','media_commentary','visible_subject','commentary'])if(!source.includes(marker))fail(`${name} visual path missing carousel marker: ${marker}`);
  if(/ровно один|exactly one verified image per section/i.test(source))fail(`${name} visual path still forces one screenshot per section`);
}
for(const marker of ['meaningful carousels','media_commentary','carouselCount'])if(!renderer.includes(marker))fail(`Renderer missing meaningful-carousel contract: ${marker}`);
if(!runtime.includes("entry.commentary||''"))fail('Runtime carousel drops visual commentary');
const wrong=[
  [{title:'Fallout 76: Wastelanders Review'},'Fallout 76'],
  [{title:'Some Game — DLC Review'},'Some Game'],
  [{title:'Some Game Review',version_context:'expansion'},'Some Game']
];
for(const [item,title] of wrong)if(!isWrongVersionReview(item,title))fail(`Version gate failed to reject ${item.title}`);
const allowed=[
  [{title:'Fallout 76 Review: a troubled online wasteland'},'Fallout 76'],
  [{title:'Fallout Tactics: Brotherhood of Steel Review'},'Fallout Tactics: Brotherhood of Steel'],
  [{title:'Some Game Review'},'Some Game']
];
for(const [item,title] of allowed)if(isWrongVersionReview(item,title))fail(`Version gate falsely rejected ${item.title}`);
console.log('Meaningful review carousel and exact-version gate contract passed.');
