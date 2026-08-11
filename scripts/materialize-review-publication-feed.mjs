#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadEditorialRegistry, resolveEditorialGame } from './lib/editorial-game-registry-adapter.mjs';

const root=process.cwd();
const dryRun=process.argv.includes('--dry-run');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const catalog=read('data/catalog-visible.json',[]);
const loaded=loadEditorialRegistry(root);
const result={schema_version:2,checked_at:new Date().toISOString(),updated:[],already_valid:[],blocked:[]};
function resolveDraftIdentity(draft){
  if(!draft?.identity)return {game_id:null};
  try{
    const steam=draft.identity.steam_appid??draft.identity.steamAppId??null;
    if(steam)return resolveEditorialGame({steam_appid:steam},{root,loaded});
    if(draft.identity.title)return resolveEditorialGame({title:draft.identity.title},{root,loaded});
    return {game_id:null};
  }catch(error){return {game_id:null,error:error.message}}
}

for(const game of catalog){
  const slug=String(game.slug||'');
  if(!slug)continue;
  const article=read(`data/articles/${slug}.json`);
  const articleHtml=path.join(root,'article',slug,'index.html');
  if(!article||!fs.existsSync(articleHtml)){result.blocked.push({slug,reason:'article_pair_missing'});continue}
  const articleSlug=String(article.game_slug||article.slug||'');
  if(articleSlug!==slug){result.blocked.push({slug,reason:`article_slug_mismatch:${articleSlug}`});continue}
  if(String(article.publication_status||'published').toLowerCase()!=='published'){result.blocked.push({slug,reason:`article_status:${article.publication_status}`});continue}
  const draft=read(`data/drafts/${slug}.json`);
  const draftIdentity=resolveDraftIdentity(draft);
  if(draft&&(draftIdentity.error||(draftIdentity.game_id&&draftIdentity.game_id!==String(game.game_id||'')))){
    result.blocked.push({slug,reason:`draft_identity_mismatch:${draftIdentity.game_id||draftIdentity.error}`});continue;
  }
  const relative=`data/reviews/${slug}.json`;
  const feed=read(relative,{schema_version:2,game_slug:slug,reviews:[]});
  if(feed.game_slug&&String(feed.game_slug)!==slug){result.blocked.push({slug,reason:`review_feed_slug_mismatch:${feed.game_slug}`});continue}
  const desiredUrl=`../../article/${slug}/`;
  if(feed.igropoisk_article&&String(feed.igropoisk_article.url||'')===desiredUrl){
    result.already_valid.push(slug);
    continue;
  }
  const desired={
    url:desiredUrl,
    title:String(article.title||`Обзор ${game.title}`),
    description:String(article.dek||article.lead||`Полный обзор ${game.title} от Игропоиска.`),
    score:article.score??null
  };
  feed.schema_version=Math.max(Number(feed.schema_version||1),2);
  feed.game_slug=slug;
  feed.game_id=String(game.game_id||feed.game_id||'')||undefined;
  feed.updated_at=new Date().toISOString();
  feed.reviews=Array.isArray(feed.reviews)?feed.reviews:[];
  feed.igropoisk_article=desired;
  if(!dryRun){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(feed,null,2)+'\n');}
  result.updated.push(slug);
}

fs.mkdirSync(path.join(root,'data/audits'),{recursive:true});
fs.writeFileSync(path.join(root,'data/audits/review-feed-materialization.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({dry_run:dryRun,updated:result.updated.length,already_valid:result.already_valid.length,blocked:result.blocked.length,blocked_examples:result.blocked.slice(0,20)},null,2));
