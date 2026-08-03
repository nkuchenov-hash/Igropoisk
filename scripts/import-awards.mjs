import fs from 'node:fs';
import path from 'node:path';

const inputPath=process.argv[2];
if(!inputPath){
  console.error('Usage: node scripts/import-awards.mjs <parsed-awards.json>');
  process.exit(1);
}

const root=process.cwd();
const parsed=JSON.parse(fs.readFileSync(path.resolve(inputPath),'utf8'));
const records=Array.isArray(parsed)?parsed:Array.isArray(parsed.records)?parsed.records:[];
const groups=new Map();
const errors=[];
const isHttp=value=>/^https?:\/\//i.test(String(value||''));

for(const [index,record] of records.entries()){
  const slug=String(record?.game_slug||record?.slug||'').trim();
  const name=String(record?.name||record?.title||'').trim();
  const sourceUrl=String(record?.source_url||record?.url||'').trim();
  if(!slug||!name||!isHttp(sourceUrl)){
    errors.push(`Record ${index+1}: game_slug, name and HTTP source_url are required`);
    continue;
  }
  if(record.drawn_badge||record.synthetic_icon||record.generated_image){
    errors.push(`Record ${index+1}: generated award artwork is forbidden`);
    continue;
  }
  const imageUrl=String(record?.image_url||record?.logo_url||'').trim();
  if(imageUrl&&!isHttp(imageUrl)){
    errors.push(`Record ${index+1}: image_url must point to the original HTTP source asset`);
    continue;
  }
  const item={
    name,
    category:String(record?.category||record?.nomination||'').trim(),
    year:String(record?.year||record?.date||'').trim(),
    source_name:String(record?.source_name||record?.source||'').trim(),
    source_url:sourceUrl,
    image_url:imageUrl
  };
  const list=groups.get(slug)||[];
  if(!list.some(existing=>existing.name===item.name&&existing.source_url===item.source_url))list.push(item);
  groups.set(slug,list);
}

if(errors.length){
  console.error(errors.join('\n'));
  process.exit(1);
}

const outputDirectory=path.join(root,'data','awards');
fs.mkdirSync(outputDirectory,{recursive:true});
for(const [slug,awards] of groups){
  const output={game_slug:slug,checked_at:new Date().toISOString(),awards};
  fs.writeFileSync(path.join(outputDirectory,`${slug}.json`),`${JSON.stringify(output,null,2)}\n`,'utf8');
  console.log(`Imported ${awards.length} sourced award records for ${slug}`);
}
