import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const [slug,appidRaw]=process.argv.slice(2);
const appid=Number(appidRaw);
if(!slug||!Number.isInteger(appid)){console.error('Usage: node scripts/parse-news.mjs <slug> <steam-appid>');process.exit(1)}
const checkedAt=new Date().toISOString();
const sourceUrl=`https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appid}&count=20&maxlength=700&format=json`;
const started=Date.now();
let run;
try{
  const response=await fetch(sourceUrl,{headers:{'user-agent':'IgropoiskNewsParser/1.0'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const payload=await response.json();
  const items=(payload?.appnews?.newsitems||[]).map(item=>({
    id:String(item.gid||''),title:item.title||'',description:String(item.contents||'').replace(/\[[^\]]+\]/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
    source:item.feedlabel||'Steam News',url:item.url||'',date:item.date?new Date(item.date*1000).toISOString():'',author:item.author||''
  })).filter(item=>item.title&&item.url);
  const output={schema_version:1,game_slug:slug,checked_at:checkedAt,source:{name:'Steam News API',url:sourceUrl},items};
  fs.mkdirSync(path.join(root,'data','news'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','news',`${slug}.json`),`${JSON.stringify(output,null,2)}\n`);
  run={parser:'news',status:'success',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:sourceUrl,items:items.length,output:`data/news/${slug}.json`,preview:items.slice(0,5)};
}catch(error){run={parser:'news',status:'error',game_slug:slug,checked_at:checkedAt,duration_ms:Date.now()-started,source_url:sourceUrl,error:error.message};process.exitCode=1}
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','parser-runs','news.json'),`${JSON.stringify(run,null,2)}\n`);
console.log(JSON.stringify(run,null,2));
