#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requested=process.argv[2]||'';
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const catalog=read('data/catalog-visible.json',[]);
const slugs=requested?[requested]:catalog.map(item=>item.slug).filter(Boolean);
const records=new Map();
const contentDir=path.join(root,'data/game-content');
if(fs.existsSync(contentDir))for(const file of fs.readdirSync(contentDir).filter(name=>name.endsWith('.json'))){const payload=read(`data/game-content/${file}`,{});for(const [slug,game] of Object.entries(payload.games||{}))records.set(slug,game)}
const errors=[];
const warnings=[];
const badSource=value=>/bing\.com\/images|google\.[^/]+\/search|yandex\.[^/]+\/images/i.test(String(value||''));
const badUrl=value=>/scribdassets\.com|document_thumbnails/i.test(String(value||''));
const urlOf=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||item?.thumbnail||'');
const valid=item=>{const url=urlOf(item);return /^https?:\/\//i.test(url)&&!badUrl(url)&&!badSource(item?.source_url)};
const unique=items=>{const seen=new Set();return items.filter(item=>{if(!valid(item))return false;const url=urlOf(item);if(seen.has(url))return false;seen.add(url);return true})};

for(const slug of slugs){
  const draft=read(`data/drafts/${slug}.json`,{});
  const curated=records.get(slug)||{};
  const article=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`,{}));
  const articleMedia=read(`data/article-media/${slug}.json`,{});
  const articleShots=(articleMedia.sections||[]).flatMap(section=>section.images||[]);
  const draftShots=draft.media?.screenshots||[];
  const curatedShots=curated.media?.screenshots||[];
  const goodShots=unique([...curatedShots,...draftShots,...articleShots]);
  const rejectedDraft=draftShots.filter(item=>!valid(item)).map(urlOf);
  const appid=Number(curated.identity?.steam_appid||draft.identity?.steam_appid||0);
  const steamHero=appid?`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`:'';
  const steamCover=appid?`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`:'';
  const cover=urlOf(curated.media?.cover)||urlOf(draft.media?.cover)||steamCover||urlOf(article.hero);
  const hero=urlOf(curated.media?.hero)||urlOf(draft.media?.hero)||steamHero||urlOf(article.hero)||goodShots[0]&&urlOf(goodShots[0]);
  const art=unique([
    ...(curated.media?.artwork||[]),
    ...(draft.media?.artwork||[]),
    cover&&{url:cover},
    hero&&{url:hero},
    article.hero&&{url:article.hero,source_url:article.sources?.[0]?.url||''}
  ].filter(Boolean));
  if(goodShots.length<6)errors.push(`${slug}: only ${goodShots.length} valid screenshots after effective runtime recovery; minimum is 6`);
  if(!cover||badUrl(cover))errors.push(`${slug}: no valid effective cover`);
  if(!hero||badUrl(hero))errors.push(`${slug}: no valid effective hero`);
  if(art.length<2)warnings.push(`${slug}: only ${art.length} unique cover/art image; page will still render but needs richer artwork`);
  if(rejectedDraft.length)warnings.push(`${slug}: ${rejectedDraft.length} rejected search/junk media item(s)`);
}

if(warnings.length){console.warn('Game media warnings:');for(const warning of warnings)console.warn(`- ${warning}`)}
if(errors.length){console.error(`Game media quality failed (${errors.length})`);for(const error of errors)console.error(`- ${error}`);process.exit(2)}
console.log(JSON.stringify({valid:true,checked:slugs.length,warnings:warnings.length},null,2));
