import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
const requestedTitle=process.argv.slice(3).join(' ').trim();
if(!slug){
  console.error('Usage: node scripts/parse-awards.mjs <game-slug> [game title]');
  process.exit(1);
}

const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const contentDirectory=path.join(root,'data/game-content');
let game=null;
if(fs.existsSync(contentDirectory)){
  for(const filename of fs.readdirSync(contentDirectory).filter(name=>name.endsWith('.json'))){
    const parsed=JSON.parse(fs.readFileSync(path.join(contentDirectory,filename),'utf8'));
    if(parsed?.games?.[slug]){game=parsed.games[slug];break}
  }
}
const title=requestedTitle||game?.identity?.title;
if(!title){
  console.error(`No title found for ${slug}`);
  process.exit(1);
}

const api=async url=>{
  const response=await fetch(url,{headers:{'user-agent':'Igropoisk awards importer/1.0'}});
  if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
};
const params=object=>new URLSearchParams(Object.entries(object).filter(([,value])=>value!==undefined)).toString();

async function findGameEntity(){
  const data=await api(`https://www.wikidata.org/w/api.php?${params({action:'wbsearchentities',search:title,language:'en',uselang:'en',type:'item',limit:10,format:'json',origin:'*'})}`);
  const exact=data.search?.find(item=>normalize(item.label)===normalize(title));
  return exact||data.search?.[0]||null;
}

async function loadEntities(ids){
  if(!ids.length)return{};
  const data=await api(`https://www.wikidata.org/w/api.php?${params({action:'wbgetentities',ids:ids.join('|'),props:'labels|descriptions',languages:'en|ru',format:'json',origin:'*'})}`);
  return data.entities||{};
}

function qualifierYear(claim){
  const values=[...(claim.qualifiers?.P585||[]),...(claim.qualifiers?.P580||[]),...(claim.qualifiers?.P582||[])];
  const time=values.find(value=>value?.datavalue?.value?.time)?.datavalue?.value?.time;
  const match=String(time||'').match(/[+-](\d{4})-/);
  return match?Number(match[1]):null;
}

function referenceUrl(claim,awardId){
  for(const reference of claim.references||[]){
    const value=reference.snaks?.P854?.[0]?.datavalue?.value;
    if(value)return value;
  }
  return `https://www.wikidata.org/wiki/${awardId}`;
}

async function main(){
  const entity=await findGameEntity();
  if(!entity){
    console.error(`Wikidata item not found for ${title}`);
    process.exit(2);
  }
  const entityData=await api(`https://www.wikidata.org/wiki/Special:EntityData/${entity.id}.json`);
  const item=entityData.entities?.[entity.id];
  const claims=(item?.claims?.P166||[]).filter(claim=>claim?.mainsnak?.datavalue?.value?.id);
  const awardIds=[...new Set(claims.map(claim=>claim.mainsnak.datavalue.value.id))];
  const entities=await loadEntities(awardIds);
  const awards=claims.map(claim=>{
    const awardId=claim.mainsnak.datavalue.value.id;
    const award=entities[awardId]||{};
    const name=award.labels?.ru?.value||award.labels?.en?.value||awardId;
    return{
      name,
      category:award.descriptions?.ru?.value||award.descriptions?.en?.value||'',
      year:qualifierYear(claim),
      source_name:'Wikidata',
      source_url:referenceUrl(claim,awardId),
      source_entity:`https://www.wikidata.org/wiki/${awardId}`
    };
  }).filter((award,index,list)=>award.name&&award.source_url&&list.findIndex(other=>other.name===award.name&&other.year===award.year)===index);

  const output={
    schema_version:1,
    game:{slug,title,wikidata_id:entity.id,source_url:`https://www.wikidata.org/wiki/${entity.id}`},
    checked_at:new Date().toISOString(),
    awards
  };
  const directory=path.join(root,'data/awards');
  fs.mkdirSync(directory,{recursive:true});
  const outputPath=path.join(directory,`${slug}.json`);
  fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,'utf8');
  console.log(`Saved ${awards.length} sourced award records to ${path.relative(root,outputPath)}`);
}

main().catch(error=>{console.error(error);process.exit(1)});
