import fs from 'node:fs';
import path from 'node:path';
import {
  popularCanonicalKey,
  releaseCanonicalKey
} from './home-feeds-quality-lib.mjs';

const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const errors=[];
const config=read('config/home-feeds-quality.json');
const popular=read('data/popular/current.json');
const releases=read('data/releases/current.json');
const health=read('data/home-feeds-health.json');
const runtime=fs.readFileSync(path.join(root,'assets/home-releases/index.js'),'utf8');
const adminHtml=fs.readFileSync(path.join(root,'admin/home-feeds-health/index.html'),'utf8');
const adminJs=fs.readFileSync(path.join(root,'assets/home-feeds-health-admin.js'),'utf8');

if(Number(config.schema_version)!==1)errors.push('Home feeds quality config must use schema version 1.');
if(Number(config.popular?.stale_after_hours)!==12)errors.push('Popular stale threshold must be exactly 12 hours.');
if(Number(config.popular?.required_cards)!==20)errors.push('Popular quality gate must require exactly 20 cards.');
if(Number(config.releases?.minimum_home_cards)<6)errors.push('Release quality gate must require at least six home cards.');
if(Number(config.releases?.maximum_home_cards)>12)errors.push('Release quality gate must not publish more than 12 home cards.');
if(!(config.releases?.excluded_title_patterns||[]).length)errors.push('Release technical-product exclusion patterns are missing.');

const popularRows=popular.ranking||[];
const qualityReady=popularRows.some(item=>item.quality);
if(qualityReady){
  if(popularRows.length<20)errors.push(`Quality-filtered popular feed contains ${popularRows.length} cards.`);
  const keys=new Set();
  for(const item of popularRows.slice(0,20)){
    if(item.quality?.eligible!==true)errors.push(`Popular item ${item.slug} is not quality-eligible.`);
    if(item.quality?.current_spike!==true)errors.push(`Popular item ${item.slug} has no current spike.`);
    if(!(item.quality?.reason||'').trim())errors.push(`Popular item ${item.slug} has no ranking explanation.`);
    const key=popularCanonicalKey(item,config.popular);
    if(keys.has(key))errors.push(`Popular edition duplicate: ${item.slug}.`);
    keys.add(key);
    const community=item.quality?.community_families||[];
    if(!community.length)errors.push(`Popular item ${item.slug} is supported only by weak signals.`);
  }
}

const releaseRows=releases.releases||[];
const releaseQualityReady=releaseRows.some(game=>game.home&&typeof game.home.selected==='boolean');
if(releaseQualityReady){
  const selected=releaseRows.filter(game=>game.home?.selected===true);
  const minimum=Number(config.releases.minimum_home_cards);
  const maximum=Number(config.releases.maximum_home_cards);
  if(selected.length<minimum||selected.length>maximum)errors.push(`Home release selection contains ${selected.length}; allowed ${minimum}-${maximum}.`);
  const keys=new Set();
  for(const game of selected){
    if(game.home?.eligible!==true)errors.push(`Selected release ${game.slug} is not eligible.`);
    if(game.home?.exclusion_reason)errors.push(`Selected release ${game.slug} has an exclusion reason.`);
    if(!['recent','soon','upcoming','tbd'].includes(game.home?.category))errors.push(`Selected release ${game.slug} has invalid category.`);
    if(!(game.home?.reason||'').trim())errors.push(`Selected release ${game.slug} has no explanation.`);
    const key=releaseCanonicalKey(game,config.releases);
    if(keys.has(key))errors.push(`Duplicate release selected for home: ${game.slug}.`);
    keys.add(key);
  }
  for(const game of releaseRows.filter(item=>item.home?.duplicate_of)){
    if(game.home.selected)errors.push(`Duplicate release ${game.slug} is selected.`);
  }
}

if(health.status!=='pending'){
  if(!['healthy','degraded','error'].includes(health.status))errors.push(`Invalid home feeds health status: ${health.status}.`);
  if(qualityReady&&Number(health.popular?.selected)!==Math.min(20,popularRows.length))errors.push('Health popular count does not match the feed.');
  if(releaseQualityReady&&Number(health.releases?.selected_home)!==releaseRows.filter(game=>game.home?.selected).length)errors.push('Health release count does not match the feed.');
}
if(health.read_only!==true)errors.push('Home feeds health snapshot must be read-only.');
if(!runtime.includes("row.game.home?.selected===true")||!runtime.includes('qualityReady'))errors.push('Home release runtime does not consume quality selection.');
if(!adminHtml.includes('data-home-feeds-health-admin')||!adminHtml.includes('home-feeds-health-admin.js'))errors.push('Read-only home feeds admin page is not wired.');
if(!adminJs.includes('requireAuth({role:\'admin\'')||!adminJs.includes('data/home-feeds-health.json'))errors.push('Home feeds admin runtime is not admin-only or does not read the health snapshot.');
if(/\b(?:POST|PUT|PATCH|DELETE)\b/.test(adminJs)||/\.style\s*(?:\.|=)/.test(adminJs))errors.push('Home feeds admin runtime must remain read-only and styling-free.');

if(errors.length)throw new Error(`Home feeds quality validation failed:\n${errors.map(error=>`- ${error}`).join('\n')}`);
console.log(JSON.stringify({popular_quality_ready:qualityReady,popular_cards:popularRows.slice(0,20).length,release_quality_ready:releaseQualityReady,release_home_cards:releaseRows.filter(game=>game.home?.selected).length,health_status:health.status},null,2));
