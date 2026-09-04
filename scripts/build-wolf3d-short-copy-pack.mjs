#!/usr/bin/env node
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const file='benchmarks/editorial-five-games/games.json';
const original=fs.readFileSync(file,'utf8');
const data=JSON.parse(original);
const game={slug:'wolfenstein-3d-1992',display_title:'Wolfenstein 3D',identity_title:'Wolfenstein 3D',year:1992,release_date:'1992-05-05',steam_appid:2270,aliases:['Wolfenstein 3D','Wolfenstein 3D 1992'],excluded_versions:['Spear of Destiny','Return to Castle Wolfenstein','Wolfenstein 2009','Wolfenstein: The New Order','Wolfenstein: The Old Blood','Wolfenstein II: The New Colossus'],review_seeds:[]};
if(!data.games.some(x=>x.slug===game.slug))data.games.push(game);
try{
  fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
  const r=spawnSync(process.execPath,['scripts/build-editorial-benchmark-pack.mjs',game.slug],{stdio:'inherit',encoding:'utf8'});
  if(r.status!==0)process.exitCode=r.status||1;
}finally{fs.writeFileSync(file,original)}
