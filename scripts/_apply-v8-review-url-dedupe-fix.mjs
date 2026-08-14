import fs from 'node:fs';
const file='scripts/discover-review-sources-web-v8.mjs';
let source=fs.readFileSync(file,'utf8');

source=source.replace(
  "const direct=value=>{try{const url=new URL(value);return url.pathname.split('/').filter(Boolean).length>1||url.searchParams.has('p')}catch{return false}};",
  "const direct=value=>{try{const url=new URL(value);return url.pathname.split('/').filter(Boolean).length>0||url.searchParams.has('p')}catch{return false}};"
);
source=source.replace(
  'const accepted=[],rejected=[],seenUrls=new Set(),checks=[];',
  'const accepted=[],rejected=[],acceptedUrls=new Set(),checks=[];'
);
source=source.replace(
  "function store(candidate){const current=acceptedFor(candidate.configured_source_id);if(current){if(current.canonical_score_eligible===false&&candidate.canonical_score_eligible!==false){const index=accepted.indexOf(current);candidate.id=current.id;accepted[index]=candidate;return true}return false}accepted.push(candidate);return true}",
  "function store(candidate){const candidateUrl=canon(candidate.resolved_url||candidate.url),current=acceptedFor(candidate.configured_source_id);if(current){if(current.canonical_score_eligible===false&&candidate.canonical_score_eligible!==false){const index=accepted.indexOf(current);candidate.id=current.id;accepted[index]=candidate;if(candidateUrl)acceptedUrls.add(candidateUrl);return true}return false}accepted.push(candidate);if(candidateUrl)acceptedUrls.add(candidateUrl);return true}"
);
source=source.replace(
  "let url=canon(raw.resolved_url||raw.url);if(!url.startsWith('http')||!direct(url)||seenUrls.has(url))return false;",
  "let url=canon(raw.resolved_url||raw.url);if(!url.startsWith('http')||!direct(url)||acceptedUrls.has(url))return false;"
);
source=source.replace('  seenUrls.add(url);const response=await get(url);','  const response=await get(url);');

if(source.includes('seenUrls'))throw new Error('seenUrls remains after patch');
if(!source.includes("length>0||url.searchParams.has('p')"))throw new Error('single-segment direct URL fix not applied');
if(!source.includes('acceptedUrls.has(url)'))throw new Error('accepted-only dedupe fix not applied');
fs.writeFileSync(file,source);
// one-shot trigger; remove helper after production v8 commit is verified.
