#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadEditorialRegistry, resolveEditorialGame } from './lib/editorial-game-registry-adapter.mjs';

const root=process.cwd();
const strict=process.argv.includes('--strict');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const text=relative=>{try{return fs.readFileSync(path.join(root,relative),'utf8')}catch{return ''}};
const catalog=read('data/catalog-visible.json',[]);
const loaded=loadEditorialRegistry(root);
const rows=[];
const blocking=[];
const reasonCounts={};
const countReason=reason=>{const key=reason.split(':')[0];reasonCounts[key]=(reasonCounts[key]||0)+1};
const articleUrlMatches=(value,slug)=>{try{const url=new URL(String(value||''),`https://igropoisk.invalid/Igropoisk/game/${slug}/`);return url.pathname.replace(/\/+$/,'').endsWith(`/article/${slug}`)}catch{return false}};
function resolveDraftIdentity(draft){
  const explicit=String(draft?.game_id||draft?.gameId||'').trim();
  if(explicit)return {game_id:explicit,matched_by:'draft.game_id',error:null};
  if(!draft?.identity)return {game_id:null,matched_by:null,error:null};
  const steam=draft.identity.steam_appid??draft.identity.steamAppId??null;
  const title=draft.identity.title??null;
  try{
    if(steam)return resolveEditorialGame({steam_appid:steam},{root,loaded});
    if(title)return resolveEditorialGame({title},{root,loaded});
    return {game_id:null,matched_by:null,error:null};
  }catch(error){return {game_id:null,matched_by:null,error:error.message}}
}

for(const game of catalog){
  const slug=String(game.slug||'');
  if(!slug)continue;
  const draft=read(`data/drafts/${slug}.json`);
  const article=read(`data/articles/${slug}.json`);
  const reviewFeed=read(`data/reviews/${slug}.json`);
  const gameHtml=text(`game/${slug}/index.html`);
  const articleHtml=text(`article/${slug}/index.html`);
  const draftResolution=resolveDraftIdentity(draft);
  const expectedGameId=String(game.game_id||'');
  const draftIdentityOk=!draft||(!draftResolution.error&&(!draftResolution.game_id||draftResolution.game_id===expectedGameId));
  const articleGameSlug=String(article?.game_slug||article?.slug||'');
  const reviewGameSlug=String(reviewFeed?.game_slug||'');
  const pageDraft=(gameHtml.match(/\bdata-draft=["']([^"']+)["']/i)||[])[1]||'';
  const directArticleHref=new RegExp(`(?:/Igropoisk)?/article/${slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/?`, 'i').test(gameHtml);
  const dynamicRuntime=/game-page(?:-v3)?\.js/i.test(gameHtml)||/game-shell\.js/i.test(gameHtml);
  const runtimeArticleUrl=reviewFeed?.igropoisk_article?.url||'';
  const runtimeArticleLinked=dynamicRuntime&&reviewGameSlug===slug&&articleUrlMatches(runtimeArticleUrl,slug);
  const linked=directArticleHref||runtimeArticleLinked;
  const articleFiles=Boolean(article)&&Boolean(articleHtml);
  const articleSlugOk=articleFiles&&articleGameSlug===slug;
  const publicationStatus=String(article?.publication_status||'').toLowerCase();
  const articlePublishedFlag=!publicationStatus||publicationStatus==='published';
  const reasons=[];
  if(draft&&!draftIdentityOk)reasons.push(`draft_identity_mismatch:${draftResolution.game_id||draftResolution.error||draft?.identity?.title||'unresolved'}`);
  if(!articleFiles)reasons.push(Boolean(article)!==Boolean(articleHtml)?'article_json_html_pair_incomplete':'article_missing');
  if(articleFiles&&!articleSlugOk)reasons.push(`article_slug_mismatch:${articleGameSlug}`);
  if(articleFiles&&!articlePublishedFlag)reasons.push(`article_status:${publicationStatus}`);
  if(articleFiles&&reviewFeed&&reviewGameSlug!==slug)reasons.push(`review_feed_slug_mismatch:${reviewGameSlug}`);
  if(articleFiles&&!linked)reasons.push('article_not_exposed_by_game_page');
  const userPublished=articleFiles&&articleSlugOk&&articlePublishedFlag&&draftIdentityOk&&linked;
  const row={slug,title:game.title,game_id:expectedGameId,draft_title:draft?.identity?.title||null,draft_resolved_game_id:draftResolution.game_id||null,draft_matched_by:draftResolution.matched_by||null,page_draft:pageDraft||null,article_files:articleFiles,article_game_slug:articleGameSlug||null,review_feed:Boolean(reviewFeed),review_game_slug:reviewGameSlug||null,dynamic_runtime:dynamicRuntime,runtime_article_url:runtimeArticleUrl||null,linked_from_game_page:linked,publication_verified:userPublished,reasons};
  rows.push(row);
  for(const reason of reasons)countReason(reason);
  if(reasons.length||!userPublished)blocking.push(row);
}

const report={schema_version:4,checked_at:new Date().toISOString(),catalog_games:rows.length,article_file_pairs:rows.filter(r=>r.article_files).length,verified_published_reviews:rows.filter(r=>r.publication_verified).length,blocking:blocking.length,reason_counts:reasonCounts,rows};
fs.mkdirSync(path.join(root,'data/audits'),{recursive:true});
fs.writeFileSync(path.join(root,'data/audits/review-publication.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({catalog_games:report.catalog_games,article_file_pairs:report.article_file_pairs,verified_published_reviews:report.verified_published_reviews,blocking:report.blocking,reason_counts:reasonCounts,examples:blocking.slice(0,15).map(r=>({slug:r.slug,reasons:r.reasons}))},null,2));
if(strict&&blocking.length)process.exit(2);
