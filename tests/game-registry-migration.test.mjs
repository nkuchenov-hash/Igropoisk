import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateRepository} from '../scripts/lib/game-registry-migration.mjs';
import {buildGamePageSections} from '../scripts/lib/game-registry-page-sections.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ig-game-registry-'));
  const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  write('data/catalog-visible.json',[
    {title:'The Witcher 3™: Wild Hunt',slug:'the-witcher-3-wild-hunt',year:2015},
    {title:'Mafia',slug:'mafia',year:2002},
    {title:'Mafia II',slug:'mafia-ii',year:2010},
    {title:'Mafia III',slug:'mafia-iii',year:2016,steam_appid:360430},
    {title:'Mafia: Definitive Edition',slug:'mafia-definitive-edition',year:2020},
    {title:'Mafia II: Definitive Edition',slug:'mafia-ii-definitive-edition',year:2020,platforms:['PC','PS4']},
    {title:'Mafia III: Definitive Edition',slug:'mafia-iii-definitive-edition',year:2020,steam_appid:360430},
    {title:'Mafia: The Old Country',slug:'mafia-the-old-country',year:2025}
  ]);
  write('data/game-series.json',{schema_version:1,series:[{id:'mafia',title:'Mafia',members:[
    {slug:'mafia',order:1},{slug:'mafia-ii',order:2},{slug:'mafia-iii',order:3},
    {slug:'mafia-definitive-edition',order:4,relation:'remake'},{slug:'mafia-the-old-country',order:5}
  ]}]});
  write('data/content-pipeline/registry.json',{items:[
    {title:'The Witcher 3: Wild Hunt',slug:'the-witcher-3-wild-hunt',state:'collecting'},
    {title:'Unknown',slug:'unknown',state:'discovered'}
  ]});
  write('data/game-content/2002-2020.json',{games:{
    'the-witcher-3-wild-hunt':{identity:{title:'The Witcher 3: Wild Hunt',steam_appid:292030},companies:{developers:['CD PROJEKT RED'],publishers:['CD PROJEKT']},classification:{genres:['RPG'],platforms:['PC']},editorial:{integrated_description:'Description'},release:{date:'2015-05-19'},media:{cover:'cover.jpg'},publication:{status:'published'}},
    'mafia-definitive-edition':{identity:{title:'Mafia: Definitive Edition',steam_appid:1030840},companies:{developers:['Hangar 13'],publishers:['2K']},classification:{genres:['Action'],platforms:['PC']},editorial:{integrated_description:'Full remake of the original game'},release:{date:'2020-09-25'},media:{cover:'mafia.jpg'}},
    'mafia-iii':{identity:{title:'Mafia III',steam_appid:360430},companies:{developers:['Hangar 13'],publishers:['2K']},classification:{genres:['Action'],platforms:['PC']},editorial:{integrated_description:'Base game'},release:{date_text:'2016'},media:{cover:'mafia3.jpg'}},
    'mafia-iii-definitive-edition':{identity:{title:'Mafia III: Definitive Edition',steam_appid:360430},companies:{developers:['Hangar 13'],publishers:['2K']},classification:{genres:['Action'],platforms:['PC']},editorial:{integrated_description:'Complete edition with additional content'},release:{date_text:'2020'},media:{cover:'mafia3de.jpg'}}
  }});
  write('game/the-witcher-3-wild-hunt/index.html','<script src="../_shared/index.js"></script>');
  write('game/_shared/index.js','export default {}');
  write('data/articles/the-witcher-3-wild-hunt.json',{slug:'the-witcher-3-wild-hunt',title:'Review',status:'published'});
  write('data/articles/mafia-iii-definitive-edition.json',{slug:'mafia-iii-definitive-edition',title:'Definitive Edition review',status:'published',url:'/article/mafia-iii-definitive-edition/'});
  return root;
}

test('migration is idempotent, preserves real remakes and embeds editions',()=>{
  const root=fixture();
  const a=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  const b=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  assert.equal(a.report.sourceFingerprint,b.report.sourceFingerprint);
  assert.equal(a.report.canonicalGames,b.report.canonicalGames);
  const active=Object.values(a.registry.games).filter(game=>game.workflow.status!=='merged_into_another_game');
  const slugs=active.map(game=>game.identity.slug.value);
  assert.ok(slugs.includes('mafia'));
  assert.ok(slugs.includes('mafia-definitive-edition'));
  assert.notEqual(a.registry.indexes.slug.mafia,a.registry.indexes.slug['mafia-definitive-edition'],'A true remake remains a separate game');
  assert.equal(active.some(game=>['edition','remaster','dlc','expansion'].includes(game.identity.kind.value)),false,'Embedded content kinds must never be standalone canonical games');

  const mafiaIII=a.registry.games[a.registry.indexes.slug['mafia-iii']];
  assert.ok(mafiaIII,'Base Mafia III must exist');
  const edition=(mafiaIII.variants||[]).find(item=>item.slug==='mafia-iii-definitive-edition');
  assert.ok(edition,'Definitive Edition must be embedded under Mafia III');
  assert.equal(edition.schemaVersion,'game-variant/v1');
  assert.equal(edition.baseGameId,mafiaIII.id);
  assert.equal(edition.pagePolicy,'embedded');
  assert.deepEqual(edition.platforms,['PC']);
  assert.ok(edition.releases.some(release=>String(release.date).includes('2020')),'Edition-specific release data stays on the child entity');
  assert.equal(edition.articles.length,1,'Edition-specific article must stay on the edition/DLC section');
  assert.equal(mafiaIII.articles.some(article=>article.title==='Definitive Edition review'),false,'Edition article must not leak into the main review section');
  assert.equal(active.some(game=>game.identity.slug.value==='mafia-iii-definitive-edition'),false,'Edition must not be a separate active game');

  const mafiaII=a.registry.games[a.registry.indexes.slug['mafia-ii']];
  const mafiaIIEdition=(mafiaII.variants||[]).find(item=>item.slug==='mafia-ii-definitive-edition');
  assert.ok(mafiaIIEdition,'Unambiguous Definitive Edition title must attach to its base game even without a shared external ID');
  assert.deepEqual(mafiaIIEdition.platforms,['PC','PS4']);
  assert.equal(active.some(game=>game.identity.slug.value==='mafia-ii-definitive-edition'),false);

  const sections=buildGamePageSections(a.registry,{root});
  const mafiaIIISection=sections.games['mafia-iii'];
  const editionSection=mafiaIIISection.variants.find(item=>item.slug==='mafia-iii-definitive-edition');
  assert.equal(sections.schema_version,3);
  assert.equal(editionSection.schema_version,'game-variant/v1');
  assert.equal(editionSection.base_game_id,mafiaIII.id);
  assert.deepEqual(editionSection.platforms,['PC']);
  assert.equal(sections.redirects['mafia-iii-definitive-edition'].target_slug,'mafia-iii');
  assert.equal(sections.redirects['mafia-iii-definitive-edition'].target_hash,'editions');
  const mafiaSeries=mafiaIIISection.series;
  assert.equal(mafiaSeries.series_id,'mafia');
  assert.deepEqual(mafiaSeries.members.map(item=>item.slug),['mafia','mafia-ii','mafia-iii','mafia-definitive-edition','mafia-the-old-country']);
  assert.equal(mafiaSeries.members.some(item=>item.slug==='mafia-iii-definitive-edition'),false,'Embedded editions must not appear as games in the franchise navigation');
  assert.equal(mafiaSeries.members.find(item=>item.slug==='mafia-iii').current,true);
});

test('existing page is retained and shared runtime is not modified',()=>{
  const root=fixture(); const shared=fs.readFileSync(path.join(root,'game/_shared/index.js'),'utf8');
  const result=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  assert.ok(result.report.publishedPages>=1);
  assert.equal(fs.readFileSync(path.join(root,'game/_shared/index.js'),'utf8'),shared);
  assert.ok(fs.existsSync(path.join(root,'game/the-witcher-3-wild-hunt/index.html')));
});

test('base article is linked to canonical game',()=>{
  const root=fixture(); const result=migrateRepository(root,{now:'2026-08-06T00:00:00.000Z'});
  const game=result.registry.games[result.registry.indexes.slug['the-witcher-3-wild-hunt']];
  assert.equal(game.articles.length,1); assert.equal(game.articles[0].type,'igropoisk_review');
});