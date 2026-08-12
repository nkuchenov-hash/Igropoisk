import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const jsonBuffer=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`,'utf8');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const contentType=file=>({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif'}[path.extname(file).toLowerCase()]||'application/octet-stream');
const versionId=()=>`${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}-${String(process.env.GITHUB_SHA||'local').slice(0,12)}-${String(process.env.GITHUB_RUN_ID||'manual')}-releases`;

function collectLocalMedia(value,roots,out=new Set()){
  if(typeof value==='string'){if(roots.some(root=>value.startsWith(root)))out.add(value);return out}
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
function runtimeRows(doc={}){
  return [
    ...(doc.releases||[]).map(release=>({...release,visibility:'global'})),
    ...(doc.personalized_releases||[]).map(release=>({...release,visibility:'personalized'})),
  ];
}
function runtimeSignature(doc={}){
  return JSON.stringify(runtimeRows(doc).map(release=>({
    id:release.id,
    visibility:release.visibility,
    game_id:release.game_id||null,
    title:release.title||'',
    global_notability:Boolean(release.global_notability?.eligible),
    regional_regions:(release.regional_notability?.qualifying_regions||[]).map(item=>item.region).sort(),
    events:(release.events||[]).map(event=>({id:event.id,precision:event.precision||'tbd',date:event.date||null,date_start:event.date_start||null,date_end:event.date_end||null,platforms:[...(event.platforms||[])].sort()})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  })).sort((a,b)=>`${a.visibility}:${a.id}`.localeCompare(`${b.visibility}:${b.id}`)));
}

export async function publishReleaseFeed({root=process.cwd(),configPath='config/home-feeds-storage.json',storage=createYandexObjectStorageClient()}={}){
  const config=readJson(path.join(root,configPath));
  const storageConfig=config.storage||{};
  const releasePath='data/releases/public.json';
  const currentManifestKey=storageConfig.current_manifest||'home-feeds/manifests/current.json';
  const releaseFile=path.join(root,releasePath);
  if(!fs.existsSync(releaseFile))throw new Error(`Validated release output is missing: ${releasePath}`);
  if(!(await exists(storage,currentManifestKey)))throw new Error('Current home-feed manifest is missing; run the normal bootstrap before release-only publication.');

  const source=readJson(releaseFile);
  const version=versionId();
  const snapshotRoot=`${storageConfig.snapshot_prefix||'home-feeds/snapshots'}/${version}`;
  const mediaPrefix=storageConfig.media_prefix||'home-feeds/media';
  const immutableCache=storageConfig.immutable_cache_control||'public, max-age=31536000, immutable';
  const manifestCache=storageConfig.manifest_cache_control||'no-store, max-age=0';
  const mediaPaths=collectLocalMedia(source,config.media_roots||[]);
  const mediaUrls=new Map();

  for(const relative of [...mediaPaths].sort()){
    const absolute=path.join(root,relative);
    if(!fs.existsSync(absolute))throw new Error(`Release media required by public feed is missing: ${relative}`);
    const body=fs.readFileSync(absolute);
    const key=`${mediaPrefix}/${sha256(body)}${path.extname(relative).toLowerCase()}`;
    mediaUrls.set(relative,storage.publicUrl(key));
    if(!(await exists(storage,key)))await storage.putObject(key,body,{contentType:contentType(relative),cacheControl:immutableCache});
  }

  const transformed=replaceLocalMedia(source,mediaUrls);
  const releaseBody=jsonBuffer(transformed);
  const releaseKey=`${snapshotRoot}/${releasePath}`;
  await storage.putObject(releaseKey,releaseBody,{contentType:'application/json; charset=utf-8',cacheControl:immutableCache});

  const current=await(await storage.getObject(currentManifestKey)).json();
  const next={
    ...current,
    version,
    publishedAt:new Date().toISOString(),
    sourceCommit:process.env.GITHUB_SHA||'',
    sourceRunId:process.env.GITHUB_RUN_ID||'',
    files:{
      ...(current.files||{}),
      [releasePath]:{key:releaseKey,url:storage.publicUrl(releaseKey),sha256:sha256(releaseBody),bytes:releaseBody.length}
    },
    releasePublication:{mode:'independent-validated-release-feed',generatedAt:transformed.generated_at||null},
    repositoryFallback:true
  };
  const manifestBody=jsonBuffer(next);
  await storage.putObject(`${snapshotRoot}/release-manifest.json`,manifestBody,{contentType:'application/json; charset=utf-8',cacheControl:immutableCache});
  await storage.putObject(currentManifestKey,manifestBody,{contentType:'application/json; charset=utf-8',cacheControl:manifestCache});

  const readBackManifest=await(await storage.getObject(currentManifestKey)).json();
  if(readBackManifest?.files?.[releasePath]?.key!==releaseKey)throw new Error('Current manifest did not switch to the validated release feed.');
  const live=await(await storage.getObject(releaseKey)).json();
  if(String(live.generated_at||'')!==String(transformed.generated_at||'')||runtimeSignature(live)!==runtimeSignature(transformed))throw new Error('Live release feed does not match the exact validated materialization.');

  console.log(JSON.stringify({status:'published',version,release_key:releaseKey,global_releases:(live.releases||[]).length,personalized_releases:(live.personalized_releases||[]).length,media:mediaUrls.size,generated_at:live.generated_at||null},null,2));
  return next;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await publishReleaseFeed();
