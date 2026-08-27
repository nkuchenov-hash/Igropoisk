#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/filter-invalid-media-assets.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);
if(!draft) throw new Error(`Missing ${draftPath}`);
const policy=read('data/media-quality/invalid-generic-assets.json',{blocked_urls:[]});
const blocked=new Set((policy.blocked_urls||[]).map(String));
const bad=item=>blocked.has(String(typeof item==='string'?item:item?.url||''));
if(Array.isArray(draft.media?.screenshots)) draft.media.screenshots=draft.media.screenshots.filter(x=>!bad(x));
if(Array.isArray(draft.media?.artwork)) draft.media.artwork=draft.media.artwork.filter(x=>!bad(x));
if(Array.isArray(draft.media?.items)) draft.media.items=draft.media.items.filter(x=>!bad(x));
if(bad(draft.media?.hero)) draft.media.hero='';
if(bad(draft.media?.cover)) draft.media.cover='';
write(draftPath,draft);
console.log(JSON.stringify({slug,blocked:[...blocked],artwork:draft.media?.artwork?.length||0},null,2));
