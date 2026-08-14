import fs from 'node:fs';

const registryPath='config/parsers/review-source-registry.json';
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
for(const [id,index] of [['pc-gamer','https://www.pcgamer.com/sitemap.xml'],['gamesradar','https://www.gamesradar.com/sitemap.xml']]){
  const source=registry.sources.find(item=>item.id===id);
  if(!source?.review)throw new Error(`Missing editorial source ${id}`);
  source.review.sitemap_index=index;
  source.review.sitemap_year_offsets=[0,1];
}
fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');

const discoveryPath='scripts/discover-review-sources-web-v8.mjs';
let discovery=fs.readFileSync(discoveryPath,'utf8');
const importNeedle="import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';";
if(!discovery.includes("review-publisher-sitemap.mjs")){
  discovery=discovery.replace(importNeedle,`${importNeedle}\nimport {publisherSitemapCandidates} from './lib/review-publisher-sitemap.mjs';`);
}
const searchRx=/async function search\(def\)\{[^\n]*\}\n\nconst accepted=/;
const replacement=`async function search(def){
  const source=registry.sources.find(item=>item.id===def.id),domain=(source?.domains||[])[0];
  if(!domain)return{def,reachable:false,items:[]};
  const sitemap=def.sitemap_index&&year?await publisherSitemapCandidates({sourceId:def.id,indexUrl:def.sitemap_index,title,year,yearOffsets:def.sitemap_year_offsets,limit:12}):{reachable:false,items:[]};
  const requests=[];
  for(const query of queryVariants(def,domain)){requests.push(get(\`https://www.bing.com/search?count=12&q=\${encodeURIComponent(query)}\`,SEARCH_TIMEOUT));requests.push(get(\`https://html.duckduckgo.com/html/?q=\${encodeURIComponent(query)}\`,SEARCH_TIMEOUT))}
  const responses=await Promise.all(requests),items=[];
  const add=item=>{const url=canon(item.url);if(!url||items.some(found=>found.url===url))return;items.push({...item,url})};
  for(const item of sitemap.items||[])add({...item,discovery_method:'publisher_sitemap'});
  for(const response of responses)if(response.ok)for(const item of searchResults(response.body))if(host(item.url)===domain||host(item.url).endsWith('.'+domain))add({...item,discovery_method:'external_search'});
  return{def,reachable:Boolean(sitemap.reachable)||responses.some(response=>response.ok),items:items.slice(0,16)};
}

const accepted=`;
if(!searchRx.test(discovery))throw new Error('Unable to locate v8 search function');
discovery=discovery.replace(searchRx,replacement);
fs.writeFileSync(discoveryPath,discovery);

const workflowPath='.github/workflows/review-score-contract.yml';
let workflow=fs.readFileSync(workflowPath,'utf8');
const pathNeedle="      - 'scripts/lib/review-score-extractor.mjs'";
if(!workflow.includes("scripts/lib/review-publisher-sitemap.mjs'")){
  workflow=workflow.replaceAll(pathNeedle,`${pathNeedle}\n      - 'scripts/lib/review-publisher-sitemap.mjs'\n      - 'scripts/test-review-publisher-sitemap.mjs'`);
}
const checkNeedle='          node --check scripts/lib/review-score-extractor.mjs';
if(!workflow.includes('node --check scripts/lib/review-publisher-sitemap.mjs')){
  workflow=workflow.replace(checkNeedle,`${checkNeedle}\n          node --check scripts/lib/review-publisher-sitemap.mjs\n          node --check scripts/test-review-publisher-sitemap.mjs`);
}
const testNeedle='      - name: Validate unified source registry';
if(!workflow.includes('Validate publisher sitemap discovery')){
  workflow=workflow.replace(testNeedle,`      - name: Validate publisher sitemap discovery\n        run: node scripts/test-review-publisher-sitemap.mjs\n${testNeedle}`);
}
fs.writeFileSync(workflowPath,workflow);
