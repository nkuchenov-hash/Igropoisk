import fs from 'node:fs';
import path from 'node:path';
import {resolveSteamLibraryAssets} from './lib/steam-library-assets.mjs';

const root=process.cwd();
const [slug,appidRaw,...titleParts]=process.argv.slice(2);
const appid=Number(appidRaw);
const requestedTitle=titleParts.join(' ').trim();
if(!slug||!Number.isInteger(appid)){console.error('Usage: node scripts/parse-game-data.mjs <slug> <steam-appid> [title]');process.exit(1)}
const checkedAt=new Date().toISOString();
const englishSourceUrl=`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`;
const russianSourceUrl=`https://store.steampowered.com/api/appdetails?appids=${appid}&l=russian&cc=us`;
const started=Date.now();
const firstVideoUrl=item=>{
  const groups=[item?.mp4,item?.webm];
  for(const group of groups){
    if(!group||typeof group!=='object')continue;
    for(const key of ['max','1080','720','480'])if(typeof group[key]==='string'&&group[key])return group[key];
    const value=Object.values(group).find(value=>typeof value==='string'&&/^https?:\/\//i.test(value));
    if(value)return value;
  }
  for(const key of ['hls_h264','dash_h264','dash_av1'])if(typeof item?.[key]==='string'&&item[key])return item[key];
  return'';
};
const hasCyrillic=value=>/[А-Яа-яЁё]/.test(String(value||''));
async function fetchSteamData(url){
  const response=await fetch(url,{headers:{'user-agent':'IgropoiskGameParser/1.2'}});
  if(!response.ok)throw new Error(`HTTP ${response.status} for ${url}`);
  const payload=await response.json();
  const record=payload?.[String(appid)];
  if(!record?.success||!record.data)throw new Error(`Steam returned no game data for ${url}`);
  return record.data;
}
let run;
try{
  const [data,russianResult,libraryAssets]=await Promise.all([
    fetchSteamData(englishSourceUrl),
    fetchSteamData(russianSourceUrl).catch(()=>null),
    resolveSteamLibraryAssets(appid)
  ]);
  const localized=russianResult||{};
  const englishDescription=String(data.short_description||'').trim();
  const russianDescription=String(localized.short_description||'').trim();
  const useRussianDescription=Boolean(russianDescription&&hasCyrillic(russianDescription));
  const shortDescription=useRussianDescription?russianDescription:englishDescription;
  const localizedRequirements=localized.pc_requirements&&hasCyrillic(JSON.stringify(localized.pc_requirements))?localized.pc_requirements:data.pc_requirements;
  const descriptionLanguage=useRussianDescription?'ru':'en-fallback';
  const screenshots=(data.screenshots||[]).map(item=>item.path_full||item.path_thumbnail).filter(Boolean);
  const videos=(data.movies||[]).map(item=>({title:item.name,url:firstVideoUrl(item),thumbnail:item.thumbnail,source_name:'Steam',source_url:`https://store.steampowered.com/app/${appid}/`,kind:/trailer|teaser|launch/i.test(String(item.name||''))?'trailer':'gameplay'})).filter(item=>item.url||item.thumbnail);
  const parsed={
    schema_version:3,
    identity:{slug,title:data.name||requestedTitle||slug,steam_appid:appid},
    release:{date_text:data.release_date?.date||''},
    companies:{developers:data.developers||[],publishers:data.publishers||[]},
    classification:{genres:(data.genres||[]).map(item=>item.description),categories:(data.categories||[]).map(item=>item.description),platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    editorial:{short_description:shortDescription,integrated_description:'',features:(data.categories||[]).map(item=>item.description).slice(0,8),language:descriptionLanguage,localization_source:useRussianDescription?'Steam Store API (russian)':'Steam Store API (english fallback)'},
    media:{cover:libraryAssets.cover||data.header_image||'',hero:libraryAssets.hero||data.background_raw||data.background||'',screenshots,videos,artwork:[],library_assets:{provider:libraryAssets.provider,source_url:libraryAssets.source_url,hero:libraryAssets.hero||'',cover:libraryAssets.cover||''}},
    requirements:{pc:{minimum:{raw:localizedRequirements?.minimum||''},recommended:{raw:localizedRequirements?.recommended||''}},platforms:Object.entries(data.platforms||{}).filter(([,enabled])=>enabled).map(([platform])=>platform)},
    links:{store:`https://store.steampowered.com/app/${appid}/`},
    source:{name:'Steam Store API',url:englishSourceUrl,localized_url:russianSourceUrl,checked_at:checkedAt,languages:{canonical:'english',editorial:descriptionLanguage}}
  };
  fs.mkdirSync(path.join(root,'data','parser-output'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','parser-output',`${slug}.json`),`${JSON.stringify(parsed,null,2)}\n`);
  run={parser:'game-data',status:'success',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:englishSourceUrl,summary:{title:parsed.identity.title,developers:parsed.companies.developers,genres:parsed.classification.genres,platforms:parsed.classification.platforms,screenshots:screenshots.length,videos:videos.length,library_assets_provider:libraryAssets.provider,library_hero:Boolean(libraryAssets.hero),library_cover:Boolean(libraryAssets.cover),editorial_language:descriptionLanguage,russian_localization_used:useRussianDescription},output:`data/parser-output/${slug}.json`};
}catch(error){run={parser:'game-data',status:'error',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:englishSourceUrl,error:error.message};process.exitCode=1}
fs.mkdirSync(path.join(root,'data/parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data/parser-runs','game-data.json'),`${JSON.stringify(run,null,2)}\n`);
console.log(JSON.stringify(run,null,2));