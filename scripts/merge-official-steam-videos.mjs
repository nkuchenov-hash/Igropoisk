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
const appid=Number(draft.identity?.steam_appid||parser.identity?.steam_appid||0);
const store=appid?`https://store.steampowered.com/app/${appid}/`:'';
const officialUrl=url=>{try{const u=new URL(String(url||''));return /(?:^|\.)(?:steamstatic\.com|akamai\.steamstatic\.com)$/i.test(u.hostname)||/(?:^|\.)steamstatic\.com$/i.test(u.hostname)}catch{return false}};
const directMedia=url=>/^https?:\/\//i.test(String(url||''))&&/\.(?:mp4|webm|m3u8|mpd)(?:[?#]|$)/i.test(String(url||''));
const now=new Date().toISOString();
const official=(parser.media?.videos||[]).filter(item=>directMedia(item?.url)&&officialUrl(item.url)).map(item=>({title:String(item.title||'Официальное видео'),url:String(item.url),thumbnail:String(item.thumbnail||''),source_name:'Steam',source_url:store||String(item.source_url||''),kind:['trailer','gameplay','review','interview','other'].includes(item.kind)?item.kind:'trailer',published_at:String(item.published_at||''),validation:{status:'accepted-official-steam-video',checked_at:now,method:'steam-store-api-direct-video'}}));
const existing=Array.isArray(draft.media?.videos)?draft.media.videos:[];
const seen=new Set();
draft.media=draft.media||{};
draft.media.videos=[...official,...existing].filter(item=>{const key=String(item?.url||'').split(/[?#]/)[0].toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true});
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/official-steam-video-${slug}.json`,{parser:'official-steam-video-merge',status:'completed',game_slug:slug,checked_at:now,official_found:official.length,total_videos:draft.media.videos.length});
console.log(JSON.stringify({slug,official_found:official.length,total_videos:draft.media.videos.length},null,2));
