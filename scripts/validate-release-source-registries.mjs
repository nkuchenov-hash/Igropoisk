#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadPublicationSourceRegistry, publicationRegistryStats } from './lib/publication-source-registry.mjs';
import { loadOfficialSourceRegistry, validateOfficialSourceRegistryWiring } from './lib/official-source-registry.mjs';

const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const errors=[];
const releaseConfig=read('config/parsers/releases.json');
const mediaPolicy=read('config/release-media-sources.json');
const reviewConfig=read('config/parsers/review-synthesis.json');
const gameData=read('config/parsers/game-data.json');
const gameRegistry=read('config/game-registry.json');

const publicationPath=releaseConfig.publication_source_registry;
const officialPath=releaseConfig.official_source_registry;
if(!publicationPath)errors.push('releases.json must configure publication_source_registry');
if(!officialPath)errors.push('releases.json must configure official_source_registry');
if(reviewConfig.source_registry!==publicationPath)errors.push('reviews and releases must use the same Publication Registry');
if(mediaPolicy.source_registry!==publicationPath)errors.push('release-media-sources.json must point to the shared Publication Registry');
if(Array.isArray(mediaPolicy.sources)&&mediaPolicy.sources.length)errors.push('release-media-sources.json must not duplicate publication source records');
if(gameData.publication_source_registry!==publicationPath)errors.push('game-data parser must use the shared Publication Registry');
if(gameData.official_source_registry!==officialPath)errors.push('game-data parser must use the shared Official Source Registry');
if(gameRegistry.sourceRegistries?.publications!==publicationPath)errors.push('Game Registry must reference Publication Registry');
if(gameRegistry.sourceRegistries?.official!==officialPath)errors.push('Game Registry must reference Official Source Registry');
if(gameRegistry.sourceRegistries?.required!==true)errors.push('Game Registry source registries must be required');

let publicationRegistry={sources:[]},officialRegistry={sources:[]};
try{publicationRegistry=loadPublicationSourceRegistry(publicationPath)}catch(error){errors.push(error.message)}
try{officialRegistry=loadOfficialSourceRegistry(officialPath)}catch(error){errors.push(error.message)}

const publicationStats=publicationRegistryStats(publicationRegistry);
const requiredCalendars=['pc-gamer','gamespot','game-informer','vgc','gamepressure','igromania','stopgame','vgtimes','gameguru'];
const calendarIds=new Set(publicationStats.calendar_source_ids||[]);
for(const id of requiredCalendars)if(!calendarIds.has(id))errors.push(`Publication Registry missing calendar_discovery source: ${id}`);
if(publicationStats.release_coverage_sources<20)errors.push(`Publication Registry release coverage panel too small: ${publicationStats.release_coverage_sources}`);
if(publicationStats.calendar_discovery_sources<7)errors.push(`Publication Registry needs at least 7 calendar discovery sources, found ${publicationStats.calendar_discovery_sources}`);
const audienceIds=new Set((publicationRegistry.sources||[]).filter(source=>(source.release?.roles||[]).includes('audience_interest')).map(source=>source.id));
if(!audienceIds.has('stopgame'))errors.push('StopGame must expose audience_interest capability');

errors.push(...validateOfficialSourceRegistryWiring({registry:officialRegistry}));
const officialIds=new Set((officialRegistry.sources||[]).map(source=>source.id));
for(const adapter of gameData.sources||[]){
  for(const officialId of [adapter.official_source_id,...(adapter.official_source_ids||[])].filter(Boolean)){
    if(!officialIds.has(officialId))errors.push(`${adapter.id}: unknown official_source_id ${officialId}`);
  }
  if(adapter.publication_source_id&&!publicationRegistry.sources.some(source=>source.id===adapter.publication_source_id))errors.push(`${adapter.id}: unknown publication_source_id ${adapter.publication_source_id}`);
}

if(errors.length){
  console.error(`Release source registry validation failed (${errors.length})`);
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log(JSON.stringify({
  status:'green',
  publication_registry:publicationPath,
  publication_sources:publicationStats.total_sources,
  release_coverage_sources:publicationStats.release_coverage_sources,
  calendar_discovery_sources:publicationStats.calendar_discovery_sources,
  audience_interest_sources:publicationStats.audience_interest_sources,
  official_registry:officialPath,
  official_sources:officialRegistry.sources.length,
  required_calendar_sources:requiredCalendars,
},null,2));
