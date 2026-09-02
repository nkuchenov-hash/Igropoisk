#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=[...new Set(process.argv.slice(2).map(String).map(x=>x.trim()).filter(Boolean))];
if(!slugs.length){console.log('No changed game pages to validate.');process.exit(0)}
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const exists=p=>fs.existsSync(path.join(root,p));
const catalog=read('data/catalog-visible.json',[]);
const errors=[];
for(const slug of slugs){
  const publiclyReferenced=catalog.some(item=>item.slug===slug)||exists(`game/${slug}/index.html`);
  if(!publiclyReferenced)continue;
  const draft=read(`data/drafts/${slug}.json`),editorial=read(`data/page-editorial/${slug}.json`),pageQc=read(`data/quality-control/page-${slug}-control.json`),contentQc=read(`data/quality-control/game-page-content-${slug}.json`),mediaQc=read(`data/quality-control/game-page-${slug}.json`),corpus=read(`data/game-sources/${slug}.json`);
  const bad=[];
  if(!draft?.publication?.public_ready||draft?.publication?.status!=='published')bad.push('draft publication is not finalized');
  if(editorial?.game_slug!==slug||editorial?.quality_status!=='green')bad.push('canonical page editorial is missing/not green');
  if(pageQc?.status!=='green'||pageQc?.green!==true)bad.push('page QC is not green');
  if(contentQc?.status!=='green')bad.push('content QC is not green');
  if(mediaQc?.status!=='green')bad.push('media QC is not green');
  if(!corpus?.discovery?.complete)bad.push('source discovery is incomplete');
  if(!exists(`game/${slug}/index.html`))bad.push('public game shell is missing');
  if(bad.length)errors.push(`${slug}: ${bad.join('; ')}`);
}
if(errors.length){console.error('Game page publication gate failed:\n'+errors.map(x=>`- ${x}`).join('\n'));process.exit(2)}
console.log(`Game page publication state is green for ${slugs.length} changed slug(s).`);
