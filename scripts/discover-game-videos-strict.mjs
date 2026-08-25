import fs from 'node:fs';
import path from 'node:path';

const slug=String(process.argv[2]||'').trim();
if(!slug) throw new Error('Usage: node scripts/discover-game-videos-strict.mjs <game-slug>');

await import('./discover-game-videos.mjs');

const root=process.cwd();
const draftPath=path.join(root,'data','drafts',`${slug}.json`);
const draft=JSON.parse(fs.readFileSync(draftPath,'utf8'));
const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const names=[draft.identity?.title,...(draft.identity?.aliases||[])].map(normalize).filter(Boolean);
const exactGameTitle=value=>{const text=` ${normalize(value)} `;return names.some(name=>text.includes(` ${name} `))};
const videos=Array.isArray(draft.media?.videos)?draft.media.videos:[];
const accepted=[],rejected=[];
for(const video of videos){
  if(!exactGameTitle(video?.title)){
    rejected.push({...video,rejection_reason:'video title does not contain the canonical game title/alias as a phrase'});
    continue;
  }
  accepted.push(video);
}
draft.media=draft.media||{};
draft.media.videos=accepted;
fs.writeFileSync(draftPath,JSON.stringify(draft,null,2)+'\n');
const candidatesPath=path.join(root,'data','video-candidates',`${slug}.json`);
let candidates={};try{candidates=JSON.parse(fs.readFileSync(candidatesPath,'utf8'))}catch{}
const priorRejected=Array.isArray(candidates.rejected)?candidates.rejected:[];
const counts={accepted:accepted.length,rejected:priorRejected.length+rejected.length,video_reviews:accepted.filter(x=>x.kind==='review').length,trailers:accepted.filter(x=>x.kind==='trailer').length,gameplay:accepted.filter(x=>x.kind==='gameplay').length};
const strict={...candidates,schema_version:5,strict_identity_filter:true,accepted,rejected:[...priorRejected,...rejected],counts};
fs.mkdirSync(path.dirname(candidatesPath),{recursive:true});fs.writeFileSync(candidatesPath,JSON.stringify(strict,null,2)+'\n');
const runPath=path.join(root,'data','parser-runs',`video-discovery-${slug}.json`);fs.mkdirSync(path.dirname(runPath),{recursive:true});fs.writeFileSync(runPath,JSON.stringify({parser:'game-video-discovery-strict-v1',status:accepted.length&&counts.video_reviews?'completed':'needs_revision',game_slug:slug,checked_at:new Date().toISOString(),...counts,strict_identity_filter:true,collect_all_discovered:true},null,2)+'\n');
console.log(JSON.stringify({slug,...counts,strict_identity_filter:true},null,2));
process.exitCode=accepted.length&&counts.video_reviews?0:2;
