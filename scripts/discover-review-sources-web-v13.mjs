#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
const rawFetch=globalThis.fetch;
if(typeof rawFetch!=='function')throw new Error('Global fetch is required for review discovery.');

const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const decode=value=>String(value||'').replace(/%20/gi,' ').replace(/[-_/]+/g,' ').replace(/[^a-z0-9а-яё ]+/gi,' ').replace(/\s+/g,' ').trim().toLowerCase();
const roman={ii:'2',iii:'3',iv:'4',v:'5',vi:'6',vii:'7',viii:'8',ix:'9',x:'10'};
const normalize=value=>decode(value).split(' ').filter(Boolean).map(token=>roman[token]||token).join(' ');

export function numberedIdentityKey(title){
  const tokens=normalize(title).split(' ').filter(Boolean);
  const index=tokens.findIndex((token,i)=>i>0&&/^\d+$/.test(token));
  if(index<1)return'';
  return tokens.slice(0,index+1).join(' ');
}
export function numberedIdentityMatches(title,source){
  const key=numberedIdentityKey(title);if(!key)return true;
  const primary=normalize(`${source?.title||''} ${source?.resolved_url||source?.url||''}`);
  return ` ${primary} `.includes(` ${key} `);
}
export function extractGameSpotReviewLinks(html){
  const source=String(html||'').replace(/\\u002f/gi,'/').replace(/\\\//g,'/');
  const out=[];
  const add=value=>{let url;try{url=new URL(String(value||''),'https://www.gamespot.com')}catch{return}if(url.hostname.replace(/^www\./,'')!=='gamespot.com'||!/^\/reviews\//i.test(url.pathname))return;url.hash='';if(!out.includes(url.href))out.push(url.href)};
  for(const match of source.matchAll(/href=["']([^"']+)["']/gi))add(match[1]);
  for(const match of source.matchAll(/(?:https?:\/\/www\.gamespot\.com)?\/reviews\/[^"'<>\s]+/gi))add(match[0].replace(/[),.;]+$/,''));
  return out.slice(0,40);
}
function validateV13(){
  const game={identity:{title:'Fallout 2'}};
  if(numberedIdentityMatches(game.identity.title,{title:'Fallout 4: Anniversary Edition Switch 2 Review',url:'https://example.com/fallout-4-switch-2-review'}))throw new Error('Numbered sequel matcher accepted Fallout 4 / Switch 2 as Fallout 2.');
  if(!numberedIdentityMatches(game.identity.title,{title:'Fallout 2 Review',url:'https://www.gamespot.com/reviews/fallout-2-review/1900-2535954/'}))throw new Error('Numbered sequel matcher rejected exact Fallout 2 review.');
  if(numberedIdentityKey('The Witcher III: Wild Hunt')!=='the witcher 3')throw new Error('Roman sequel normalization failed.');
  const fixture='<a href="/reviews/fallout-2-review/1900-2535954/">Fallout 2 Review</a>{"canonicalUrl":"https:\\/\\/www.gamespot.com\\/reviews\\/fallout-tactics-review\\/1900-2708347\\/"}';
  const links=extractGameSpotReviewLinks(fixture);if(links.length!==2||!links.some(url=>url.includes('fallout-2-review')))throw new Error('GameSpot review extraction contract failed.');
}
validateV13();

function htmlResponse(body,response){
  const headers=new Headers(response?.headers||{});headers.delete('content-length');headers.delete('content-encoding');headers.set('content-type','text/html; charset=utf-8');
  return new Response(body,{status:200,headers});
}
async function textOrEmpty(response){try{return response?.ok?await response.text():''}catch{return''}}

globalThis.fetch=async(input,init)=>{
  const requestUrl=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let parsed;try{parsed=new URL(requestUrl)}catch{return rawFetch(input,init)}
  const host=parsed.hostname.replace(/^www\./,'').toLowerCase();
  const isGameSpotHub=host==='gamespot.com'&&/^\/games\/[^/]+\/reviews\/?$/i.test(parsed.pathname);
  if(!isGameSpotHub||!slug)return rawFetch(input,init);

  const draft=read(`data/drafts/${slug}.json`,{}),title=String(draft?.identity?.title||slug.replace(/-/g,' '));
  const searchUrl=`https://www.gamespot.com/search/?q=${encodeURIComponent(title)}`;
  const [hubResult,searchResult]=await Promise.allSettled([
    rawFetch(input,init),
    rawFetch(searchUrl,{redirect:'follow',headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/13.0)','accept-language':'en-US,en;q=.9'},signal:AbortSignal.timeout(8000)})
  ]);
  const hub=hubResult.status==='fulfilled'?hubResult.value:null,search=searchResult.status==='fulfilled'?searchResult.value:null;
  const hubHtml=await textOrEmpty(hub),searchHtml=await textOrEmpty(search);
  const directLinks=extractGameSpotReviewLinks(`${hubHtml}\n${searchHtml}`);
  if(!hubHtml&&!searchHtml)return hub||search||new Response('',{status:503});
  const anchors=directLinks.map(url=>`<a href="${url}">${title} review</a>`).join('\n');
  return htmlResponse(`${hubHtml}\n${searchHtml}\n${anchors}`,hub||search);
};

try{
  await import('./discover-review-sources-web-v12.mjs');
}finally{
  globalThis.fetch=rawFetch;
}

// The lower discovery stack deliberately has a loose body-text identity fallback for unnumbered games.
// For numbered sequels, tighten the final accepted corpus to title/URL identity so incidental numbers in article text cannot poison ratings.
if(slug){
  const draft=read(`data/drafts/${slug}.json`,{}),title=String(draft?.identity?.title||''),key=numberedIdentityKey(title),matrixPath=`data/research/${slug}-source-matrix.json`,matrix=read(matrixPath);
  if(key&&matrix&&Array.isArray(matrix.accepted)){
    const before=matrix.accepted.length,removed=matrix.accepted.filter(source=>!numberedIdentityMatches(title,source)),accepted=matrix.accepted.filter(source=>numberedIdentityMatches(title,source));
    if(removed.length){
      matrix.accepted=accepted;
      matrix.rejected=[...(matrix.rejected||[]),...removed.map(source=>({publication:source.publication||source.configured_source_id||'',url:source.resolved_url||source.url||'',title:source.title||'',reasons:[`numbered_title_identity_mismatch:${key}`]}))];
      const acceptedIds=new Set(accepted.map(source=>source.configured_source_id));
      matrix.source_checks=(matrix.source_checks||[]).map(check=>check?.status==='found'&&!acceptedIds.has(check.source_id)?{...check,status:'not_found',notes:`candidate rejected: numbered title identity must contain ${key}`} : check);
      const scored=accepted.filter(source=>source.score_eligible!==false&&Number.isFinite(Number(source.score))).length,contextOnly=accepted.filter(source=>source.canonical_score_eligible===false).length,contemporary=accepted.filter(source=>source.source_kind==='review').length,minimum=Number(matrix.policy?.minimum_sources||5),historical=Boolean(matrix.policy?.historical),minContemporary=Number(matrix.policy?.min_contemporary||(historical?4:5)),regionalComplete=matrix.regional_discovery?.complete===true,green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete;
      matrix.coverage={...(matrix.coverage||{}),accepted:accepted.length,scored,context_only_versions:contextOnly,contemporary,green,passed:green,needs_more:Math.max(0,minimum-accepted.length)};
      matrix.policy={...(matrix.policy||{}),numbered_title_identity_key:key,numbered_title_identity_required:true};
      matrix.identity_filter={version:'v13',key,removed:removed.map(source=>({configured_source_id:source.configured_source_id||null,title:source.title||'',url:source.resolved_url||source.url||''})),before,after:accepted.length};
      write(matrixPath,matrix);
      console.log(JSON.stringify({slug,numbered_identity_key:key,removed_wrong_version_sources:removed.length,accepted_after_filter:accepted.length},null,2));
    }
  }
}
