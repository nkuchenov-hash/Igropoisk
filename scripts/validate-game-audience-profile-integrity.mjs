#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),errors=[];
const read=relative=>{try{return fs.readFileSync(path.join(root,relative),'utf8')}catch{return''}};
const requireFile=relative=>{if(!read(relative))errors.push(`missing ${relative}`)};
const requireTokens=(relative,tokens)=>{const text=read(relative);if(!text){errors.push(`missing ${relative}`);return}for(const token of tokens)if(!text.includes(token))errors.push(`${relative} lost ${JSON.stringify(token)}`)};
for(const file of ['scripts/collect-game-audience-evidence.mjs','scripts/build-game-audience-profile.mjs','scripts/lib/game-audience-profile.mjs','scripts/lib/igropoisk-editorial-style.mjs','scripts/test-game-audience-profile.mjs','docs/IGROPOISK_AUDIENCE_PROFILE.md','docs/IGROPOISK_EDITORIAL_STYLE.md'])requireFile(file);
requireTokens('scripts/collect-game-audience-evidence.mjs',['steam-store-popular-tags','review_signals','aggregate_demographics','fail_open:true','public_render_allowed:false','audience-demographics.json']);
requireTokens('scripts/lib/game-audience-profile.mjs',['stereotype_demographics_forbidden:true','aggregate_demographics','neutralAudienceProfile','ai_required:false','fail_open:true','public_render_allowed:false']);
requireTokens('scripts/lib/igropoisk-editorial-style.mjs',['collect-game-audience-evidence.mjs','build-game-audience-profile.mjs','game-audience','Полноценный audience profile недоступен: используй нейтральный регистр Игропоиска']);
requireTokens('scripts/build-game-page.mjs',['buildEditorialAudienceContext','internal_audience_profile','audience_profile_confidence']);
requireTokens('docs/IGROPOISK_AUDIENCE_PROFILE.md',['Visibility:** NEVER rendered','Missing audience data must never block page publication','Changing the model must not change the intended audience voice']);
const test=spawnSync(process.execPath,['scripts/test-game-audience-profile.mjs'],{cwd:root,encoding:'utf8',stdio:'pipe'});if(test.status!==0)errors.push(`audience profile tests failed: ${(test.stderr||test.stdout||'').slice(-2000)}`);
const result={schema_version:1,module:'game-audience-profile',status:errors.length?'red':'green',checked_at:new Date().toISOString(),fail_open_contract:true,internal_only_contract:true,errors,test_output:(test.stdout||'').trim().slice(-3000)};
console.log(JSON.stringify(result,null,2));if(errors.length)process.exit(1);
