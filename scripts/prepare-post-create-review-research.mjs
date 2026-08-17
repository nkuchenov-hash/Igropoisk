#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadReviewSourceRegistry,registeredEditorialSource,classifyCanonicalVersion} from './lib/review-source-registry.mjs';
import {isTrustedEditorialScore} from './lib/review-score-extractor.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: node scripts/prepare-post-create-review-research.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const checkedAt=new Date().toISOString();
const reviewPath=`data/reviews/${slug}.json`;
const researchPath=`data/research/${slug}-source-matrix.json`;
const review=read(reviewPath),research=read(researchPath),game=read(`data/drafts/${slug}.json`),quality=read('config/game-page-quality-v2.json',{}),synthesis=read('config/parsers/review-synthesis.json',{});
if(!review||!research||!game)throw new Error(`${slug}: verified discovery corpus is missing before post-create research`);
const registry=loadReviewSourceRegistry(synthesis.source_registry||research.source_registry||'config/parsers/review-source-registry.json');
const corpus=quality.review_corpus||{};
const minimum=Number(corpus.minimum_sources||research.policy?.minimum_sources||5),target=Number(corpus.target_sources||research.policy?.target_sources||20),maximum=Number(corpus.maximum_sources||research.policy?.maximum_sources||20);
const historical=Boolean(research.policy?.historical);
const minContemporary=historical?Number(corpus.minimum_contemporary_historical||4):Number(corpus.minimum_contemporary_modern||5);
const sourceRows=Array.isArray(research.accepted)&&research.accepted.length?research.accepted:(review.reviews||[]);
const accepted=[],rejected=[...(research.rejected||[])],seen=new Set();
let historicalIndexed=0,trustedScores=0;
for(const raw of sourceRows){
  const source=registeredEditorialSource(registry,raw);
  if(!source){rejected.push({publication:String(raw?.publication||''),url:String(raw?.resolved_url||raw?.url||''),reasons:['unregistered_publisher_in_post_create_research']});continue}
  if(seen.has(source.id)){rejected.push({publication:source.name,url:String(raw?.resolved_url||raw?.url||''),reasons:['duplicate_publication_in_post_create_research']});continue}
  seen.add(source.id);
  const version=raw.version_validation||classifyCanonicalVersion({title:raw.title||'',url:raw.resolved_url||raw.url||'',versionContext:raw.version_context||'',game});
  const trusted=isTrustedEditorialScore(raw),indexed=trusted&&raw?.score_evidence?.method==='historical-critic-index-attribution';
  if(indexed)historicalIndexed++;if(trusted)trustedScores++;
  accepted.push({...raw,id:`source-${accepted.length+1}`,configured_source_id:source.id,publication:source.name,canonical_score_eligible:version.score_eligible!==false,version_validation:version,score_eligible:trusted&&version.score_eligible!==false?true:Boolean(raw.score_eligible&&version.score_eligible!==false)});
  if(accepted.length>=maximum)break;
}
const regional=research.regional_discovery||review.regional_discovery||{region:'ru',checks:[],complete:true,found_but_not_accepted:[]};
const regionalComplete=regional.complete!==false;
const contemporary=accepted.filter(item=>item.source_kind==='review').length;
const green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete;
const scored=accepted.filter(item=>item.score_eligible&&isTrustedEditorialScore(item)).length;
research.schema_version=Math.max(Number(research.schema_version||0),12);
research.generated_at=checkedAt;
research.source_registry=synthesis.source_registry||research.source_registry||'config/parsers/review-source-registry.json';
research.policy={...(research.policy||{}),minimum_sources:minimum,target_sources:target,maximum_sources:maximum,post_create_verified_corpus_preserved:true,professional_only:true,metascore_as_vote:false,user_scores_as_votes:false};
research.accepted=accepted;research.rejected=rejected;research.regional_discovery=regional;
research.coverage={...(research.coverage||{}),accepted:accepted.length,scored,context_only_versions:accepted.filter(item=>item.canonical_score_eligible===false).length,contemporary,green,passed:green,needs_more:Math.max(0,minimum-accepted.length),historical_index_preserved:historicalIndexed,trusted_scores_preserved:trustedScores};
review.schema_version=Math.max(Number(review.schema_version||0),12);review.updated_at=checkedAt;review.source_registry=research.source_registry;review.reviews=accepted;review.rejected=rejected;review.regional_discovery=regional;
review.publication_gate={...(review.publication_gate||{}),minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision',post_create_verified_corpus_preserved:true};
write(researchPath,research);write(reviewPath,review);
write(`data/parser-runs/review-post-create-research-${slug}.json`,{parser:'review-post-create-verified-corpus-v1',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,accepted:accepted.length,scored,historical_index_preserved:historicalIndexed,trusted_scores_preserved:trustedScores,regional_complete:regionalComplete,minimum,target,professional_only:true,metascore_as_vote:false,user_scores_as_votes:false});
console.log(JSON.stringify({slug,status:green?'green':'red-needs-revision',accepted:accepted.length,scored,historical_index_preserved:historicalIndexed,trusted_scores_preserved:trustedScores,regional_complete:regionalComplete},null,2));
if(!green)process.exitCode=2;
