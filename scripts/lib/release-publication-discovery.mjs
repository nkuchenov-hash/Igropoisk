const monthMap=new Map([
  ['january',1],['jan',1],['января',1],['январь',1],
  ['february',2],['feb',2],['февраля',2],['февраль',2],
  ['march',3],['mar',3],['марта',3],['март',3],
  ['april',4],['apr',4],['апреля',4],['апрель',4],
  ['may',5],['мая',5],['май',5],
  ['june',6],['jun',6],['июня',6],['июнь',6],
  ['july',7],['jul',7],['июля',7],['июль',7],
  ['august',8],['aug',8],['августа',8],['август',8],
  ['september',9],['sep',9],['sept',9],['сентября',9],['сентябрь',9],
  ['october',10],['oct',10],['октября',10],['октябрь',10],
  ['november',11],['nov',11],['ноября',11],['ноябрь',11],
  ['december',12],['dec',12],['декабря',12],['декабрь',12],
]);
const monthToken='january|jan|января|январь|february|feb|февраля|февраль|march|mar|марта|март|april|apr|апреля|апрель|may|мая|май|june|jun|июня|июнь|july|jul|июля|июль|august|aug|августа|август|september|sept|sep|сентября|сентябрь|october|oct|октября|октябрь|november|nov|ноября|ноябрь|december|dec|декабря|декабрь';

const uniq=values=>[...new Set((values||[]).filter(Boolean))];
const decode=value=>String(value||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&ndash;|&#8211;/g,'-').replace(/&mdash;|&#8212;/g,'—').replace(/\s+/g,' ').trim();
export const normalizeReleaseTitle=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[™®©]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
export const releaseSlug=value=>normalizeReleaseTitle(value).replace(/\s+/g,'-').slice(0,100);

function iso(year,month,day){return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
function monthEnd(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
function validDate(year,month,day){return year>=2000&&year<=2100&&month>=1&&month<=12&&day>=1&&day<=monthEnd(year,month)}
function claimFromParts({year,month,day=null,raw}){
  if(!year||!month)return null;
  if(day!=null){
    if(!validDate(year,month,day))return null;
    const date=iso(year,month,day);
    return {precision:'exact',date,date_start:date,date_end:date,raw};
  }
  return {precision:'month',date:null,date_start:iso(year,month,1),date_end:iso(year,month,monthEnd(year,month)),raw};
}

export function parseCalendarDate(text,defaultYear=new Date().getUTCFullYear()){
  const input=decode(text).toLowerCase();
  let match=input.match(new RegExp(`\\b(${monthToken})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,'i'));
  if(match)return claimFromParts({year:Number(match[3]||defaultYear),month:monthMap.get(match[1].toLowerCase()),day:Number(match[2]),raw:match[0]});
  match=input.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthToken})(?:\\s+(20\\d{2}))?\\b`,'i'));
  if(match)return claimFromParts({year:Number(match[3]||defaultYear),month:monthMap.get(match[2].toLowerCase()),day:Number(match[1]),raw:match[0]});
  match=input.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(match)return claimFromParts({year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),raw:match[0]});
  match=input.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if(match)return claimFromParts({year:Number(match[3]),month:Number(match[2]),day:Number(match[1]),raw:match[0]});
  match=input.match(new RegExp(`\\b(${monthToken})\\s+(20\\d{2})\\b`,'i'));
  if(match)return claimFromParts({year:Number(match[2]),month:monthMap.get(match[1].toLowerCase()),raw:match[0]});
  return null;
}

const badTitle=/^(home|news|reviews?|games?|calendar|release dates?|upcoming games?|read more|more|next|previous|pc|playstation|xbox|nintendo|switch|steam|about|contact|login|sign in|subscribe)$/i;
function titleCandidate(value){
  const text=decode(value).replace(/\s+[|–—-]\s+(pc gamer|gamespot|ign|game informer|stopgame|vgtimes).*$/i,'').trim();
  if(text.length<2||text.length>120||badTitle.test(text))return null;
  if(/^(august|september|october|november|december|january|february|march|april|may|june|july)\s+20\d{2}$/i.test(text))return null;
  if((text.match(/\s/g)||[]).length>18)return null;
  return text;
}
function inWindow(claim,now,horizonDays){
  const key=claim?.date_start||claim?.date;
  if(!key)return false;
  const time=Date.parse(`${key}T12:00:00Z`);
  if(!Number.isFinite(time))return false;
  return time>=now-45*86400000&&time<=now+horizonDays*86400000;
}

export function extractCalendarClaims(html,{source,url,now=Date.now(),horizonDays=180}={}){
  const claims=[],seen=new Set(),yearHint=Number(String(url||'').match(/\b(20\d{2})\b/)?.[1]||new Date(now).getUTCFullYear());
  const anchorRx=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const match of String(html||'').matchAll(anchorRx)){
    const title=titleCandidate(match[2]);if(!title)continue;
    const start=Math.max(0,(match.index||0)-350),end=Math.min(String(html).length,(match.index||0)+match[0].length+350);
    const context=String(html).slice(start,end);
    const dateClaim=parseCalendarDate(context,yearHint);if(!dateClaim||!inWindow(dateClaim,now,horizonDays))continue;
    const key=`${normalizeReleaseTitle(title)}|${dateClaim.date_start}|${dateClaim.precision}`;
    if(seen.has(key))continue;seen.add(key);
    let href=match[1];try{href=new URL(href,url).href}catch{}
    claims.push({
      source_id:source.id,
      publisher_family:source.publisher_family||source.id,
      source_name:source.name,
      title,
      url:href,
      calendar_url:url,
      date_claim:dateClaim,
      platforms:uniq(source.release?.platform_focus||[]),
      confidence:dateClaim.precision==='exact'?0.72:0.62,
    });
    if(claims.length>=250)break;
  }
  return claims;
}

export function expandCalendarUrls(source,{now=new Date(),horizonDays=180}={}){
  const templates=source.release?.calendar_urls||[],urls=[];
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const months=Math.max(1,Math.min(18,Math.ceil(horizonDays/28)+1));
  for(const template of templates){
    if(template.includes('{month}')){
      for(let offset=0;offset<months;offset++){
        const date=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+offset,1));
        const platformValues=template.includes('{platform}')?(source.release?.calendar_params?.platform||['pc']):[null];
        for(const platform of platformValues)urls.push(template.replaceAll('{year}',String(date.getUTCFullYear())).replaceAll('{month}',String(date.getUTCMonth()+1)).replaceAll('{platform}',platform||''));
      }
    }else if(template.includes('{year}')){
      const end=new Date(now.getTime()+horizonDays*86400000);
      for(let year=now.getUTCFullYear();year<=end.getUTCFullYear();year++)urls.push(template.replaceAll('{year}',String(year)));
    }else urls.push(template);
  }
  return uniq(urls);
}

function mergeEvent(target,event){
  const key=item=>[item.date||'',item.date_start||'',item.date_end||'',item.precision||'tbd',item.region||'worldwide'].join('|');
  const existing=(target.events||[]).find(item=>key(item)===key(event));
  if(existing){
    existing.source_ids=uniq([...(existing.source_ids||[]),...(event.source_ids||[])]);
    existing.platforms=uniq([...(existing.platforms||[]),...(event.platforms||[])]);
    existing.confidence=Math.min(0.9,Math.max(Number(existing.confidence||0),Number(event.confidence||0))+0.04);
  }else target.events.push(event);
}

export function claimsToPublicationRecords(claims,generatedAt=new Date().toISOString()){
  const byTitle=new Map();
  for(const claim of claims||[]){
    const normalized=normalizeReleaseTitle(claim.title);if(!normalized)continue;
    let record=byTitle.get(normalized);
    if(!record){
      const slug=releaseSlug(claim.title);
      record={id:`publication:${slug}`,slug,title:claim.title,aliases:[],release_type:'full',genres:[],developer:'',publisher:'',external_ids:{steam:null,igdb:null,rawg:null},image:null,page_url:null,events:[],sources:[],editorial:{status:'draft',readiness:35,needs_review:true,has_page:false,locked_fields:[],notes:['Discovered from Publication Registry calendar; official verification required']},first_seen_at:generatedAt,last_seen_at:generatedAt};
      byTitle.set(normalized,record);
    }
    const sourceId=`publication:${claim.source_id}`;
    if(!record.sources.some(source=>source.id===sourceId))record.sources.push({id:sourceId,registry_source_id:claim.source_id,family:'editorial_calendar',priority:30,title:claim.source_name,url:claim.calendar_url,checked_at:generatedAt,date_claim:claim.date_claim.raw,status:'success'});
    mergeEvent(record,{id:`${record.slug}:worldwide:${claim.date_claim.date||claim.date_claim.date_start||'tbd'}`,date:claim.date_claim.date,date_start:claim.date_claim.date_start,date_end:claim.date_claim.date_end,precision:claim.date_claim.precision,raw_date:claim.date_claim.raw,region:'worldwide',platforms:uniq(claim.platforms||[]),status:claim.date_claim.precision==='exact'?'reported':'announced',confidence:claim.confidence,source_ids:[sourceId]});
  }
  for(const record of byTitle.values()){
    const families=uniq(record.sources.map(source=>source.registry_source_id));
    record.editorial_quality={homepage_eligible:false,quality_score:Math.min(10,4+families.length),reasons:['official_verification_required'],signals:families.length?['independent_coverage']:[],independent_source_count:families.length,source_families:families,checked_at:generatedAt};
    record.anticipation={independent_publication_count:families.length,independent_publisher_families:families,independent_publishers:record.sources.map(source=>source.title)};
  }
  return [...byTitle.values()];
}

export function mergePublicationRecords(rawReleases,publicationRecords){
  const out=(rawReleases||[]).map(record=>JSON.parse(JSON.stringify(record)));
  const byTitle=new Map(out.map(record=>[normalizeReleaseTitle(record.title),record]));
  for(const discovered of publicationRecords||[]){
    const key=normalizeReleaseTitle(discovered.title),existing=byTitle.get(key);
    if(!existing){out.push(discovered);byTitle.set(key,discovered);continue}
    for(const source of discovered.sources||[])if(!existing.sources?.some(item=>item.id===source.id))(existing.sources||(existing.sources=[])).push(source);
    for(const event of discovered.events||[])mergeEvent(existing,event);
    const families=uniq([...(existing.editorial_quality?.source_families||[]),...(discovered.editorial_quality?.source_families||[])]);
    existing.editorial_quality={...(existing.editorial_quality||{}),source_families:families,independent_source_count:Math.max(Number(existing.editorial_quality?.independent_source_count||0),families.length),signals:uniq([...(existing.editorial_quality?.signals||[]),...(families.length?['independent_coverage']:[])])};
    existing.anticipation={...(existing.anticipation||{}),independent_publication_count:Math.max(Number(existing.anticipation?.independent_publication_count||0),families.length),independent_publisher_families:families};
  }
  return out;
}
