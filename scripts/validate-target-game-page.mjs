#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const targetPath=process.argv[2]||'data/content-pipeline/target-page.json';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const target=read(targetPath);
const slug=String(target.slug||'').trim();
const gameId=String(target.game_id||'').trim();
if(!slug||!gameId)throw new Error('target-page.json requires slug and game_id');
const min=target.minimums||{};
const errors=[];
const requireFile=p=>{const full=path.join(root,p);if(!fs.existsSync(full)){errors.push(`missing ${p}`);return null}try{return JSON.parse(fs.readFileSync(full,'utf8'))}catch(e){errors.push(`invalid JSON ${p}: ${e.message}`);return null}};
const pageFile=path.join(root,'game',slug,'index.html');
if(!fs.existsSync(pageFile))errors.push(`missing game/${slug}/index.html`);
else{
 const html=fs.readFileSync(pageFile,'utf8');
 const draft=(html.match(/data-draft=["']([^"']+)/i)||[])[1]||'';
 const id=(html.match(/data-game-id=["']([^"']+)/i)||[])[1]||'';
 const bodySlug=(html.match(/data-slug=["']([^"']+)/i)||[])[1]||'';
 if(draft&&draft!==slug)errors.push(`data-draft ${draft} != ${slug}`);
 if(bodySlug&&bodySlug!==slug)errors.push(`data-slug ${bodySlug} != ${slug}`);
 if(id&&id!==gameId)errors.push(`data-game-id ${id} != ${gameId}`);
}
const reviews=requireFile(`data/reviews/${slug}.json`);
if(reviews){
 if(reviews.publication_gate?.status!=='green')errors.push('review material scan is not green');
 if(reviews.source_registry_scan?.complete!==true)errors.push('registered source scan incomplete');
 if(reviews.external_search?.complete!==true)errors.push('broad external search incomplete');
 const list=Array.isArray(reviews.reviews)?reviews.reviews:[];
 if(list.length<Number(min.materials||1))errors.push(`materials ${list.length} < ${Number(min.materials||1)}`);
 for(const [i,r] of list.entries())if(!String(r?.url||'').startsWith('http'))errors.push(`review ${i+1} has no direct URL`);
 if(reviews.publication_gate?.maximum!=null)errors.push('review material collection still has a maximum cap');
}
const rating=requireFile(`data/ratings/${slug}.json`);
if(rating){
 if(rating.status!=='green')errors.push('rating is not green');
 if(rating.method?.maximum_sources!=null)errors.push('rating still has a maximum source cap');
 if(rating.method?.use_all_discovered_scores!==true)errors.push('rating does not use all discovered scores');
 const sources=Array.isArray(rating.sources)?rating.sources:[];
 if(sources.length<Number(min.scores||1))errors.push(`scores ${sources.length} < ${Number(min.scores||1)}`);
}
const draft=requireFile(`data/drafts/${slug}.json`);
if(draft){
 if(String(draft.identity?.game_id||'')!==gameId)errors.push('draft game_id mismatch');
 const shots=Array.isArray(draft.media?.screenshots)?draft.media.screenshots:[];
 const art=Array.isArray(draft.media?.artwork)?draft.media.artwork:[];
 const videos=Array.isArray(draft.media?.videos)?draft.media.videos:[];
 if(shots.length<Number(min.screenshots||1))errors.push(`screenshots ${shots.length} < ${Number(min.screenshots||1)}`);
 if(art.length<Number(min.artwork||1))errors.push(`artwork ${art.length} < ${Number(min.artwork||1)}`);
 if(videos.length<Number(min.videos||1))errors.push(`videos ${videos.length} < ${Number(min.videos||1)}`);
 for(const [i,m] of [...shots,...art].entries()){
  if(!String(m?.url||'').startsWith('http'))errors.push(`media ${i+1} missing URL`);
  if(!String(m?.source_url||'').startsWith('http'))errors.push(`media ${i+1} missing source_url`);
 }
 for(const [i,v] of videos.entries()){
  if(!String(v?.url||'').startsWith('http'))errors.push(`video ${i+1} missing usable URL`);
  if(!String(v?.source_url||v?.url||'').startsWith('http'))errors.push(`video ${i+1} missing source provenance`);
 }
}
const result={slug,game_id:gameId,checked_at:new Date().toISOString(),status:errors.length?'red':'green',errors};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exit(2);
