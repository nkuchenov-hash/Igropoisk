#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const config=read('config/home-feeds-storage.json',{});
const manifestUrl=process.env.HOME_FEEDS_MANIFEST_URL||config.runtime_manifest_url;
if(!manifestUrl)throw new Error('Home feeds runtime manifest URL is not configured.');
const response=await fetch(manifestUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Home feeds manifest HTTP ${response.status}`);
const manifest=await response.json();
if(!manifest||manifest.channel!==(config.channel||'home-feeds')||!manifest.files)throw new Error('Invalid home feeds manifest.');
const wanted=new Set(['data/popular/current.json','data/popular/published.json','data/releases/current.json','data/releases/public.json']);
const hydrated=[];
for(const relative of wanted){
  const descriptor=manifest.files?.[relative];
  if(!descriptor?.url)continue;
  const fileResponse=await fetch(descriptor.url,{cache:'no-store'});
  if(!fileResponse.ok)throw new Error(`Home feed ${relative} HTTP ${fileResponse.status}`);
  const value=await fileResponse.json();
  const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n');
  hydrated.push(relative);
}
if(!hydrated.includes('data/popular/current.json'))throw new Error('Live Popular snapshot was not hydrated.');
fs.mkdirSync(path.join(root,'data/parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data/parser-runs/home-feed-hydration.json'),JSON.stringify({schema_version:1,checked_at:new Date().toISOString(),manifest_version:manifest.version||null,manifest_published_at:manifest.publishedAt||null,hydrated},null,2)+'\n');
console.log(JSON.stringify({manifest_version:manifest.version||null,hydrated},null,2));
