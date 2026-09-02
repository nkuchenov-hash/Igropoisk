#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/merge-official-steam-videos.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const parser=read(`data/parser-output/${slug}.json`,{});
const draft=read(`data/drafts/${slug}.json`);
if(!draft)throw new Error(`Missing data/drafts/${slug}.json`);
const now=new Date().toISOString();
if(draft.publication?.status==='published'&&draft.publication?.public_ready===true){
  const plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
  if(!plan.pages.some(item=>item.slug===slug))plan.pages.push({type:'build_page',game_id:String(draft.game_id||draft.identity?.game_id||''),slug,title:draft.identity?.title||slug,steam_appid:Number(draft.identity?.steam_appid||parser.identity?.steam_appid)||null,priority:800,reason:'official_video_enrichment_requires_canonical_page_revision'});
  plan.updated_at=now;write('data/content-pipeline/execution-plan.json',plan);write(`data/parser-runs/official-steam-video-${slug}.json`,{parser:'official-steam-video-merge',status:'queued',game_slug:slug,checked_at:now,public_package_preserved:true,publication_owner:'scripts/finalize-game-page-publication.mjs'});console.log(JSON.stringify({slug,status:'queued',published_package_preserved:true},null,2));process.exit(0)
}
const appid=Number(draft.identity?.steam_appid||parser.identity?.steam_appid||0),store=appid?`https://store.steampowered.com/app/${appid}/`:'';
const officialUrl=url=>{try{const u=new URL(String(url||''));return /(?:^|\.)(?:steamstatic\.com|akamai\.steamstatic\.com)$/i.test(u.hostname)||/(?:^|\.)steamstatic\.com$/i.test(u.hostname)}catch{return false}};
const directMedia=url=>/^https?:\/\//i.test(String(url||''))&&/\.(?:mp4|webm|m3u8|mpd)(?:[?#]|$)/i.test(String(url||''));
const official=(parser.media?.videos||[]).filter(item=>directMedia(item?.url)&&officialUrl(item.url)).map(item=>({title:String(item.title||'Официальное видео'),url:String(item.url),thumbnail:String(item.thumbnail||''),source_name:'Steam',source_url:store||String(item.source_url||''),kind:['trailer','gameplay','review','interview','other'].includes(item.kind)?item.kind:'trailer',published_at:String(item.published_at||''),validation:{status:'accepted-official-steam-video',checked_at:now,method:'steam-store-api-direct-video'}}));
const existing=Array.isArray(draft.media?.videos)?draft.media.videos:[],seen=new Set();draft.media=draft.media||{};draft.media.videos=[...official,...existing].filter(item=>{const key=String(item?.url||'').split(/[?#]/)[0].toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true});draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false};write(`data/drafts/${slug}.json`,draft);write(`data/parser-runs/official-steam-video-${slug}.json`,{parser:'official-steam-video-merge',status:'completed',game_slug:slug,checked_at:now,official_found:official.length,total_videos:draft.media.videos.length});console.log(JSON.stringify({slug,official_found:official.length,total_videos:draft.media.videos.length,status:'needs_revision'},null,2));
