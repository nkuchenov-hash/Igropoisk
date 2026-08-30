import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug) throw new Error('Usage: node scripts/validate-pre-review-materials.mjs <slug>');
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const config=read('config/game-page-quality-v2.json',{});
const matrix=read(`data/research/${slug}-source-matrix.json`,{});
const reviews=read(`data/reviews/${slug}.json`,{});
const ratings=read(`data/ratings/${slug}.json`,{});
const draft=read(`data/drafts/${slug}.json`,{});
const reviewMinimum=Number(config.review_corpus?.minimum_sources||10);
const ratingMinimum=Number(config.rating?.minimum_sources||10);
const accepted=Array.isArray(matrix.accepted)?matrix.accepted:Array.isArray(reviews.reviews)?reviews.reviews:[];
const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const publications=new Set(accepted.map(item=>normalized(item.publication||item.source)).filter(Boolean));
const scored=Array.isArray(ratings.sources)?ratings.sources:[];
const forbiddenHosts=new Set(['metacritic.com','opencritic.com','reddit.com','steamcommunity.com','store.steampowered.com']);
const problems=[];
if(matrix.source_registry_scan?.complete!==true) problems.push('source registry scan is incomplete');
if(Number(matrix.coverage?.accepted_readable_articles??accepted.length)<reviewMinimum) problems.push(`professional reviews ${accepted.length}/${reviewMinimum}`);
if(publications.size<reviewMinimum) problems.push(`independent publications ${publications.size}/${reviewMinimum}`);
if(scored.length<ratingMinimum) problems.push(`professional score sources ${scored.length}/${ratingMinimum}`);
if(ratings.status!=='green'||ratings.calculation?.score_10==null) problems.push('aggregate professional rating is not green/calculated');
for(const item of accepted){
  const url=String(item.resolved_url||item.url||'');
  if(!/^https?:\/\//i.test(url)){problems.push(`review without direct URL: ${item.publication||item.title||'unknown'}`);continue}
  try{const host=new URL(url).hostname.replace(/^www\./,'').toLowerCase();if([...forbiddenHosts].some(domain=>host===domain||host.endsWith(`.${domain}`)))problems.push(`forbidden direct review host: ${host}`)}catch{problems.push(`invalid review URL: ${url}`)}
}
const title=normalized(draft.identity?.title||slug);
const numeric=title.split(' ').filter(token=>/^\d+$/.test(token));
if(numeric.length===0){
  const short=normalized((draft.identity?.aliases||[])[0]||title.split(' ')[0]||slug);
  if(short&&short.split(' ').length<=4){
    const escaped=short.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
    const sequel=new RegExp(`\\b${escaped}\\s+(?:[2-9]\\d*|ii|iii|iv|v|vi|vii|viii|ix|x)\\b`,'i');
    for(const item of accepted){const hay=normalized(`${item.title||''} ${item.url||''}`);if(sequel.test(hay))problems.push(`wrong numbered sequel accepted: ${item.url||item.title}`)}
  }
}
const result={slug,review_minimum:reviewMinimum,accepted_reviews:accepted.length,independent_publications:publications.size,rating_minimum:ratingMinimum,scored_publications:scored.length,score_10:ratings.calculation?.score_10??null,status:problems.length?'red-needs-revision':'green',problems};
console.log(JSON.stringify(result,null,2));
if(problems.length) process.exit(1);
