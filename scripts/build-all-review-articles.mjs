import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const writeJson=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const exists=file=>fs.existsSync(path.join(root,file));
const run=(file,args=[])=>{const result=spawnSync(process.execPath,[file,...args],{cwd:root,stdio:'inherit',env:process.env});if(result.status!==0)throw new Error(`${file} exited with ${result.status}`)};
const firstExisting=files=>files.find(exists)||null;

const catalog=readJson('data/catalog-visible.json');
const popular=['elden-ring','baldurs-gate-3','red-dead-redemption-2','the-witcher-3-wild-hunt','cyberpunk-2077','god-of-war','hades','forza-horizon-5','helldivers-2','hogwarts-legacy'];
const unique=new Map(catalog.map(game=>[game.slug,game]));
const ordered=[...popular.map(slug=>unique.get(slug)).filter(Boolean),...catalog.filter(game=>!popular.includes(game.slug))];
const only=process.env.ONLY_SLUG?.trim();
const limit=Number(process.env.BATCH_LIMIT||0);
const queue=(only?ordered.filter(game=>game.slug===only):ordered).slice(0,limit>0?limit:undefined);

const prepareScript=firstExisting(['scripts/build-review-from-request.mjs']);
const discoverScript=firstExisting(['scripts/discover-review-media.mjs']);
const enrichScript=firstExisting(['scripts/enrich-review-media.mjs']);
const validateScript=firstExisting(['scripts/validate-review-output.mjs']);
const editorialValidateScript=firstExisting(['scripts/validate-review-editorial-v1.mjs']);
const renderScript=firstExisting(['scripts/render-review-pages.mjs']);

const results=[];
const writeReport=()=>writeJson('data/parser-runs/review-batch-latest.json',{
  schema_version:3,
  review_skill_version:1,
  updated_at:new Date().toISOString(),
  total:queue.length,
  completed:results.filter(item=>item.status==='success').length,
  failed:results.filter(item=>item.status==='failed').length,
  skipped:results.filter(item=>item.status==='skipped').length,
  results
});

for(const game of queue){
  const slug=game.slug;
  const startedAt=new Date().toISOString();
  const sourcePack=`data/game-sources/${slug}.json`;
  if(!exists(sourcePack)){
    results.push({slug,status:'skipped',reason:'canonical_source_pack_missing',canonical_source_pack:sourcePack,started_at:startedAt,finished_at:new Date().toISOString()});
    writeReport();
    continue;
  }

  const request={slug,title:game.title,year:game.year,requested_at:startedAt,scope:'full_review_article',source:'catalog-visible',rebuild:true,requirements:{design_system_only:true,hero_art_only:true,media_policy:'config/parsers/review-media-policy.json',no_repeated_scenes:true,review_skill_version:1,canonical_source_pack:sourcePack,cross_model_fallback:false}};
  writeJson(`data/review-build-requests/${slug}.json`,request);
  try{
    if(!prepareScript)throw new Error('scripts/build-review-from-request.mjs is required');
    run(prepareScript,[slug]);
    if(discoverScript)run(discoverScript,[slug]);
    if(!enrichScript)throw new Error('scripts/enrich-review-media.mjs is required');
    run(enrichScript,[slug]);
    if(!validateScript)throw new Error('scripts/validate-review-output.mjs is required');
    run(validateScript,[slug]);
    if(!editorialValidateScript)throw new Error('scripts/validate-review-editorial-v1.mjs is required');
    run(editorialValidateScript,[slug]);
    if(!renderScript)throw new Error('scripts/render-review-pages.mjs is required');
    run(renderScript,[slug]);
    results.push({slug,status:'success',started_at:startedAt,finished_at:new Date().toISOString()});
  }catch(error){
    results.push({slug,status:'failed',started_at:startedAt,finished_at:new Date().toISOString(),error:String(error.message||error)});
  }
  writeReport();
}

const failed=results.filter(item=>item.status==='failed');
const skipped=results.filter(item=>item.status==='skipped');
const completed=results.filter(item=>item.status==='success');
console.log(JSON.stringify({total:results.length,completed:completed.length,failed:failed.length,skipped:skipped.length},null,2));
if(failed.length)process.exitCode=2;
