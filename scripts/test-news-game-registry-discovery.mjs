import assert from 'node:assert/strict';
import { createRegistry } from './lib/game-registry.mjs';
import { decodeNewsGameRequests, registerNewsGameCandidates } from './lib/news-game-registry-discovery.mjs';
import { registerVerifiedGameImports } from './lib/verified-game-import.mjs';

const request={news_id:'news-1',game_id:'news_game_external_1',title:'Crimson Moon',slug:'crimson-moon',confidence:0.93,verified_external:true,identity_verified:true,verification_sources:[{type:'official',url:'https://example.com/crimson-moon'},{type:'database',url:'https://example.com/db/crimson-moon'}],source_url:'https://example.com/news/crimson-moon'};
const encoded=Buffer.from(JSON.stringify([request]),'utf8').toString('base64');assert.deepEqual(decodeNewsGameRequests(encoded),[request]);
const first=registerNewsGameCandidates(createRegistry(),[request]);assert.equal(first.created,1);assert.equal(first.matched,0);assert.equal(first.issues.length,0);assert.equal(first.resolved.length,1);assert.match(first.resolved[0].game_id,/^game_/);assert.notEqual(first.resolved[0].game_id,request.game_id);assert.equal(first.resolved[0].slug,'crimson-moon');assert.equal(first.resolved[0].identity_verified,true);
const second=registerNewsGameCandidates(first.registry,[{...request,news_id:'news-2',game_id:'news_game_external_2'}]);assert.equal(second.created,0);assert.equal(second.matched,1);assert.equal(second.resolved[0].game_id,first.resolved[0].game_id);
const falsePositive=registerNewsGameCandidates(first.registry,[{news_id:'news-bad',game_id:'news_game_bad',title:'AOC',slug:'aoc',confidence:0.94,verified_external:false,identity_verified:false}]);assert.equal(falsePositive.created,0);assert.equal(falsePositive.resolved.length,0);assert.equal(falsePositive.issues[0]?.reason,'news_candidate_identity_not_verified');

const consoleGame={import_id:'console-2004',identity_verified:true,title:'Console Wasteland',slug:'console-wasteland',series:'Test',releases:[{platform:'PlayStation 2',date:'2004',precision:'year',status:'released'}],verification_sources:[{type:'official_site',name:'Official',url:'https://example.com/console-wasteland'}]};
const manual=registerVerifiedGameImports(createRegistry(),[consoleGame]);assert.equal(manual.created,1);assert.equal(manual.issues.length,0);assert.equal(manual.resolved[0].steam_appid,null);
const repeated=registerVerifiedGameImports(manual.registry,[{...consoleGame,import_id:'console-2004-repeat'}]);assert.equal(repeated.created,0);assert.equal(repeated.matched,1);assert.equal(repeated.resolved[0].game_id,manual.resolved[0].game_id);
console.log('Verified news and generic game import tests passed.');
