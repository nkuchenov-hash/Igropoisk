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
  const ratingFeed=read(`data/ratings/${slug}.json`);
  const gameHtml=text(`game/${slug}/index.html`);
  const articleHtml=text(`article/${slug}/index.html`);
  const draftResolution=resolveDraftIdentity(draft);
  const expectedGameId=String(game.game_id||'');
  const draftIdentityOk=!draft||(!draftResolution.error&&(!draftResolution.game_id||draftResolution.game_id===expectedGameId));
  const articleGameSlug=String(article?.game_slug||article?.slug||'');
  const reviewGameSlug=String(reviewFeed?.game_slug||'');
  const reviewQualityGreen=String(reviewFeed?.publication_gate?.status||'')==='green';
  const ratingQualityGreen=String(ratingFeed?.status||'')==='green'&&Number.isFinite(Number(ratingFeed?.calculation?.score_10));
  const qualityGreen=reviewQualityGreen&&ratingQualityGreen;
  const pageDraft=(gameHtml.match(/\bdata-draft=["']([^"']+)["']/i)||[])[1]||'';
  const directArticleHref=new RegExp(`(?:/Igropoisk)?/article/${slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/?`, 'i').test(gameHtml);
  const dynamicRuntime=/game-page(?:-v3)?\.js/i.test(gameHtml)||/game-shell\.js/i.test(gameHtml);
  const runtimeArticleUrl=reviewFeed?.igropoisk_article?.url||'';
  const runtimeArticleLinked=qualityGreen&&dynamicRuntime&&reviewGameSlug===slug&&articleUrlMatches(runtimeArticleUrl,slug);
  const linked=qualityGreen&&(directArticleHref||runtimeArticleLinked);
  const articleJson=Boolean(article);
  const articlePage=Boolean(articleHtml);
  const articleSlugOk=articleJson&&articleGameSlug===slug;
  const publicationStatus=String(article?.publication_status||'').toLowerCase();
  const intentionallyWithheld=articleJson&&Boolean(publicationStatus)&&publicationStatus!=='published';
  const articlePublishedFlag=articleJson&&(!publicationStatus||publicationStatus==='published');
  const reasons=[];
  if(draft&&!draftIdentityOk)reasons.push(`draft_identity_mismatch:${draftResolution.game_id||draftResolution.error||draft?.identity?.title||'unresolved'}`);
  if(!articleJson)reasons.push('article_missing');
  if(articleJson&&!articleSlugOk)reasons.push(`article_slug_mismatch:${articleGameSlug}`);
  if(articlePublishedFlag&&!articlePage)reasons.push('published_article_html_missing');
  if(intentionallyWithheld&&articlePage)reasons.push('withheld_article_html_present');
  if(articleJson&&reviewFeed&&reviewGameSlug!==slug)reasons.push(`review_feed_slug_mismatch:${reviewGameSlug}`);
  if(articlePublishedFlag&&!reviewQualityGreen)reasons.push(`review_quality_needs_revision:${reviewFeed?.publication_gate?.status||'missing'}`);
  if(articlePublishedFlag&&!ratingQualityGreen)reasons.push(`rating_quality_needs_revision:${ratingFeed?.status||'missing'}`);
  if(articlePublishedFlag&&qualityGreen&&!linked)reasons.push('article_not_exposed_by_game_page');
  if(intentionallyWithheld&&linked)reasons.push('withheld_article_exposed_by_game_page');
  const userPublished=articlePublishedFlag&&articleSlugOk&&draftIdentityOk&&articlePage&&linked&&qualityGreen;
  const withheldClean=intentionallyWithheld&&articleSlugOk&&draftIdentityOk&&!articlePage&&!linked;
  const row={slug,title:game.title,game_id:expectedGameId,draft_title:draft?.identity?.title||null,draft_resolved_game_id:draftResolution.game_id||null,draft_matched_by:draftResolution.matched_by||null,page_draft:pageDraft||null,article_json:articleJson,article_page:articlePage,article_game_slug:articleGameSlug||null,article_status:publicationStatus||null,review_feed:Boolean(reviewFeed),review_game_slug:reviewGameSlug||null,review_quality_status:reviewFeed?.publication_gate?.status||null,rating_quality_status:ratingFeed?.status||null,quality_green:qualityGreen,dynamic_runtime:dynamicRuntime,runtime_article_url:runtimeArticleUrl||null,linked_from_game_page:linked,publication_verified:userPublished,withheld_clean:withheldClean,reasons};
  rows.push(row);
  for(const reason of reasons)countReason(reason);
  if(reasons.length)blocking.push(row);
}

const report={schema_version:6,checked_at:new Date().toISOString(),catalog_games:rows.length,article_json_records:rows.filter(r=>r.article_json).length,verified_published_reviews:rows.filter(r=>r.publication_verified).length,withheld_reviews:rows.filter(r=>r.withheld_clean).length,needs_revision:blocking.length,blocking:blocking.length,reason_counts:reasonCounts,rows};
fs.mkdirSync(path.join(root,'data/audits'),{recursive:true});
fs.writeFileSync(path.join(root,'data/audits/review-publication.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({catalog_games:report.catalog_games,verified_published_reviews:report.verified_published_reviews,withheld_reviews:report.withheld_reviews,needs_revision:report.needs_revision,reason_counts:reasonCounts,examples:blocking.slice(0,15).map(r=>({slug:r.slug,reasons:r.reasons}))},null,2));
if(strict&&blocking.length)process.exit(2);