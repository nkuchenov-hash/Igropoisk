import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateRepository} from '../scripts/lib/game-registry-migration.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ig-game-registry-'));
  const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  write('data/catalog-visible.json',[{title:'The Witcher 3™: Wild Hunt',slug:'the-witcher-3-wild-hunt',year:2015},{title:'Mafia',slug:'mafia',year:2002},{title:'Mafia: Definitive Edition',slug:'mafia-definitive-edition',year:2020}]);
  write('data/content-pipeline/registry.json',{items:[{title:'The Witcher 3: Wild Hunt',slug:'the-witcher-3-wild-hunt',state:'collecting'},{title:'Unknown',slug:'unknown',state:'discovered'}]});
  write('data/game-content/2002-2020.json',{games:{'the-witcher-3-wild-hunt':{identity:{title:'The Witcher 3: Wild Hunt',steam_appid:292030},companies:{developers:['CD PROJEKT RED'],publishers:['CD PROJEKT']},classification:{genres:['RPG'],platforms:['PC']},editorial:{integrated_description:'Description'},release:{date:'2015-05-19'},media:{cover:'cover.jpg'},publication:{status:'published'}},'mafia-definitive-edition':{identity:{title:'Mafia: Definitive Edition'},companies:{developers:['Hangar 13'],publishers:['2K']},classification:{genres:['Action'],platforms:['PC']},editorial:{integrated_description:'Remake'},release:{date:'2020-09-25'},media:{cover:'mafia.jpg'}}}});
  write('game/the-witcher-3-wild-hunt/index.html','<script src="../_shared/index.js"></script>');
  write('game/_shared/index.js','export default {}');
  write('data/articles/the-witcher-3-wild-hunt.json',{slug:'the-witcher-3-wild-hunt',title:'Review',status:'published'});
  return root;
}

test('migration is idempotent and preserves original/remake distinction',()=>{
  const root=fixture();
  const a=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  const b=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  assert.equal(a.report.sourceFingerprint,b.report.sourceFingerprint);
  assert.equal(a.report.canonicalGames,b.report.canonicalGames);
  const slugs=Object.values(a.registry.games).map(game=>game.identity.slug.value);
  assert.ok(slugs.includes('mafia')); assert.ok(slugs.includes('mafia-definitive-edition'));
  assert.notEqual(a.registry.indexes.slug.mafia,a.registry.indexes.slug['mafia-definitive-edition']);
});

test('existing page is retained and shared runtime is not modified',()=>{
  const root=fixture(); const shared=fs.readFileSync(path.join(root,'game/_shared/index.js'),'utf8');
  const result=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  assert.ok(result.report.publishedPages>=1);
  assert.equal(fs.readFileSync(path.join(root,'game/_shared/index.js'),'utf8'),shared);
  assert.ok(fs.existsSync(path.join(root,'game/the-witcher-3-wild-hunt/index.html')));
});

test('article is linked to canonical game',()=>{
  const root=fixture(); const result=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  const game=result.registry.games[result.registry.indexes.slug['the-witcher-3-wild-hunt']];
  assert.equal(game.articles.length,1); assert.equal(game.articles[0].type,'igropoisk_review');
});
