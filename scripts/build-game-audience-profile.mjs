#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {buildGameAudienceProfile,neutralAudienceProfile,validateAudienceProfile} from './lib/game-audience-profile.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-audience-profile.mjs <slug>');
const read=(relative,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const output=`data/game-audience/${slug}.json`,runOutput=`data/parser-runs/game-audience-${slug}.json`;
let profile,status='built',reason=null;
try{
  profile=buildGameAudienceProfile({slug,draft:read(`data/drafts/${slug}.json`),parser:read(`data/parser-output/${slug}.json`),corpus:read(`data/game-sources/${slug}.json`),reviews:read(`data/reviews/${slug}.json`),knowledge:read(`data/game-knowledge/${slug}.json`),audienceEvidence:read(`data/research/${slug}-audience-evidence.json`)});
  const errors=validateAudienceProfile(profile);if(errors.length)throw new Error(errors.join('; '));
}catch(error){status='neutral-fallback';reason=String(error?.message||error);profile=neutralAudienceProfile(slug,reason)}
write(output,profile);
write(runOutput,{parser:'game-audience-profile',status,game_slug:slug,checked_at:new Date().toISOString(),confidence:profile.confidence,source_families:profile.generation?.source_families||0,ai_required:false,fail_open:true,public_render_allowed:false,output,reason});
console.log(JSON.stringify({slug,status,confidence:profile.confidence,reader_familiarity:profile.reader_familiarity,jargon_level:profile.jargon_level,register:profile.register,core_appeals:profile.core_appeals,evidence:profile.evidence.length,public_render_allowed:false},null,2));
