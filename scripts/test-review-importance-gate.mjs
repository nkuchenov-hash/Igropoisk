#!/usr/bin/env node
import {classifyReviewImportance} from './lib/review-importance.mjs';

const fail=message=>{throw new Error(message)};
const corpus=(count,{igromania=false,exhaustive=true}={})=>({
  coverage:{independent_publications:count,exhaustive_discovery:exhaustive,passed:count>0||exhaustive},
  sources:[
    ...Array.from({length:count},(_,i)=>({id:`source-${i+1}`,source_role:'professional_review',publication:`Publication ${i+1}`,url:`https://example${i+1}.com/review/game`})),
    ...(igromania?[{id:'igromania',source_role:'professional_review',publication:'Игромания',url:'https://www.igromania.ru/review/12345/game.html'}]:[])
  ]
});

let result=classifyReviewImportance({corpus:corpus(1,{igromania:true,exhaustive:false}),threshold:8});
if(result.status!=='required'||result.reason!=='igromania_full_review_found')fail('Игромания review must require a full Игропоиск review');

result=classifyReviewImportance({corpus:corpus(8,{exhaustive:false}),threshold:8});
if(result.status!=='required'||result.independent<8)fail('Eight independent professional reviews must require a full Игропоиск review');

result=classifyReviewImportance({corpus:corpus(7,{exhaustive:true}),threshold:8});
if(result.status!=='not_required'||result.required!==false)fail('Seven reviews after exhaustive discovery must not force a full review');

result=classifyReviewImportance({corpus:corpus(7,{exhaustive:false}),threshold:8});
if(result.status!=='pending')fail('Below-threshold non-exhaustive discovery must remain pending');

result=classifyReviewImportance({corpus:corpus(0,{exhaustive:true}),force:true,threshold:8});
if(result.status!=='required'||result.reason!=='explicit_force_override')fail('Explicit force_full_review must override automatic importance selection');

console.log('Review importance gate passed: Игромания first, >=8 independent reviews second, exhaustive below-threshold coverage means no full review, unresolved search stays pending, and only force_full_review is a manual override.');
