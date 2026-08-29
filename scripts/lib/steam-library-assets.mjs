const cdn=(appid,relative)=>{
  const value=String(relative||'').replace(/^\/+/, '').trim();
  if(!value)return'';
  if(/^https?:\/\//i.test(value))return value;
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/${value}`;
};

const collectStrings=(value,out=[])=>{
  if(typeof value==='string'){out.push(value);return out}
  if(Array.isArray(value)){for(const item of value)collectStrings(item,out);return out}
  if(value&&typeof value==='object')for(const item of Object.values(value))collectStrings(item,out);
  return out;
};

const assetRank=(value,role)=>{
  const text=String(value||'').toLowerCase();
  if(role==='hero'){
    if(/library_hero_2x\.(?:jpe?g|png|webp)$/.test(text))return 100;
    if(/library_hero\.(?:jpe?g|png|webp)$/.test(text))return 90;
    if(/hero_capsule_2x\.(?:jpe?g|png|webp)$/.test(text))return 60;
    if(/hero_capsule\.(?:jpe?g|png|webp)$/.test(text))return 50;
    return 0;
  }
  if(/library_600x900_2x\.(?:jpe?g|png|webp)$/.test(text))return 100;
  if(/library_capsule_2x\.(?:jpe?g|png|webp)$/.test(text))return 95;
  if(/library_600x900\.(?:jpe?g|png|webp)$/.test(text))return 90;
  if(/library_capsule\.(?:jpe?g|png|webp)$/.test(text))return 85;
  return 0;
};

const choose=(values,role)=>values.map(value=>({value,rank:assetRank(value,role)})).filter(item=>item.rank>0).sort((a,b)=>b.rank-a.rank)[0]?.value||'';

async function fetchJson(url){
  try{
    const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'IgropoiskSteamLibraryAssets/1.0','accept':'application/json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return null;
    return await response.json();
  }catch{return null}
}

async function fetchText(url){
  try{
    const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskSteamLibraryAssets/1.0)','accept-language':'en-US,en;q=.9'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return'';
    return await response.text();
  }catch{return''}
}

const fromSteamCmd=async appid=>{
  const payload=await fetchJson(`https://api.steamcmd.net/v1/info/${appid}`);
  const record=payload?.data?.[String(appid)]||payload?.data||null;
  if(!record||typeof record!=='object')return null;
  const strings=collectStrings(record,[]);
  const hero=choose(strings,'hero');
  const cover=choose(strings,'cover');
  if(!hero&&!cover)return null;
  return {hero:cdn(appid,hero),cover:cdn(appid,cover),provider:'steamcmd-appinfo',source_url:`https://api.steamcmd.net/v1/info/${appid}`};
};

const fromSteamDb=async appid=>{
  const sourceUrl=`https://steamdb.info/app/${appid}/info/`;
  const html=await fetchText(sourceUrl);
  if(!html)return null;
  const decoded=html.replace(/&amp;/g,'&').replace(/&#x2F;|&#47;/gi,'/').replace(/&quot;/g,'"');
  const candidates=[];
  const patterns=[
    /([a-f0-9]{40}\/(?:library_hero_2x|library_hero)\.(?:jpe?g|png|webp))/gi,
    /([a-f0-9]{40}\/(?:library_600x900_2x|library_600x900|library_capsule_2x|library_capsule)\.(?:jpe?g|png|webp))/gi
  ];
  for(const pattern of patterns)for(const match of decoded.matchAll(pattern))candidates.push(match[1]);
  const hero=choose(candidates,'hero');
  const cover=choose(candidates,'cover');
  if(!hero&&!cover)return null;
  return {hero:cdn(appid,hero),cover:cdn(appid,cover),provider:'steamdb-appinfo-fallback',source_url:sourceUrl};
};

export async function resolveSteamLibraryAssets(appid){
  const id=Number(appid);
  if(!Number.isInteger(id)||id<=0)return{hero:'',cover:'',provider:'none',source_url:''};
  return await fromSteamCmd(id)||await fromSteamDb(id)||{hero:'',cover:'',provider:'none',source_url:''};
}
