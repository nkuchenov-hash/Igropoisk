import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/apply-review-supplemental-sources.mjs <game-slug>');
const reviewsPath=path.join(root,'data/reviews',`${slug}.json`);
const supplementalPath=path.join(root,'data/research',`${slug}-supplemental-sources.json`);
if(!fs.existsSync(reviewsPath)||!fs.existsSync(supplementalPath)){
  console.log(JSON.stringify({slug,applied:0,reason:'no_supplemental_pack'},null,2));
  process.exit(0);
}
const reviews=JSON.parse(fs.readFileSync(reviewsPath,'utf8'));
const supplemental=JSON.parse(fs.readFileSync(supplementalPath,'utf8'));
const canonical=value=>String(value||'').trim().replace(/\/$/,'').toLowerCase();
const publication=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'');
const existingUrls=new Set((reviews.reviews||[]).map(item=>canonical(item.url)));
const existingPublications=new Set((reviews.reviews||[]).map(item=>publication(item.publication||item.source)));
let applied=0;
for(const source of supplemental.sources||[]){
  if(!source?.url||!source?.publication)continue;
  const url=canonical(source.url),pub=publication(source.publication);
  if(existingUrls.has(url)||existingPublications.has(pub))continue;
  reviews.reviews=reviews.reviews||[];
  reviews.reviews.push({...source,id:`source-${reviews.reviews.length+1}`});
  existingUrls.add(url);existingPublications.add(pub);applied+=1;
}
reviews.updated_at=new Date().toISOString();
fs.writeFileSync(reviewsPath,`${JSON.stringify(reviews,null,2)}\n`);
console.log(JSON.stringify({slug,applied,total:(reviews.reviews||[]).length},null,2));
