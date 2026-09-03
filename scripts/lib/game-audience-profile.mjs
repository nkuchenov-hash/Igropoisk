const clean=value=>String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const norm=value=>clean(value).normalize('NFKD').toLowerCase().replace(/ё/g,'е');
const uniq=values=>[...new Set(values.filter(Boolean))];
const asList=value=>Array.isArray(value)?value.map(item=>clean(typeof item==='object'?(item.name||item.label||item.value||item.title||''):item)).filter(Boolean):[];
const clampEvidence=items=>items.slice(0,80);

const ALLOWED={
  familiarity:new Set(['broad','genre_literate','hardcore','mixed','unknown']),
  jargon:new Set(['low','medium','high']),
  register:new Set(['playful','warm','neutral','technical','dark','dry','ironic','abrasive']),
  appeals:new Set(['creation','mastery','exploration','story','competition','systems','social','comfort','black_comedy']),
  spoiler:new Set(['low','medium','high','unknown'])
};

const SIGNALS=[
  {id:'creation',appeal:'creation',rx:/(creative|creation|creator|character customi[sz]ation|level editor|building|crafting|sandbox|строительств|создани|редактор|песочниц)/i},
  {id:'mastery',appeal:'mastery',rx:/(difficult|hardcore|precision|souls[- ]?like|skill[- ]?based|challenging|punishing|сложн|хардкор|мастерств|требовательн)/i},
  {id:'exploration',appeal:'exploration',rx:/(exploration|open world|metroidvania|discovery|adventure|исследован|открыт(?:ый|ого) мир|приключен)/i},
  {id:'story',appeal:'story',rx:/(story rich|narrative|visual novel|choices matter|interactive fiction|сюжет|нарратив|истори|диалог)/i},
  {id:'competition',appeal:'competition',rx:/(competitive|pvp|esports?|battle royale|ranked|fighting|соревнов|рейтинг(?:ов|овая)|киберспорт)/i},
  {id:'systems',appeal:'systems',rx:/(strategy|simulation|management|grand strategy|4x|colony sim|automation|economy|тактик|стратег|симуля|менедж|управлен|экономик|систем)/i},
  {id:'social',appeal:'social',rx:/(co[- ]?op|multiplayer|mmo|party game|social|совместн|кооператив|мультиплеер|сетев)/i},
  {id:'comfort',appeal:'comfort',rx:/(cozy|relaxing|wholesome|life sim|farming sim|уют|расслаб|ферм|спокойн)/i},
  {id:'black_comedy',appeal:'black_comedy',rx:/(black comedy|dark humor|dark humour|satire|сатир|черн(?:ый|ого) юмор|чёрн(?:ый|ого) юмор|абсурд)/i},
  {id:'horror',rx:/(survival horror|psychological horror|horror|хоррор|ужас)/i},
  {id:'family',rx:/(family friendly|family|kids|для всей семьи|семейн)/i},
  {id:'casual',rx:/(casual|accessible|казуальн|доступн(?:ая|ый) для нович)/i}
];

function pickText(item={}){
  return clean(item.excerpt||item.summary||item.snippet||item.description||item.text||item.content||item.quote||item.notes||item.title||'').slice(0,5000);
}
function explicitAggregate(...values){
  for(const value of values){
    if(value&&typeof value==='object'&&!Array.isArray(value))return structuredClone(value);
  }
  return null;
}
function normalizeExplicitProfile(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const register=asList(value.register).map(norm).filter(x=>ALLOWED.register.has(x));
  const appeals=asList(value.core_appeals).map(norm).filter(x=>ALLOWED.appeals.has(x));
  const reader=norm(value.reader_familiarity);
  const jargon=norm(value.jargon_level);
  const spoiler=norm(value.spoiler_sensitivity);
  return {
    reader_familiarity:ALLOWED.familiarity.has(reader)?reader:null,
    jargon_level:ALLOWED.jargon.has(jargon)?jargon:null,
    register:uniq(register),
    core_appeals:uniq(appeals),
    spoiler_sensitivity:ALLOWED.spoiler.has(spoiler)?spoiler:null
  };
}
function addSignal(evidence,seen,sourceKind,source,signal,value,weight=1){
  const key=[sourceKind,source,signal,norm(value)].join('|');
  if(seen.has(key))return;seen.add(key);
  evidence.push({source_kind:sourceKind,source:clean(source)||sourceKind,signal,value:clean(value),weight});
}
function detect(text){
  const out=[];for(const signal of SIGNALS)if(signal.rx.test(text))out.push(signal);return out;
}
export const extractAudienceSignalIds=value=>uniq(detect(norm(value)).map(item=>item.id));

export function neutralAudienceProfile(slug='',reason='insufficient-evidence'){
  return {schema_version:1,game_slug:clean(slug),visibility:'internal_only',generated_at:new Date().toISOString(),confidence:'low',reader_familiarity:'unknown',jargon_level:'medium',register:['neutral'],core_appeals:[],spoiler_sensitivity:'unknown',content_context:[],aggregate_demographics:null,evidence:[],generation:{mode:'deterministic-evidence-profile',ai_required:false,fail_open:true,public_render_allowed:false,status:'neutral-fallback',reason,source_families:0}};
}

export function buildGameAudienceProfile({slug='',draft={},parser={},corpus={},reviews={},knowledge={},audienceEvidence={}}={}){
  const evidence=[],seen=new Set(),appeals=new Set(),register=new Set(),contentContext=new Set(),signalIds=new Set(),families=new Set();
  const explicitRaw=audienceEvidence?.explicit_audience_profile||corpus?.audience_profile||corpus?.audience_signals?.profile||knowledge?.audience_profile||draft?.internal?.audience_profile||null;
  const explicit=normalizeExplicitProfile(explicitRaw);
  const demographics=explicitAggregate(audienceEvidence?.aggregate_demographics,corpus?.audience_signals?.aggregate_demographics,knowledge?.audience_signals?.aggregate_demographics,draft?.internal?.aggregate_demographics);
  if(explicitRaw){families.add('explicit-audience');addSignal(evidence,seen,'explicit-audience','audience_profile','explicit_profile','provided',3)}
  if(demographics){families.add('aggregate-demographics');addSignal(evidence,seen,'aggregate-demographics','licensed-aggregate-source','aggregate_demographics','provided',3)}

  const classification=draft?.classification||{};
  const collected=audienceEvidence?.descriptors||{};
  const buckets=[
    ['audience-evidence-tags','store-community-tags',asList(collected.tags)],
    ['audience-evidence-themes','game-metadata',asList(collected.themes)],
    ['audience-evidence-genres','game-metadata',asList(collected.genres)],
    ['draft-genres','game-metadata',asList(classification.genres)],
    ['draft-categories','game-metadata',asList(classification.categories)],
    ['draft-tags','store-community-tags',asList(classification.tags)],
    ['draft-themes','game-metadata',asList(classification.themes)],
    ['parser-tags','store-community-tags',asList(parser?.tags||parser?.classification?.tags)],
    ['parser-themes','game-metadata',asList(parser?.themes||parser?.classification?.themes)],
    ['corpus-tags','store-community-tags',asList(corpus?.tags||corpus?.audience_signals?.tags)],
    ['corpus-themes','game-metadata',asList(corpus?.themes)],
    ['knowledge-tags','game-knowledge',asList(knowledge?.tags||knowledge?.classification?.tags)],
    ['knowledge-themes','game-knowledge',asList(knowledge?.themes||knowledge?.classification?.themes)]
  ];
  const tagValues=[];
  for(const [source,kind,items] of buckets){for(const item of items){tagValues.push(item);families.add(kind);addSignal(evidence,seen,kind,source,'descriptor',item,kind==='store-community-tags'?2:1);for(const signal of detect(norm(item))){signalIds.add(signal.id);if(signal.appeal)appeals.add(signal.appeal)}}}

  const perspectives=uniq([...asList(classification.player_perspectives),...asList(parser?.player_perspectives||parser?.classification?.player_perspectives),...asList(corpus?.player_perspectives),...asList(knowledge?.player_perspectives)]);
  const modes=uniq([...asList(classification.game_modes),...asList(parser?.game_modes||parser?.classification?.game_modes),...asList(corpus?.game_modes),...asList(knowledge?.game_modes)]);
  for(const item of perspectives){families.add('game-metadata');addSignal(evidence,seen,'game-metadata','player_perspectives','player_perspective',item,1)}
  for(const item of modes){families.add('game-metadata');addSignal(evidence,seen,'game-metadata','game_modes','game_mode',item,1);for(const signal of detect(norm(item))){signalIds.add(signal.id);if(signal.appeal)appeals.add(signal.appeal)}}

  const reviewItems=[...(Array.isArray(reviews?.reviews)?reviews.reviews:[]),...(Array.isArray(corpus?.sources)?corpus.sources.filter(x=>x?.professional||x?.kind==='professional-review'):[])];
  for(const item of audienceEvidence?.review_signals||[]){if(!item?.signal)continue;const signal=SIGNALS.find(x=>x.id===item.signal);if(!signal)continue;families.add('professional-review-corpus');signalIds.add(signal.id);if(signal.appeal)appeals.add(signal.appeal);addSignal(evidence,seen,'professional-review-corpus',`${Number(item.independent_sources)||2} independent reviews`,'recurring_editorial_signal',signal.id,2)}
  const reviewHits=new Map();
  reviewItems.forEach((item,index)=>{
    const text=pickText(item);if(!text)return;
    for(const signal of detect(norm(text))){const key=signal.id;const set=reviewHits.get(key)||new Set();set.add(item.domain||item.publication||item.name||item.url||`review-${index+1}`);reviewHits.set(key,set)}
  });
  for(const signal of SIGNALS){const hits=reviewHits.get(signal.id);if(!hits||hits.size<2)continue;families.add('professional-review-corpus');signalIds.add(signal.id);if(signal.appeal)appeals.add(signal.appeal);addSignal(evidence,seen,'professional-review-corpus',`${hits.size} independent reviews`,'recurring_editorial_signal',signal.id,2)}

  const officialText=[parser?.editorial?.short_description,parser?.editorial?.integrated_description,draft?.editorial?.short_description,draft?.editorial?.integrated_description].map(clean).filter(Boolean).join(' ').slice(0,4000);
  if(officialText){families.add('official-editorial');for(const signal of detect(norm(officialText))){signalIds.add(signal.id);if(signal.appeal)appeals.add(signal.appeal);addSignal(evidence,seen,'official-editorial','official/store copy','positioning_signal',signal.id,1)}}

  const age=clean(audienceEvidence?.explicit_age_rating||classification.age_rating||classification.content_rating||classification.esrb||classification.pegi||draft?.age_rating||draft?.content_rating||parser?.age_rating||parser?.content_rating||'');
  const descriptors=uniq([...asList(audienceEvidence?.content_descriptors),...asList(classification.content_descriptors),...asList(parser?.content_descriptors),...asList(knowledge?.content_descriptors)]);
  if(age){families.add('content-rating');contentContext.add(age);addSignal(evidence,seen,'content-rating','age-rating','content_rating',age,1)}
  for(const item of descriptors){families.add('content-rating');contentContext.add(item);addSignal(evidence,seen,'content-rating','content-descriptor','content_context',item,1)}

  if(signalIds.has('black_comedy')){register.add('dry');register.add('ironic')}
  if(signalIds.has('horror'))register.add('dark');
  if(signalIds.has('systems'))register.add('technical');
  if(signalIds.has('family')||signalIds.has('comfort')){register.add('warm');if(signalIds.has('family'))register.add('playful')}
  if(!register.size)register.add('neutral');

  let familiarity='unknown';
  if(signalIds.has('mastery')&&(signalIds.has('systems')||signalIds.has('competition')))familiarity='hardcore';
  else if(signalIds.has('systems')||signalIds.has('competition')||signalIds.has('mastery'))familiarity='genre_literate';
  else if(signalIds.has('family')||signalIds.has('casual')||signalIds.has('comfort'))familiarity='broad';
  else if(tagValues.length>=4||appeals.size>=2)familiarity='mixed';
  let jargon=familiarity==='hardcore'?'high':familiarity==='genre_literate'?'medium':familiarity==='broad'?'low':'medium';
  let spoiler=signalIds.has('story')||signalIds.has('horror')?'high':'unknown';

  if(explicit){if(explicit.reader_familiarity)familiarity=explicit.reader_familiarity;if(explicit.jargon_level)jargon=explicit.jargon_level;if(explicit.spoiler_sensitivity)spoiler=explicit.spoiler_sensitivity;for(const x of explicit.register)register.add(x);for(const x of explicit.core_appeals)appeals.add(x)}

  const sourceFamilies=families.size;
  const confidence=(explicitRaw||demographics)?'high':(sourceFamilies>=2&&evidence.length>=4)?'medium':'low';
  return {schema_version:1,game_slug:clean(slug||draft?.identity?.slug),visibility:'internal_only',generated_at:new Date().toISOString(),confidence,reader_familiarity:familiarity,jargon_level:jargon,register:uniq([...register]).filter(x=>ALLOWED.register.has(x)),core_appeals:uniq([...appeals]).filter(x=>ALLOWED.appeals.has(x)),spoiler_sensitivity:spoiler,content_context:[...contentContext].slice(0,20),aggregate_demographics:demographics,evidence:clampEvidence(evidence),generation:{mode:'deterministic-evidence-profile',ai_required:false,fail_open:true,public_render_allowed:false,status:'built',source_families:sourceFamilies,review_items_scanned:reviewItems.length,stereotype_demographics_forbidden:true}};
}

export function validateAudienceProfile(profile){
  const errors=[];
  if(!profile||typeof profile!=='object')return['profile missing'];
  if(profile.visibility!=='internal_only')errors.push('visibility must be internal_only');
  if(!['high','medium','low'].includes(profile.confidence))errors.push('invalid confidence');
  if(!ALLOWED.familiarity.has(profile.reader_familiarity))errors.push('invalid reader_familiarity');
  if(!ALLOWED.jargon.has(profile.jargon_level))errors.push('invalid jargon_level');
  if(!Array.isArray(profile.register)||profile.register.some(x=>!ALLOWED.register.has(x)))errors.push('invalid register');
  if(!Array.isArray(profile.core_appeals)||profile.core_appeals.some(x=>!ALLOWED.appeals.has(x)))errors.push('invalid core_appeals');
  if(!ALLOWED.spoiler.has(profile.spoiler_sensitivity))errors.push('invalid spoiler_sensitivity');
  if(profile.generation?.ai_required!==false)errors.push('audience profile must not require AI');
  if(profile.generation?.fail_open!==true)errors.push('audience profile must be fail-open');
  if(profile.generation?.public_render_allowed!==false)errors.push('audience profile must not be public-renderable');
  return errors;
}
