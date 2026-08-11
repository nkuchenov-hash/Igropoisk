#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {projectPublicCatalog} from './lib/system-game-registry-adapter.mjs';

const root=process.cwd();
const registryPath=path.join(root,'data/game-registry/registry.transition.json');
const catalogPath=path.join(root,'data/catalog-visible.json');
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const projected=projectPublicCatalog(catalog,registry);
const unresolved=projected.issues.filter(issue=>issue.status==='unresolved');
if(unresolved.length)throw new Error(`Public catalog contains unresolved Game Registry identities: ${JSON.stringify(unresolved)}`);
let changed=0;
for(let i=0;i<catalog.length;i++)if(catalog[i]?.game_id!==projected.records[i]?.game_id)changed++;
fs.writeFileSync(catalogPath,JSON.stringify(projected.records,null,2)+'\n');
console.log(JSON.stringify({records:projected.records.length,canonical_ids_repaired:changed,issues:projected.issues.length},null,2));
