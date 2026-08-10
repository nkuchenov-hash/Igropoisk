import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const jsonBuffer=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`,'utf8');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const contentType=file=>({'.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif'}[path.extname(file).toLowerCase()]||'application/octet-stream');
const versionId=()=>`${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}-${String(process.env.GITHUB_SHA||'local').slice(0,12)}-${String(process.env.GITHUB_RUN_ID||'manual')}`;

function collectLocalMedia(value,roots,out=new Set()){
  if(typeof value==='string'){
    if(roots.some(root=>value.startsWith(root)))out.add(value);
    return out;
  }
  if(Array.isArray(value)){value.forEach(item=>collectLocalMedia(item,roots,out));return out}
  if(!value||typeof value!=='object')return out;
  for(const child of Object.values(value))collectLocalMedia(child,roots,out);
  return out;
}
function replaceLocalMedia(value,map){
  if(typeof value==='string')return map.get(value)||value;
  if(Array.isArray(value))return value.map(item=>replaceLocalMedia(item,map));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,replaceLocalMedia(child,map)]));
}
async function exists(storage,key){try{await storage.headObject(key);return true}catch(error){if(/failed with 404/.test(error.message))return false;throw error}}

export async function publishHomeFeeds({root=process.cwd(),configPath='config/home-feeds-storage.json',storage=createYandexObjectStorageClient(),dryRun=false}={}){
  const config=readJson(path.join(root,configPath));
  const storageConfig=config.storage||{};
  const version=versionId();
  const snapshotRoot=`${storageConfig.snapshot_prefix||'home-feeds/snapshots'}/${version}`;
  const mediaPrefix=storageConfig.media_prefix||'home-feeds/media';
  const immutableCache=storageConfig.immutable_cache_control||'public, max-age=31536000, immutable';
  const manifestCache=storageConfig.manifest_cache_control||'no-store, max-age=0';
  const payloads=new Map();
  for(const relative of config.required_files||[]){
    const absolute=path.join(root,relative);
    if(!fs.existsSync(absolute))throw new Error(`Required home-feed output is missing: ${relative}`);
    payloads.set(relative,readJson(absolute));
  }
  const mediaPaths=new Set();
  for(const payload of payloads.values())collectLocalMedia(payload,config.media_roots||[],mediaPaths);
  const mediaUrls=new Map();
  let mediaBytes=0;
  for(const relative of [...mediaPaths].sort()){
    const absolute=path.join(root,relative);
    if(!fs.existsSync(absolute))continue;
    const body=fs.readFileSync(absolute);mediaBytes+=body.length;
    const key=`${mediaPrefix}/${sha256(body)}${path.extname(relative).toLowerCase()}`;
    mediaUrls.set(relative,storage.publicUrl(key));
    if(!dryRun&&!(await exists(storage,key)))await storage.putObject(key,body,{contentType:contentType(relative),cacheControl:immutableCache});
  }
  const files={};let snapshotBytes=0;
  for(const [relative,payload] of payloads){
    const body=jsonBuffer(replaceLocalMedia(payload,mediaUrls));snapshotBytes+=body.length;
    const key=`${snapshotRoot}/${relative}`;
    files[relative]={key,url:storage.publicUrl(key),sha256:sha256(body),bytes:body.length};
    if(!dryRun)await storage.putObject(key,body,{contentType:'application/json; charset=utf-8',cacheControl:immutableCache});
  }
  if(snapshotBytes>Number(storageConfig.maximum_snapshot_bytes||50000000))throw new Error(`Home-feed snapshot is too large: ${snapshotBytes}`);
  const manifest={schemaVersion:1,channel:config.channel||'home-feeds',version,publishedAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA||'',sourceRunId:process.env.GITHUB_RUN_ID||'',files,media:{count:mediaUrls.size,bytes:mediaBytes},repositoryFallback:true};
  const body=jsonBuffer(manifest);
  if(!dryRun){
    await storage.putObject(`${snapshotRoot}/manifest.json`,body,{contentType:'application/json; charset=utf-8',cacheControl:immutableCache});
    await storage.putObject(storageConfig.current_manifest||'home-feeds/manifests/current.json',body,{contentType:'application/json; charset=utf-8',cacheControl:manifestCache});
    const readBack=await (await storage.getObject(storageConfig.current_manifest||'home-feeds/manifests/current.json')).json();
    if(readBack.version!==version||readBack.channel!==(config.channel||'home-feeds'))throw new Error('Current home-feed manifest did not switch to the verified snapshot.');
  }
  return {manifest,dryRun};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await publishHomeFeeds({dryRun:process.argv.includes('--dry-run')});console.log(`${result.dryRun?'Prepared':'Published'} home-feed snapshot ${result.manifest.version}.`)}
