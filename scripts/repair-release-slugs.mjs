import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fallbackSlug(release={}){
  const steam=Number(release?.external_ids?.steam||0);
  if(Number.isFinite(steam)&&steam>0)return `steam-${steam}`;
  const title=String(release?.title||'').trim();
  const digest=crypto.createHash('sha1').update(title||String(release?.id||'release')).digest('hex').slice(0,12);
  return `game-${digest}`;
}
function eventId(slug,event={}){
  const region=String(event.region||'worldwide');
  const dateKey=event.date||event.date_start||'tbd';
  return `${slug}:${region}:${dateKey}`;
}

export function repairReleaseSlugs(document={}){
  let repaired=0;
  const releases=(document.releases||[]).map(source=>{
    const release=structuredClone(source);
    if(String(release.slug||'').trim())return release;
    const slug=fallbackSlug(release);
    release.slug=slug;
    release.editorial={...(release.editorial||{}),draft_path:`data/release-drafts/${slug}.json`};
    release.events=(release.events||[]).map(event=>({...event,id:!event.id||String(event.id).startsWith(':')?eventId(slug,event):event.id}));
    repaired++;
    return release;
  });
  return {document:{...document,releases},repaired};
}

export function repairReleaseFile({root=process.cwd(),file='data/releases/current.json'}={}){
  const target=path.join(root,file);
  const source=JSON.parse(fs.readFileSync(target,'utf8'));
  const result=repairReleaseSlugs(source);
  if(result.repaired)fs.writeFileSync(target,`${JSON.stringify(result.document,null,2)}\n`,'utf8');
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=repairReleaseFile();
  console.log(JSON.stringify({status:'success',repaired:result.repaired},null,2));
}
