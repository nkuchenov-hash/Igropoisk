#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const strict=process.argv.includes('--strict');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const text=relative=>{try{return fs.readFileSync(path.join(root,relative),'utf8')}catch{return ''}};
const exists=relative=>fs.existsSync(path.join(root,relative));
const norm=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[™®©]/g,'').replace(/[^a-zа-яё0-9]+/gi,' ').trim().replace(/\s+/g,' ');
const catalog=read('data/catalog-visible.json',[]);
const rows=[];
const blocking=[];

for(const game of catalog){
  const slug=String(game.slug||'');
  if(!slug)continue;
  const expected=norm(game.title);
  const draft=read(`data/drafts/${slug}.json`);
  const article=read(`data/articles/${slug}.json`);
  const gameHtml=text(`game/${slug}/index.html`);
  const articleHtml=text(`article/${slug}/index.html`);
  const draftTitle=norm(draft?.identity?.title);
  const articleGameSlug=String(article?.game_slug||article?.slug||'');
  const pageDraft=(gameHtml.match(/\bdata-draft=["']([^"']+)["']/i)||[])[1]||'';
  const articleHref=new RegExp(`(?:/Igropoisk)?/article/${slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/?`, 'i').test(gameHtml);
  const identityOk=Boolean(draft)&&Boolean(expected)&&draftTitle===expected;
  const articleFiles=Boolean(article)&&Boolean(articleHtml);
  const articleIdentityOk=!articleFiles||(articleGameSlug===slug&&identityOk);
  const pageBindingOk=!pageDraft||pageDraft===slug;
  const userPublished=articleFiles&&articleIdentityOk&&pageBindingOk&&articleHref;
  const reasons=[];
  if(!draft)reasons.push('missing_draft');
  else if(!identityOk)reasons.push(`draft_title_mismatch:${draft?.identity?.title||''}`);
  if(pageDraft&&pageDraft!==slug)reasons.push(`game_page_points_to_other_draft:${pageDraft}`);
  if(Boolean(article)!==Boolean(articleHtml))reasons.push('article_json_html_pair_incomplete');
  if(articleFiles&&articleGameSlug!==slug)reasons.push(`article_slug_mismatch:${articleGameSlug}`);
  if(articleFiles&&!articleHref)reasons.push('article_not_linked_from_game_page');
  const row={slug,title:game.title,draft_title:draft?.identity?.title||null,page_draft:pageDraft||null,article_files:articleFiles,article_game_slug:articleGameSlug||null,linked_from_game_page:articleHref,publication_verified:userPublished,reasons};
  rows.push(row);
  if(reasons.some(reason=>!reason.startsWith('article_not_linked_from_game_page'))||articleFiles&&!userPublished)blocking.push(row);
}

const report={schema_version:1,checked_at:new Date().toISOString(),catalog_games:rows.length,article_file_pairs:rows.filter(r=>r.article_files).length,verified_published_reviews:rows.filter(r=>r.publication_verified).length,blocking: blocking.length,rows};
fs.mkdirSync(path.join(root,'data/audits'),{recursive:true});
fs.writeFileSync(path.join(root,'data/audits/review-publication.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({catalog_games:report.catalog_games,article_file_pairs:report.article_file_pairs,verified_published_reviews:report.verified_published_reviews,blocking:report.blocking,examples:blocking.slice(0,12).map(r=>({slug:r.slug,reasons:r.reasons}))},null,2));
if(strict&&blocking.length)process.exit(2);
