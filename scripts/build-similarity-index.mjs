#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const requested=process.argv[2]||'';
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const config=read('config/game-page-quality-v2.json',{}).similarity||{};
const weights=config.weights||{};
const catalog=read('data/catalog-visible.json',[]);
const records=new Map();
const contentDir=path.join(root,'data/game-content');
if(fs.existsSync(contentDir))for(const file of fs.readdirSync(contentDir).filter(name=>name.endsWith('.json'))){const payload=read(`data/game-content/${file}`,{});for(const [slug,game] of Object.entries(payload.games||{}))records.set(slug,game)}
for(const item of catalog){const draft=read(`data/drafts/${item.slug}.json`);if(draft)records.set(item.slug,{...(records.get(item.slug)||{}),...draft})}
const norm=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const set=value=>new Set((Array.isArray(value)?value:[value]).flatMap(item=>norm(item).split(/\s+/)).filter(Boolean));
const overlap=(a,b)=>{if(!a.size||!b.size)return 0;let hit=0;for(const x of a)if(b.has(x))hit++;return hit/Math.max(a.size,b.size)};
const textOf=game=>[game?.editorial?.short_description,game?.editorial?.integrated_description,...(game?.editorial?.features||[]),...(game?.classification?.categories||[]),...(game?.classification?.genres||[])].filter(Boolean).join(' ');
const keywordMap={
  combat:{'turn-based':['turn based','turn-based','пошаг'],tactical:['tactical','тактич'],realtime:['real time','real-time','реальн времени'],shooter:['shooter','стрел'],melee:['melee','ближн бой']},
  perspective:{first_person:['first person','first-person','от первого'],third_person:['third person','third-person','от третьего'],isometric:['isometric','изометр'],top_down:['top down','top-down','сверху']},
  world_structure:{open_world:['open world','открыт мир'],linear:['linear','линей'],hub:['hub','хаб'],sandbox:['sandbox','песочн']},
  party_mode:{party:['party','companions','party-based','отряд','спутник'],solo:['solo','single character','одиноч']},
  narrative:{choice_driven:['choice','reactive','branching','choices matter','выбор','ветв'],story_heavy:['story rich','narrative','сюжет','истори']},
  progression:{rpg_progression:['level','skill','build','progression','прокач','уров'],loot:['loot','gear','добыч','экипиров']},
  setting:{fantasy:['fantasy','фэнтези'],scifi:['sci fi','science fiction','космич','научн фантаст'],historical:['historical','историч'],modern:['modern','современн'],postapoc:['post apocalyptic','post-apocalyptic','постапок']},
  tone:{dark:['dark','grim','мрач'],comedy:['comedy','humor','комед','юмор'],horror:['horror','ужас','хоррор']},
  multiplayer:{coop:['co-op','coop','cooperative','кооперат'],competitive:['pvp','competitive','соревнов'],singleplayer:['single-player','singleplayer','одиночн']}
};
function inferred(field,text){const out=[];const lower=norm(text);for(const [label,terms] of Object.entries(keywordMap[field]||{}))if(terms.some(term=>lower.includes(norm(term))))out.push(label);return out}
function profile(game){
  const explicit=game?.relations?.similarity_profile||{};const text=textOf(game);
  const franchise=game?.relations?.franchise?.name||game?.classification?.franchise||game?.classification?.series||'';
  const semanticTokens=[...set(text)].filter(token=>token.length>=5).slice(0,80);
  return {
    genres:set(explicit.genres||game?.classification?.genres||[]),
    subgenres:set(explicit.subgenres||game?.classification?.subgenres||game?.classification?.categories||[]),
    gameplay_type:set(explicit.gameplay_type||explicit.gameplay||[]),
    combat:set(explicit.combat||inferred('combat',text)),
    perspective:set(explicit.perspective||inferred('perspective',text)),
    world_structure:set(explicit.world_structure||inferred('world_structure',text)),
    party_mode:set(explicit.party_mode||inferred('party_mode',text)),
    narrative:set(explicit.narrative||inferred('narrative',text)),
    progression:set(explicit.progression||inferred('progression',text)),
    setting:set(explicit.setting||inferred('setting',text)),
    tone:set(explicit.tone||inferred('tone',text)),
    multiplayer:set(explicit.multiplayer||inferred('multiplayer',text)),
    mechanics:set(explicit.mechanics||game?.editorial?.features||[]),
    semantic_tokens:set(explicit.semantic_tokens||semanticTokens),
    franchise:norm(franchise)
  };
}
const reasonLabels={genres:'жанр',subgenres:'поджанр',gameplay_type:'тип геймплея',combat:'боевая система',perspective:'перспектива',world_structure:'структура мира',party_mode:'партия/соло',narrative:'нарратив',progression:'прогрессия',setting:'сеттинг',tone:'тон',multiplayer:'мультиплеер',mechanics:'ключевые механики',semantic_tokens:'смысловое сходство'};
function compare(a,b){
  let score=0;const reasons=[];
  for(const [field,weight] of Object.entries(weights)){
    const value=overlap(a[field]||new Set(),b[field]||new Set());
    score+=Number(weight||0)*value;
    if(value>=0.45)reasons.push({field,label:reasonLabels[field]||field,overlap:Number(value.toFixed(3))});
  }
  const sameSeries=a.franchise&&b.franchise&&a.franchise===b.franchise;
  const base=score;
  if(sameSeries&&(!config.series_requires_other_similarity||base>=Number(config.minimum_score||0.34)*0.6)){score+=Number(config.series_weight||0.05);reasons.push({field:'series',label:'та же серия',overlap:1})}
  return{score:Number(score.toFixed(4)),base_score:Number(base.toFixed(4)),reasons:reasons.sort((x,y)=>y.overlap-x.overlap).slice(0,4)};
}
const targets=requested?[requested]:catalog.map(item=>item.slug).filter(Boolean);
for(const slug of targets){
  const source=records.get(slug);if(!source)continue;const sourceProfile=profile(source);const recommendations=[];
  for(const item of catalog){if(!item.slug||item.slug===slug)continue;const candidate=records.get(item.slug);if(!candidate)continue;const result=compare(sourceProfile,profile(candidate));if(result.score<Number(config.minimum_score||0.34))continue;recommendations.push({slug:item.slug,title:candidate?.identity?.title||item.title,year:item.year||Number(String(candidate?.release?.date||candidate?.release?.date_text||'').match(/\d{4}/)?.[0]||0),score:result.score,base_score:result.base_score,reasons:result.reasons.map(r=>r.label),signals:result.reasons})}
  recommendations.sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title),'ru'));
  write(`data/similarity/${slug}.json`,{schema_version:1,game_slug:slug,generated_at:new Date().toISOString(),algorithm:'weighted-structured-semantic-v1',year_proximity_used:false,series_alone_can_qualify:false,profile:Object.fromEntries(Object.entries(sourceProfile).map(([key,value])=>[key,value instanceof Set?[...value]:value])),recommendations:recommendations.slice(0,Number(config.maximum_results||12))});
  console.log(`${slug}: ${Math.min(recommendations.length,Number(config.maximum_results||12))} similarity recommendations`);
}
