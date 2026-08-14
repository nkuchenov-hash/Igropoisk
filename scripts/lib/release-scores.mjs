const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const uniq=values=>[...new Set((values||[]).filter(Boolean))];
const round=value=>Number((Number(value)||0).toFixed(2));

function sourceFamily(source={}){return String(source.family||'').toLowerCase()}
function isFirstParty(source={}){return ['first_party_official','official_site','publisher','developer'].includes(sourceFamily(source))}
function isOfficialStore(source={}){return ['official_store','platform_store','platform','store'].includes(sourceFamily(source))}
function editorialFamily(source={}){
  if(source.registry_source_id)return String(source.registry_source_id);
  if(sourceFamily(source)==='editorial_calendar')return String(source.title||source.id||'editorial');
  return null;
}
function precisionFactor(precision){return ({exact:1,month:.88,quarter:.72,year:.62,tbd:.4,tba:.4}[String(precision||'tbd').toLowerCase()]||.55)}

export function scoreReleaseEvent(event,candidate={}){
  const byId=new Map((candidate.sources||[]).map(source=>[source.id,source]));
  const evidence=(event.source_ids||[]).map(id=>byId.get(id)).filter(Boolean);
  const firstParty=evidence.filter(isFirstParty);
  const officialStores=evidence.filter(isOfficialStore);
  const editorialFamilies=uniq(evidence.map(editorialFamily));
  let base=0.35,status='unverified';
  if(firstParty.length){base=1;status='first-party-confirmed'}
  else if(officialStores.length){base=.95;status='official-store-confirmed'}
  else if(editorialFamilies.length>=3){base=.9;status='editorial-consensus'}
  else if(editorialFamilies.length===2){base=.82;status='editorial-corroborated'}
  else if(editorialFamilies.length===1){base=.7;status='editorial-reported'}
  else if(Number(event.confidence)>0){base=Math.min(.68,Number(event.confidence));status='legacy-confidence'}
  const factor=precisionFactor(event.precision);
  return {
    score:round(base*factor),
    base_confidence:round(base),
    precision_factor:factor,
    precision:event.precision||'tbd',
    status,
    evidence:{first_party:firstParty.map(source=>source.id),official_store:officialStores.map(source=>source.id),editorial_families:editorialFamilies},
  };
}

export function scoreReleaseConfidence(candidate={}){
  const events=(candidate.events||[]).map(event=>({event_id:event.id||null,...scoreReleaseEvent(event,candidate)}));
  const ranked=events.slice().sort((a,b)=>b.score-a.score);
  const best=ranked[0]||{score:0,status:'unverified',precision:'tbd',evidence:{first_party:[],official_store:[],editorial_families:[]}};
  return {
    model:'release-confidence-v1',
    score:best.score,
    status:best.status,
    precision:best.precision,
    best_event_id:best.event_id||null,
    events,
    rule:'Date confidence is independent from game importance. First-party and official platform/store evidence outrank editorial consensus; date precision reduces confidence without inventing an exact day.'
  };
}

export function scoreExpected(candidate={},policy={}){
  const cfg=policy.expected_score||{};
  const notability=candidate.global_notability||{};
  const metrics=notability.metrics||{};
  const anticipation=candidate.anticipation||{};
  const quality=candidate.editorial_quality||{};
  const significance=candidate.significance||{};
  const mediaCount=Math.max(Number(candidate.media_intersection?.overall_count||0),Number(metrics.media_intersection_count||0));
  const calendarFamilies=uniq((candidate.sources||[]).filter(source=>source.family==='editorial_calendar').map(source=>source.registry_source_id||source.title||source.id)).length;
  const independent=Math.max(mediaCount,calendarFamilies,Number(quality.independent_source_count||0),Number(anticipation.independent_publication_count||0));
  const consensusPerSource=Number(cfg.consensus_points_per_source||8);
  const consensusCap=Number(cfg.consensus_cap||48);
  const consensus=clamp(independent*consensusPerSource,0,consensusCap);

  const popularScore=Number(metrics.popular_score||anticipation.popular_index||0);
  const popular=clamp(popularScore*Number(cfg.popular_multiplier||0.55),0,Number(cfg.popular_cap||14));
  const momentumRaw=Math.max(Number(metrics.global_score||0),Number(metrics.trend_score||0));
  const momentum=clamp(momentumRaw/Number(cfg.momentum_divisor||75),0,Number(cfg.momentum_cap||10));
  const discussion=clamp(Number(metrics.discussion_mentions||0)*Number(cfg.discussion_points||1.5),0,Number(cfg.discussion_cap||6));
  const historical=Number(metrics.historical_franchise_publications||anticipation.franchise_independent_publication_count||quality.franchise_independent_source_count||0);
  const franchise=clamp(historical*Number(cfg.franchise_points_per_source||1.5),0,Number(cfg.franchise_cap||8));
  const signals=new Set(significance.signals||[]);
  const page=(signals.has('igropoisk_page')?Number(cfg.game_page_points||4):0)+(signals.has('published_page')?Number(cfg.published_page_points||3):0)+(signals.has('home_quality_gate')?Number(cfg.home_quality_points||2):0);
  const steam=[...signals].some(signal=>/^steam_popular_/.test(String(signal)))?Number(cfg.steam_signal_points||4):0;
  const regionScore=Math.max(0,...Object.values(candidate.audience_affinity?.regions||{}).map(Number));
  const audience=clamp(regionScore/Number(cfg.audience_divisor||50),0,Number(cfg.audience_cap||6));
  const total=clamp(consensus+popular+momentum+discussion+franchise+page+steam+audience);
  const tier=total>=Number(cfg.marquee_minimum||70)?'marquee':total>=Number(cfg.high_minimum||50)?'high':total>=Number(cfg.notable_minimum||35)?'notable':total>=Number(cfg.watch_minimum||20)?'watch':'candidate';
  return {
    model:'expected-score-v1',score:round(total),tier,
    components:{editorial_consensus:round(consensus),popular_attention:round(popular),news_momentum:round(momentum),discussion:round(discussion),franchise:round(franchise),igropoisk_page:round(page),steam_signal:round(steam),regional_audience:round(audience)},
    metrics:{independent_publications:independent,calendar_families:calendarFamilies,media_intersection:mediaCount,popular_score:popularScore,historical_franchise_publications:historical},
    rule:'Expected score measures importance/interest only. Publication consensus is the dominant signal; Steam is capped as a minor signal and cannot substitute for editorial or official evidence.'
  };
}

export function applyReleaseScores(candidates=[],policy={}){
  return (candidates||[]).map(candidate=>({
    ...candidate,
    release_confidence:scoreReleaseConfidence(candidate),
    expected_score:scoreExpected(candidate,policy),
  }));
}
