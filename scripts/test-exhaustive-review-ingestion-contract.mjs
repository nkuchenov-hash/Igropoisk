#!/usr/bin/env node
import fs from 'node:fs';

const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const contract=read('config/review-commercial-contract.json');
const registry=read('config/parsers/review-source-registry.json');
const policy=contract.source_corpus||{};
const enabled=(registry.sources||[]).filter(source=>source?.enabled!==false&&source?.review!==false);
const target=Number(policy.target_independent_full_reviews||0);
const candidateTarget=Number(policy.candidate_target||0);
const failures=[];
const assert=(condition,message)=>{if(!condition)failures.push(message)};

assert(policy.collect_all_discovered_independent_full_reviews===true,'all discovered independent professional reviews must be collected');
assert(policy.full_text_download_required_before_article_acceptance===true,'full text download must precede article-corpus acceptance');
assert(policy.must_check_every_enabled_registered_review_source===true,'every enabled registered review source must be checked');
assert(policy.must_follow_critic_indexes_to_originals===true,'critic indexes must be followed to original reviews');
assert(policy.must_try_web_archive_for_dead_originals===true,'dead originals must receive archive attempts');
assert(policy.safety_caps_are_not_editorial_targets===true,'safety caps must not be treated as editorial stop targets');
assert(target>=enabled.length,`full-review safety cap ${target} is below enabled review-source count ${enabled.length}`);
assert(candidateTarget>=Math.max(1000,target*4),`candidate safety cap ${candidateTarget} is too small for exhaustive registered + generic discovery`);
assert(Number(policy.minimum_source_body_words||0)>=300,'accepted article sources must contain a substantial downloaded body');

if(failures.length){
  console.error(JSON.stringify({status:'failed',enabled_review_sources:enabled.length,target,candidate_target:candidateTarget,failures},null,2));
  process.exit(1);
}
console.log(JSON.stringify({status:'green',enabled_review_sources:enabled.length,target,candidate_target:candidateTarget,full_text_required:true,collect_all:true},null,2));
