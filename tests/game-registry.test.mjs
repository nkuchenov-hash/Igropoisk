import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GameRegistryApi, aggregateProfessionalScores, applySafeUpsert, calculatePriority, compareIdentity, createGameEntity,
  createRegistry, createRevision, fieldValue, mergeField, planSafeUpsert, rollbackRevision,
  validateForPublication
} from '../scripts/lib/game-registry.mjs';

const official = {type:'official_site',name:'Official'};
const steam = {type:'platform_store',name:'Steam'};

test('trademark and localized aliases resolve to one game', () => {
  const api = new GameRegistryApi(createRegistry());
  const first = api.registerCandidate({title:'Control™',slug:'control',aliases:['Контроль'],externalIds:{steamAppId:870780},source:steam});
  const second = api.registerCandidate({title:'Контроль',externalIds:{steamAppId:870780},source:official});
  assert.equal(first.decision,'created'); assert.equal(second.decision,'matched');
  assert.equal(Object.keys(api.registry.games).length,1);
});

test('platform records with the same external identity remain one game', () => {
  const api = new GameRegistryApi(createRegistry());
  api.registerCandidate({title:'Example Game',externalIds:{igdbId:42},releases:[{platform:'PC',date:'2026-01-01'}],source:official});
  api.registerCandidate({title:'Example Game',externalIds:{igdbId:42},releases:[{platform:'PlayStation 5',date:'2026-01-02'}],source:{type:'official_platform_store',name:'PlayStation Store'}});
  assert.equal(Object.keys(api.registry.games).length,1);
});

test('remake, remaster and original are not silently merged', () => {
  const original=createGameEntity({title:'Resident Evil 2',kind:'game',source:official});
  assert.equal(compareIdentity(original,{title:'Resident Evil 2 Remake',kind:'remake'}).decision,'none');
  const exactButDifferent=compareIdentity(original,{title:'Resident Evil 2',kind:'remake'});
  assert.equal(exactButDifferent.decision,'ambiguous');
  const remaster=createGameEntity({title:'Resident Evil 2',kind:'remaster',source:official});
  assert.equal(compareIdentity(remaster,{title:'Resident Evil 2',kind:'game'}).decision,'ambiguous');
});

test('DLC is not merged with its base game by generic identity matching', () => {
  const base=createGameEntity({title:'Elden Ring',kind:'game',source:official});
  assert.notEqual(compareIdentity(base,{title:'Elden Ring: Shadow of the Erdtree',kind:'dlc'}).decision,'match');
});

test('edition, remaster, DLC and expansion cannot publish as standalone games by default', () => {
  for (const kind of ['edition','remaster','dlc','expansion']) {
    const entity=createGameEntity({title:`Embedded ${kind}`,kind,source:official,releases:[{date:'2026-01-01'}],media:{cover:'cover.jpg'}});
    entity.fields.description=fieldValue('Description',official,{confidence:1});
    entity.workflow.status='published';
    entity.workflow.pageStatus='published';
    const gate=validateForPublication(entity);
    assert.equal(gate.passed,false,`${kind} must not publish as a separate game`);
    assert.ok(gate.errors.includes('embedded_content_requires_base_game'));
  }
  const remake=createGameEntity({title:'Real Remake',kind:'remake',source:official,releases:[{date:'2026-01-01'}],media:{cover:'cover.jpg'}});
  remake.fields.description=fieldValue('Description',official,{confidence:1});
  assert.equal(validateForPublication(remake).errors.includes('embedded_content_requires_base_game'),false,'A remake may remain a standalone canonical game');
});

test('manual field lock wins over automated enrichment', () => {
  const locked=fieldValue('Manual title',{type:'manual',name:'Editor'},{confidence:1,editorialLock:true});
  const incoming=fieldValue('Parser title',official,{confidence:1});
  assert.equal(mergeField(locked,incoming).value,'Manual title');
});

test('ambiguous exact aliases are routed to review', () => {
  const registry=createRegistry(); const api=new GameRegistryApi(registry);
  api.registerCandidate({title:'Doom',year:1993,kind:'game',source:official});
  api.registerCandidate({title:'Doom',year:2016,kind:'game',source:official});
  const result=api.registerCandidate({title:'DOOM',source:{type:'professional_publication',name:'Magazine'}});
  assert.equal(result.decision,'needs_review'); assert.equal(api.registry.reviewQueue.length,1);
});

test('empty and partial safe upserts never delete unrelated games', () => {
  const existing=createRegistry(); const api=new GameRegistryApi(existing);
  const a=api.registerCandidate({title:'A',source:official}).entity;
  const b=api.registerCandidate({title:'B',source:official}).entity;
  const empty=applySafeUpsert(api.registry,createRegistry());
  assert.equal(Object.keys(empty.games).length,2);
  const partial=createRegistry({games:{[a.id]:{...a,updatedAt:'later'}}});
  const merged=applySafeUpsert(api.registry,partial);
  assert.ok(merged.games[b.id]);
  assert.deepEqual(planSafeUpsert(api.registry,createRegistry()).deletions,[]);
});

test('publication gate blocks incomplete pages', () => {
  const entity=createGameEntity({title:'Incomplete',source:official});
  const result=validateForPublication(entity);
  assert.equal(result.passed,false); assert.ok(result.errors.includes('description'));
});

test('publication gate accepts confirmed complete data', () => {
  const entity=createGameEntity({title:'Ready Game',source:official,releases:[{date:'2026-01-01',platform:'PC'}],media:{cover:'cover.jpg'}});
  entity.fields.description=fieldValue('Description',official,{confidence:1});
  assert.equal(validateForPublication(entity).passed,true);
});

test('priority signals are explainable', () => {
  const entity=createGameEntity({title:'Priority',source:official});
  const priority=calculatePriority(entity,{igropoiskNewsMentions:1,daysUntilRelease:20,explicitRequest:true,professionalReviewCount:5});
  assert.ok(priority.score>50); assert.ok(priority.reasons.some(item=>item.signal==='explicitRequest'));
});

test('specific revision can be rolled back', () => {
  const entity=createGameEntity({title:'Before',source:official});
  const revision=createRevision(entity,{reason:'before edit'});
  entity.identity.canonicalTitle.value='After';
  rollbackRevision(entity,revision.id);
  assert.equal(entity.identity.canonicalTitle.value,'Before');
});

test('manual merge can be undone', () => {
  const api=new GameRegistryApi(createRegistry());
  const source=api.registerCandidate({title:'Alias Game',externalIds:{steamAppId:1},source:steam}).entity;
  const target=api.registerCandidate({title:'Canonical Game',externalIds:{igdbId:2},source:official}).entity;
  api.mergeGames(source.id,target.id,{actor:'editor'});
  assert.equal(source.workflow.status,'merged_into_another_game');
  api.undoMerge(source.id,{actor:'editor'});
  assert.equal(source.workflow.status,'needs_review');
});

test('professional score aggregation normalizes scales and excludes user or sponsored scores', () => {
  const result=aggregateProfessionalScores([
    {source:'A',score:8,scale:10,professional:true},
    {source:'B',score:90,scale:100,professional:true,weight:2},
    {source:'User',score:10,scale:10,kind:'user'},
    {source:'Ad',score:100,scale:100,sponsored:true}
  ]);
  assert.equal(result.count,2);
  assert.equal(result.score,86.7);
});
