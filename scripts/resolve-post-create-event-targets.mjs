#!/usr/bin/env node
import fs from 'node:fs';

const eventName=String(process.env.GITHUB_EVENT_NAME||'');
const eventPath=process.env.GITHUB_EVENT_PATH;
const repo=process.env.GITHUB_REPOSITORY;
const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'';
const output=process.env.GITHUB_OUTPUT;
const payload=eventPath&&fs.existsSync(eventPath)?JSON.parse(fs.readFileSync(eventPath,'utf8')):{};
const slugs=new Set();
const addFile=file=>{
  let match=String(file||'').match(/^data\/game-enrichment-requests\/([^/]+)\.json$/);
  if(match)slugs.add(match[1].toLowerCase());
  match=String(file||'').match(/^game\/([^/]+)\/index\.html$/);
  if(match)slugs.add(match[1].toLowerCase());
};
async function githubJson(url){
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{})}});
  if(!response.ok)throw new Error(`GitHub API ${response.status} for ${url}: ${(await response.text()).slice(0,500)}`);
  return response.json();
}
async function pullFiles(number){
  const files=[];
  for(let page=1;page<=20;page++){
    const batch=await githubJson(`https://api.github.com/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    files.push(...batch.map(item=>item.filename));
    if(batch.length<100)break;
  }
  return files;
}
async function pushFiles(before,after){
  if(!before||!after||/^0+$/.test(before))return [];
  const compare=await githubJson(`https://api.github.com/repos/${repo}/compare/${before}...${after}`);
  return (compare.files||[]).map(item=>item.filename);
}
let files=[];
if(eventName==='pull_request'&&payload.pull_request?.number)files=await pullFiles(payload.pull_request.number);
else if(eventName==='push')files=await pushFiles(payload.before,payload.after);
for(const file of files)addFile(file);
const values=[...slugs].sort();
const mode=values.length?'event':'backlog';
const lines=[`mode=${mode}`,`slugs=${values.join(',')}`,`count=${values.length}`];
if(output)fs.appendFileSync(output,`${lines.join('\n')}\n`);
console.log(JSON.stringify({event:eventName,mode,slugs:values,changed_files:files.length},null,2));
