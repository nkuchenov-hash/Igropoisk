#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {migrateRepository} from './lib/game-registry-migration.mjs';
import {projectPublicCatalog} from './lib/system-game-registry-adapter.mjs';

const root=process.cwd();
const catalogPath=path.join(root,'data/catalog-visible.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const {registry}=migrateRepository(root,{dryRun:true,publicBaseUrl:'/game'});
const projected=projectPublicCatalog(catalog,registry);
const unresolved=projected.issues.filter(issue=>issue.status==='unresolved');
if(unresolved.length)throw new Error(`Public catalog contains unresolved Game Registry identities: ${JSON.stringify(unresolved)}`);
let filled=0;
let conflicts=0;
const records=catalog.map((item,index)=>{
  const projectedId=projected.records[index]?.game_id??null;
  const pinned=String(item?.game_id??'').trim();
  if(pinned){
    if(projectedId&&projectedId!==pinned)conflicts++;
    return {...projected.records[index],...item,game_id:pinned};
  }
  if(projectedId)filled++;
  return {...item,...projected.records[index],...(projectedId?{game_id:projectedId}:{})};
});
fs.writeFileSync(catalogPath,JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify({records:records.length,canonical_ids_filled:filled,pinned_ids_preserved:records.filter(item=>item.game_id).length,projection_conflicts_ignored:conflicts,issues:projected.issues.length,registry_source:'fresh_migration',policy:'existing public game_id is authoritative'},null,2));
