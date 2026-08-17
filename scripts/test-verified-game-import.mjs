#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRegistry,GameRegistryApi} from './lib/game-registry.mjs';
import {registerVerifiedGameImports} from './lib/verified-game-import.mjs';

const official={type:'official_platform_store',name:'Store',url:'https://store.example/game'};
const released={platform:'PC',date:'2020',precision:'year',status:'released'};
const future={platform:'PC',date:null,precision:'unknown',status:'announced'};
const parserSeed={identity:{title:'Console Game'},release:{date_text:'2004'},companies:{developers:['Studio'],publishers:['Publisher']},classification:{genres:['Action'],categories:[],platforms:['PlayStation 2']},editorial:{short_description:'Verified description',features:['Single-player']},media:{cover:'https://media.example/cover.jpg',hero:'https://media.example/hero.jpg',screenshots:['https://media.example/1.jpg','https://media.example/2.jpg','https://media.example/3.jpg','https://media.example/4.jpg','https://media.example/5.jpg','https://media.example/6.jpg']},links:{official:'https://game.example'}};

{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'steam-game',identity_verified:true,title:'Steam Game',slug:'steam-game',steam_appid:123,releases:[released],verification_sources:[official]}]);
  assert.equal(result.created,1);assert.equal(result.resolved.length,1);assert.equal(result.issues.length,0);assert.equal(result.resolved[0].steam_appid,123);
}
{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'future-page',identity_verified:true,title:'Future Game',slug:'future-game',publication_intent:'full_page',releases:[future],verification_sources:[official]}]);
  assert.equal(result.resolved.length,0);assert.equal(result.issues[0]?.reason,'full_page_import_requires_released_game');
}
{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'future-registry',identity_verified:true,title:'Future Game',slug:'future-game',publication_intent:'registry_only',releases:[future],verification_sources:[official]}]);
  assert.equal(result.created,1);assert.equal(result.resolved[0]?.publication_intent,'registry_only');
}
{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'console-missing-seed',identity_verified:true,title:'Console Game',slug:'console-game',releases:[released],verification_sources:[official]}]);
  assert.equal(result.resolved.length,0);assert.equal(result.issues[0]?.reason,'non_steam_full_page_import_requires_verified_parser_seed');
}
{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'console-game',identity_verified:true,title:'Console Game',slug:'console-game',releases:[released],parser_seed:parserSeed,verification_sources:[{type:'professional_publication',name:'Publication A',url:'https://a.example/review'},{type:'professional_publication',name:'Publication B',url:'https://b.example/review'}]}]);
  assert.equal(result.created,1);assert.equal(result.resolved.length,1);assert.ok(result.resolved[0].parser_seed);
}
{
  const result=registerVerifiedGameImports(createRegistry(),[{import_id:'weak-game',identity_verified:true,title:'Weak Game',slug:'weak-game',steam_appid:456,releases:[released],verification_sources:[{type:'professional_publication',name:'Only One',url:'https://one.example/review'}]}]);
  assert.equal(result.resolved.length,0);assert.equal(result.issues[0]?.reason,'import_requires_official_or_two_independent_verification_sources');
}

if(fs.existsSync('data/game-import-requests.json')){
  const queue=JSON.parse(fs.readFileSync('data/game-import-requests.json','utf8'));
  const requests=Array.isArray(queue?.imports)?queue.imports:[];
  const registry=fs.existsSync('data/game-registry/registry.transition.json')?JSON.parse(fs.readFileSync('data/game-registry/registry.transition.json','utf8')):createRegistry();
  const before=new GameRegistryApi(structuredClone(registry));
  const preexisting=new Set(requests.filter(request=>before.findBySlug(String(request?.slug||''))).map(request=>String(request?.import_id||request?.slug||'')));
  const result=registerVerifiedGameImports(registry,requests);
  assert.equal(result.issues.length,0,`queued verified imports must resolve without issues: ${JSON.stringify(result.issues)}`);
  assert.equal(result.resolved.length,requests.length,'every queued verified import must resolve');
  assert.equal(new Set(result.resolved.map(item=>item.game_id)).size,requests.length,'queued verified imports must resolve to distinct canonical games');
  for(const importId of preexisting){
    const resolved=result.resolved.find(item=>item.import_id===importId);
    assert.ok(resolved,`pre-existing queued import ${importId} must resolve`);
    assert.notEqual(resolved.decision,'created',`pre-existing queued import ${importId} must reuse its canonical Registry entity`);
  }
}
console.log('Verified game import contract passed.');
