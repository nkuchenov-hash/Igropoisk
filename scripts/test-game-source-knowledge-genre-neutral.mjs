#!/usr/bin/env node
import fs from 'node:fs';
const text=fs.readFileSync('scripts/build-game-source-knowledge.mjs','utf8');
const required=['puzzle','inventory','dialog','investigat','point[- ]and[- ]click','structured_fact_source:\'facts\'','professional_review:\'review\'','raw.role,raw.type'];
const missing=required.filter(token=>!text.includes(token));
if(missing.length)throw new Error(`Genre-neutral source knowledge regression: missing ${missing.join(', ')}`);
if(!text.includes("['facts','description','dna','review']"))throw new Error('Canonical semantic roles gate missing');
console.log(JSON.stringify({status:'green',contract:'genre-neutral-role-compatible-v1',checks:required.length+1}));
