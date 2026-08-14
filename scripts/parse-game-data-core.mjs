import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const [slug,appidRaw,...titleParts]=process.argv.slice(2);
const requestedTitle=titleParts.join(' ').trim();
if(!slug){console.error('Usage: node scripts/parse-game-data.mjs <slug> <steam-appid|auto> [title]');process.exit(1)}
const checkedAt=new Date().toISOString();
const started=Date.now();
const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const tokens=value=>new Set(normalize(value).split(/\s+/).filter(Boolean));
const overlap=(left,right)=>{const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;let common=0;for(const token of a)if(b.has(token))common++;return common/Math.max(a.size,b.size)};
function png(buf){if(buf.length>=24&&buf.slice(1,4).toString()==='PNG')return{width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)}}
function jpeg(buf){if(buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return null;let i=2;while(i+9<buf.length){if(buf[i]!==0xff){i++;continue}const marker=buf[i+1];const len=buf.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buf.readUInt16BE(i+5),width:buf.readUInt16BE(i+7)};if(len<2)break;i+=2+len}return null}
function webp(buf){if(buf.length<30||buf.slice(0,4).toString()!=='RIFF'||buf.slice(8,12).toString()!=='WEBP')return null;const type=buf.slice(12,16).toString();if(type==='VP8X')return{width:1+buf.readUIntLE(24,3),height:1+buf.readUIntLE(27,3)};if(type==='VP8 '&&buf.length>=30&&buf[23]===0x9d&&buf[24]===0x01&&buf[25]===0x2a)return{width:buf.readUInt16LE(26)&0x3fff,height:buf.readUInt16LE(28)&0x3fff};return null}
async function probe(url){try{const response=await fetch(url,{redirect:'follow',headers:{Range:'bytes=0-262143','user-agent':'IgropoiskGameParser/2.0'},signal:AbortSignal.timeout(9000)});if(!response.ok)return null;const data=Buffer.from(await response.arrayBuffer());const size=png(data)||jpeg(data)||webp(data)||{};return{url:response.url||url,width:Number(size.width||0),height:Number(size.height||0)}}catch{return null}}
async function chooseImage(candidates,{minWidth,minHeight,minAspect=0,maxAspect=Infinity}){for(const candidate of [...new Set(candidates.filter(Boolean))]){const result=await probe(candidate);if(!result?.width||!result?.height)continue;const aspect=result.width/result.height;if(result.width>=minWidth&&result.height>=minHeight&&aspect>=minAspect&&aspect<=maxAspect)return result.url}return''}
async function resolveSteamAppId(term){const searchUrl=`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=us`;
  const response=await fetch(searchUrl,{headers:{'user-agent':'IgropoiskGameParser/2.0'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`Steam search HTTP ${response.status}`);const payload=await response.json();const items=(payload?.items||[]).filter(item=>Number.isInteger(Number(item?.id))&&item?.name);if(!items.length)throw new Error(`Steam search returned no candidates for ${term}`);
  const target=normalize(term);const exact=items.find(item=>normalize(item.name)===target);if(exact)return{appid:Number(exact.id),name:exact.name,search_url:searchUrl,confidence:1};
  const ranked=items.map(item=>({...item,score:overlap(term,item.name)})).sort((a,b)=>b.score-a.score);const best=ranked[0],second=ranked[1];if(!best||best.score<0.72||(second&&second.score>=best.score-0.08))throw new Error(`Steam identity ambiguous for ${term}: ${ranked.slice(0,3).map(item=>`${item.name} (${item.score.toFixed(2)})`).join(', ')}`);return{appid:Number(best.id),name:best.name,search_url:searchUrl,confidence:best.score};
}
let run;
try{
  let appid=Number(appidRaw);let resolution=null;
  if(!Number.isInteger(appid)||appid<=0){const term=requestedTitle||slug.replace(/-/g,' ');resolution=await resolveSteamAppId(term);appid=resolution.appid}
  const sourceUrl=`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`;
  const response=await fetch(sourceUrl,{headers:{'user-agent':'IgropoiskGameParser/2.0'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const payload=await response.json();
  const record=payload?.[String(appid)];
  if(!record?.success||!record.data)throw new Error('Steam returned no game data');
  const data=record.data;
  const screenshots=(data.screenshots||[]).map(item=>item.path_full||item.path_thumbnail).filter(Boolean);
  const videos=(data.movies||[]).map(item=>({title:item.name,url:item.mp4?.max||item.webm?.max||'',thumbnail:item.thumbnail,source_url:`https://store.steampowered.com/app/${appid}/`})).filter(item=>item.url||item.thumbnail);
  const cdn=`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;
  const akamai=`https://shared.akamai.steamstatic.com/steam/apps/${appid}`;
  const cover=await chooseImage([
    `${cdn}/library_600x900_2x.jpg`,`${akamai}/library_600x900_2x.jpg`,`${cdn}/library_600x900.jpg`,`${akamai}/library_600x900.jpg`
  ],{minWidth:600,minHeight:850,minAspect:.5,maxAspect:.85})||`${cdn}/library_600x900_2x.jpg`;
  const hero=await chooseImage([
    data.background_raw,data.background,`${cdn}/library_hero_2x.jpg`,`${akamai}/library_hero_2x.jpg`,`${cdn}/library_hero.jpg`,`${akamai}/library_hero.jpg`
  ],{minWidth:1200,minHeight:675,minAspect:1.25})||data.background_raw||data.background||`${cdn}/library_hero.jpg`;
  const parsed={
    schema_version:2,
    identity:{slug,title:data.name||resolution?.name||requestedTitle||slug,steam_appid:appid},
    release:{date_text:data.release_date?.date||''},
    companies:{developers:data.developers||[],publishers:data.publishers||[]},
    classification:{genres:(data.genres||[]).map(item=>item.description),categories:(data.categories||[]).map(item=>item.description),platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    editorial:{short_description:data.short_description||'',integrated_description:'',features:(data.categories||[]).map(item=>item.description).slice(0,8)},
    media:{cover,hero,screenshots,videos,artwork:hero?[hero]:[]},
    requirements:{pc:{minimum:{raw:data.pc_requirements?.minimum||''},recommended:{raw:data.pc_requirements?.recommended||''}},platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    links:{store:`https://store.steampowered.com/app/${appid}/`},
    source:{name:'Steam Store API',url:sourceUrl,checked_at:checkedAt},
    steam_resolution:resolution
  };
  fs.mkdirSync(path.join(root,'data','parser-output'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','parser-output',`${slug}.json`),`${JSON.stringify(parsed,null,2)}\n`);
  run={parser:'game-data',status:'success',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:sourceUrl,steam_resolution:resolution,summary:{title:parsed.identity.title,steam_appid:appid,developers:parsed.companies.developers,genres:parsed.classification.genres,platforms:parsed.classification.platforms,screenshots:screenshots.length,videos:videos.length,hero,cover},output:`data/parser-output/${slug}.json`};
}catch(error){run={parser:'game-data',status:'error',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,error:error.message};process.exitCode=1}
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','parser-runs',`game-data-${slug}.json`),`${JSON.stringify(run,null,2)}\n`);
console.log(JSON.stringify(run,null,2));