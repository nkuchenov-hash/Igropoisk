import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/run-review-discovery-with-seeds.mjs <game-slug>');process.exit(1)}

const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=file=>fs.existsSync(path.join(root,file));
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};

const corpusPath=`data/reviews/${slug}.json`;
const seedsPath=`data/review-discovery-seeds/${slug}.json`;
if(exists(seedsPath)){
  const corpus=exists(corpusPath)?read(corpusPath):{schema_version:13,game_slug:slug,reviews:[]};
  const seeds=read(seedsPath);
  const merged=[...Array.isArray(corpus.reviews)?corpus.reviews:[],...Array.isArray(seeds.reviews)?seeds.reviews:[]];
  const seen=new Set();
  corpus.reviews=merged.filter(item=>{
    const key=canonical(item?.resolved_url||item?.url||'');
    if(!key||seen.has(key))return false;
    seen.add(key);
    return true;
  });
  write(corpusPath,corpus);
}

await import('./prepare-review-research.mjs');
