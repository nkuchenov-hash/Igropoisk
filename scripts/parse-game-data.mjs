import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const [slug,appidRaw,...titleParts]=process.argv.slice(2);
const appid=Number(appidRaw);
const requestedTitle=titleParts.join(' ').trim();
if(!slug||!Number.isInteger(appid)){console.error('Usage: node scripts/parse-game-data.mjs <slug> <steam-appid> [title]');process.exit(1)}
const checkedAt=new Date().toISOString();
const sourceUrl=`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`;
const started=Date.now();
let run;
try{
  const response=await fetch(sourceUrl,{headers:{'user-agent':'IgropoiskGameParser/1.0'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const payload=await response.json();
  const record=payload?.[String(appid)];
  if(!record?.success||!record.data)throw new Error('Steam returned no game data');
  const data=record.data;
  const screenshots=(data.screenshots||[]).map(item=>item.path_full||item.path_thumbnail).filter(Boolean);
  const videos=(data.movies||[]).map(item=>({title:item.name,url:item.mp4?.max||item.webm?.max||'',thumbnail:item.thumbnail})).filter(item=>item.url||item.thumbnail);
  const parsed={
    schema_version:1,
    identity:{slug,title:data.name||requestedTitle||slug,steam_appid:appid},
    release:{date_text:data.release_date?.date||''},
    companies:{developers:data.developers||[],publishers:data.publishers||[]},
    classification:{genres:(data.genres||[]).map(item=>item.description),categories:(data.categories||[]).map(item=>item.description),platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    editorial:{short_description:data.short_description||'',integrated_description:'',features:(data.categories||[]).map(item=>item.description).slice(0,8)},
    media:{cover:data.header_image||'',hero:data.background_raw||data.background||'',screenshots,videos,artwork:[]},
    requirements:{pc:{minimum:{raw:data.pc_requirements?.minimum||''},recommended:{raw:data.pc_requirements?.recommended||''}},platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    links:{store:`https://store.steampowered.com/app/${appid}/`},
    source:{name:'Steam Store API',url:sourceUrl,checked_at:checkedAt}
  };
  fs.mkdirSync(path.join(root,'data','parser-output'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','parser-output',`${slug}.json`),`${JSON.stringify(parsed,null,2)}\n`);
  run={parser:'game-data',status:'success',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:sourceUrl,summary:{title:parsed.identity.title,developers:parsed.companies.developers,genres:parsed.classification.genres,platforms:parsed.classification.platforms,screenshots:screenshots.length,videos:videos.length},output:`data/parser-output/${slug}.json`};
}catch(error){run={parser:'game-data',status:'error',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:sourceUrl,error:error.message};process.exitCode=1}
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','parser-runs','game-data.json'),`${JSON.stringify(run,null,2)}\n`);
console.log(JSON.stringify(run,null,2));
