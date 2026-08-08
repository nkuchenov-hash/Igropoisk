import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const writeJson=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const exists=file=>fs.existsSync(path.join(root,file));
const run=(file,args=[])=>{if(!exists(file))throw new Error(`Missing required script: ${file}`);const result=spawnSync(process.execPath,[file,...args],{cwd:root,stdio:'inherit',env:process.env});if(result.status!==0)throw new Error(`${file} exited with ${result.status}`)};

const catalog=readJson('data/catalog-visible.json');
const popular=['elden-ring','baldurs-gate-3','red-dead-redemption-2','the-witcher-3-wild-hunt','cyberpunk-2077','god-of-war','hades','forza-horizon-5','helldivers-2','hogwarts-legacy'];
const unique=new Map(catalog.map(game=>[game.slug,game]));
const ordered=[...popular.map(slug=>unique.get(slug)).filter(Boolean),...catalog.filter(game=>!popular.includes(game.slug))];
const only=process.env.ONLY_SLUG?.trim();
const limit=Number(process.env.BATCH_LIMIT||0);
const queue=(only?ordered.filter(game=>game.slug===only):ordered).slice(0,limit>0?limit:undefined);

const steps=[
  ['game-page','scripts/build-game-page-from-registry.mjs'],
  ['game-videos','scripts/enrich-game-videos.mjs'],
  ['review-research','scripts/prepare-review-research.mjs'],
  ['rating','scripts/calculate-ratings-from-research.mjs'],
  ['review-media-discovery','scripts/discover-review-media.mjs'],
  ['review-media-enrichment','scripts/enrich-review-media.mjs'],
  ['review-synthesis','scripts/run-review-synthesis.mjs'],
  ['review-validation','scripts/validate-review-output.mjs'],
  ['review-render','scripts/render-review-pages.mjs']
];

const results=[];
for(const game of queue){
  const slug=game.slug;
  const request={slug,title:game.title,year:game.year,requested_at:new Date().toISOString(),scope:'full_game_page_and_review',source:'catalog-visible',rebuild:true,requirements:{design_system_only:true,minimum_unique_screenshots_per_section:3,no_repeated_scenes:true,video_categories:['trailer','gameplay','review','interview','other'],review_voice:'analytical_with_light_irony'}};
  writeJson(`data/review-build-requests/${slug}.json`,request);
  const startedAt=new Date().toISOString();
  const stepResults=[];
  try{
    for(const [name,file] of steps){
      const stepStartedAt=new Date().toISOString();
      run(file,[slug]);
      stepResults.push({name,status:'success',started_at:stepStartedAt,finished_at:new Date().toISOString()});
    }
    const pageExists=exists(`game/${slug}/index.html`);
    const articleExists=exists(`article/${slug}/index.html`)&&exists(`data/articles/${slug}.json`);
    if(!pageExists||!articleExists)throw new Error(`Materialization incomplete: page=${pageExists}, article=${articleExists}`);
    results.push({slug,status:'success',started_at:startedAt,finished_at:new Date().toISOString(),page:`game/${slug}/index.html`,article:`article/${slug}/index.html`,steps:stepResults});
  }catch(error){
    stepResults.push({name:steps[stepResults.length]?.[0]||'materialization-check',status:'failed',finished_at:new Date().toISOString(),error:String(error.message||error)});
    results.push({slug,status:'failed',started_at:startedAt,finished_at:new Date().toISOString(),error:String(error.message||error),steps:stepResults});
  }
  writeJson('data/parser-runs/review-batch-latest.json',{schema_version:2,updated_at:new Date().toISOString(),total:queue.length,completed:results.filter(item=>item.status==='success').length,failed:results.filter(item=>item.status==='failed').length,results});
}

const failed=results.filter(item=>item.status==='failed');
console.log(JSON.stringify({total:results.length,completed:results.length-failed.length,failed:failed.length},null,2));
if(failed.length)process.exitCode=2;
