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
const merge=(base,next)=>{
  if(!next)return base||{};
  return {...(base||{}),...next,
    identity:{...(base?.identity||{}),...(next.identity||{})},
    classification:{...(base?.classification||{}),...(next.classification||{})},
    editorial:{...(base?.editorial||{}),...(next.editorial||{})},
    relations:{...(base?.relations||{}),...(next.relations||{})}
  };
};
const contentDir=path.join(root,'data/game-content');
if(fs.existsSync(contentDir))for(const file of fs.readdirSync(contentDir).filter(name=>name.endsWith('.json'))){const payload=read(`data/game-content/${file}`,{});for(const [slug,game] of Object.entries(payload.games||{}))records.set(slug,game)}
for(const item of catalog){
  const slug=String(item.slug||'');if(!slug)continue;
  let record=records.get(slug)||{};
  record=merge(record,read(`data/parser-output/${slug}.json`));
  record=merge(record,read(`data/drafts/${slug}.json`));
  record.identity={...(record.identity||{}),slug,title:record.identity?.title||item.title||slug,game_id:record.identity?.game_id||item.game_id||''};
  records.set(slug,record);
}
const norm=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const set=value=>new Set((Array.isArray(value)?value:[value]).flatMap(item=>norm(item).split(/\s+/)).filter(Boolean));
const hitCount=(a,b)=>{let hit=0;for(const value of a)if(b.has(value))hit++;return hit};
const overlapStrict=(a,b)=>{if(!a.size||!b.size)return 0;return hitCount(a,b)/Math.max(a.size,b.size)};
const overlapContainment=(a,b)=>{if(!a.size||!b.size)return 0;return hitCount(a,b)/Math.min(a.size,b.size)};
const strictSimilarityFields=new Set(['mechanics','semantic_tokens']);
const textOf=game=>[game?.editorial?.short_description,game?.editorial?.integrated_description,...(game?.editorial?.features||[]),...(game?.classification?.categories||[]),...(game?.classification?.genres||[])].filter(Boolean).join(' ');
const keywordMap={
  gameplay_type:{rpg:['role playing','role-playing','rpg','ролевая','ролевая игра'],strategy:['strategy','стратег'],action:['action','экшен'],adventure:['adventure','приключ'],simulation:['simulation','simulator','симуля'],survival:['survival','выжив'],platformer:['platformer','платформ'],shooter:['shooter','fps','tps','шутер']},
  combat:{'turn-based':['turn based','turn-based','пошаг'],tactical:['tactical','тактич'],realtime:['real time','real-time','fast paced','fast-paced','реальн времени','высокий темп'],shooter:['shooter','fps','стрел','шутер'],melee:['melee','ближн бой']},
  perspective:{first_person:['first person','first-person','fps','от первого'],third_person:['third person','third-person','tps','от третьего'],isometric:['isometric','изометр'],top_down:['top down','top-down','сверху'],side_view:['side view','side-view','вид сбоку']},
  world_structure:{open_world:['open world','открыт мир'],linear:['linear','линей'],hub:['hub','хаб'],sandbox:['sandbox','песочн'],level_based:['levels','missions','level based','level-based','уровн','мисси']},
  party_mode:{party:['party','companions','party-based','отряд','спутник'],solo:['solo','single character','single-player','single player','одиноч']},
  narrative:{choice_driven:['choice','reactive','branching','choices matter','выбор','ветв'],story_heavy:['story rich','story-rich','narrative','campaign','сюжет','истори']},
  progression:{rpg_progression:['level','skill','build','progression','upgrade','прокач','уров'],loot:['loot','gear','добыч','экипиров']},
  setting:{fantasy:['fantasy','фэнтези'],scifi:['sci fi','sci-fi','science fiction','space','mars','космич','научн фантаст'],historical:['historical','историч'],modern:['modern','современн'],postapoc:['post apocalyptic','post-apocalyptic','постапок']},
  tone:{dark:['dark','grim','violent','мрач'],comedy:['comedy','humor','комед','юмор'],horror:['horror','hell','demon','ужас','хоррор']},
  multiplayer:{coop:['co-op','coop','cooperative','кооперат'],competitive:['pvp','competitive','multi-player','multiplayer','соревнов'],singleplayer:['single-player','single player','singleplayer','campaign','одиночн']}
};
function inferred(field,text){const out=[];const lower=norm(text);for(const [label,terms] of Object.entries(keywordMap[field]||{}))if(terms.some(term=>lower.includes(norm(term))))out.push(label);return out}
function profile(game){
  const explicit=game?.relations?.similarity_profile||{};const text=textOf(game);
  const franchise=game?.relations?.franchise?.name||game?.classification?.franchise||game?.classification?.series||'';
  const semanticTokens=[...set(text)].filter(token=>token.length>=5).slice(0,100);
  return {
    genres:set(explicit.genres||game?.classification?.genres||[]),
    subgenres:set(explicit.subgenres||game?.classification?.subgenres||game?.classification?.categories||[]),
    gameplay_type:set(explicit.gameplay_type||explicit.gameplay||inferred('gameplay_type',text)),
    combat:set(explicit.combat||inferred('combat',text)),
    perspective:set(explicit.perspective||inferred('perspective',text)),
    world_structure:set(explicit.world_structure||inferred('world_structure',text)),
    party_mode:set(explicit.party_mode||inferred('party_mode',text)),
    narrative:set(explicit.narrative||inferred('narrative',text)),
    progression:set(explicit.progression||inferred('progression',text)),
    setting:set(explicit.setting||inferred('setting',text)),
    tone:set(explicit.tone||inferred('tone',text)),
    multiplayer:set(explicit.multiplayer||inferred('multiplayer',text)),
    mechanics:set(explicit.mechanics||game?.editorial?.features||game?.classification?.categories||[]),
    semantic_tokens:set(explicit.semantic_tokens||semanticTokens),
    franchise:norm(franchise)
  };
}
const reasonLabels={genres:'жанр',subgenres:'поджанр',gameplay_type:'тип геймплея',combat:'боевая система',perspective:'перспектива',world_structure:'структура мира',party_mode:'партия/соло',narrative:'нарратив',progression:'прогрессия',setting:'сеттинг',tone:'тон',multiplayer:'мультиплеер',mechanics:'ключевые механики',semantic_tokens:'смысловое сходство'};
const profileAxes=['genres','subgenres','gameplay_type','combat','perspective','world_structure','party_mode','narrative','progression','setting','tone','multiplayer','mechanics'];
function profileQuality(value){const populated=profileAxes.filter(field=>(value[field]?.size||0)>0);return{populated_axes:populated.length,total_axes:profileAxes.length,populated,needs_enrichment:populated.length<5}}
function compare(a,b){
  let score=0;const reasons=[];
  for(const [field,weight] of Object.entries(weights)){
    const left=a[field]||new Set(),right=b[field]||new Set();
    const value=strictSimilarityFields.has(field)?overlapStrict(left,right):overlapContainment(left,right);
    score+=Number(weight||0)*value;
    if(value>=0.35)reasons.push({field,label:reasonLabels[field]||field,overlap:Number(value.toFixed(3))});
  }
  const sameSeries=a.franchise&&b.franchise&&a.franchise===b.franchise;const base=score;
  if(sameSeries&&(!config.series_requires_other_similarity||base>=Number(config.minimum_score||0.34)*0.6)){score+=Number(config.series_weight||0.05);reasons.push({field:'series',label:'та же серия',overlap:1})}
  return{score:Number(score.toFixed(4)),base_score:Number(base.toFixed(4)),reasons:reasons.sort((x,y)=>y.overlap-x.overlap).slice(0,5)};
}
const targets=requested?[requested]:catalog.map(item=>item.slug).filter(Boolean);
let written=0,profilesNeedingEnrichment=0,gamesWithoutRecommendations=0;
for(const slug of targets){
  const source=records.get(slug);if(!source)continue;const sourceProfile=profile(source);const quality=profileQuality(sourceProfile);if(quality.needs_enrichment)profilesNeedingEnrichment++;const recommendations=[];
  for(const item of catalog){if(!item.slug||item.slug===slug)continue;const candidate=records.get(item.slug);if(!candidate)continue;const result=compare(sourceProfile,profile(candidate));if(result.score<Number(config.minimum_score||0.34))continue;recommendations.push({slug:item.slug,title:candidate?.identity?.title||item.title,year:item.year||Number(String(candidate?.release?.date||candidate?.release?.date_text||'').match(/\d{4}/)?.[0]||0),score:result.score,base_score:result.base_score,reasons:result.reasons.map(reason=>reason.label),signals:result.reasons})}
  recommendations.sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title),'ru'));if(!recommendations.length)gamesWithoutRecommendations++;
  write(`data/similarity/${slug}.json`,{schema_version:3,game_slug:slug,generated_at:new Date().toISOString(),algorithm:'weighted-structured-semantic-v3',year_proximity_used:false,series_alone_can_qualify:false,profile_quality:quality,profile:Object.fromEntries(Object.entries(sourceProfile).map(([key,value])=>[key,value instanceof Set?[...value]:value])),recommendations:recommendations.slice(0,Number(config.maximum_results||12))});written++;
}
console.log(JSON.stringify({catalog_games:catalog.length,profiles:records.size,similarity_files_written:written,profiles_needing_enrichment:profilesNeedingEnrichment,games_without_recommendations:gamesWithoutRecommendations,year_proximity_used:false},null,2));
