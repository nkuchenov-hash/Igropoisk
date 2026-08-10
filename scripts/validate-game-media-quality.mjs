#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requested=process.argv[2]||'';
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const catalog=read('data/catalog-visible.json',[]);
const slugs=requested?[requested]:catalog.map(item=>item.slug).filter(Boolean);
const errors=[];
const warnings=[];
const badSource=value=>/bing\.com\/images|google\.[^/]+\/search|yandex\.[^/]+\/images/i.test(String(value||''));
const badUrl=value=>/scribdassets\.com|document_thumbnails/i.test(String(value||''));
const urlOf=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||'');
const valid=item=>{const url=urlOf(item);return /^https?:\/\//i.test(url)&&!badUrl(url)&&!badSource(item?.source_url)};
const unique=items=>{const seen=new Set();return items.filter(item=>{if(!valid(item))return false;const url=urlOf(item);if(seen.has(url))return false;seen.add(url);return true})};

for(const slug of slugs){
  const draft=read(`data/drafts/${slug}.json`);
  if(!draft){warnings.push(`${slug}: no draft`);continue;}
  const articleMedia=read(`data/article-media/${slug}.json`,{});
  const articleShots=(articleMedia.sections||[]).flatMap(section=>section.images||[]);
  const draftShots=draft.media?.screenshots||[];
  const goodShots=unique([...draftShots,...articleShots]);
  const rejectedDraft=draftShots.filter(item=>!valid(item)).map(urlOf);
  const cover=urlOf(draft.media?.cover);
  const hero=urlOf(draft.media?.hero);
  const art=unique([...(draft.media?.artwork||[]),cover&&{url:cover},hero&&{url:hero}].filter(Boolean));
  if(goodShots.length<6)errors.push(`${slug}: only ${goodShots.length} valid screenshots after draft+article recovery; minimum is 6`);
  if(!cover||badUrl(cover))errors.push(`${slug}: valid cover is required`);
  if(!hero||badUrl(hero))errors.push(`${slug}: valid hero is required`);
  if(art.length<2)errors.push(`${slug}: cover/art section needs at least 2 unique valid images`);
  if(rejectedDraft.length)warnings.push(`${slug}: ${rejectedDraft.length} rejected search/junk media item(s)`);
}

if(warnings.length){console.warn('Game media warnings:');for(const warning of warnings)console.warn(`- ${warning}`)}
if(errors.length){console.error(`Game media quality failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(2)}
console.log(JSON.stringify({valid:true,checked:slugs.length,warnings:warnings.length},null,2));
