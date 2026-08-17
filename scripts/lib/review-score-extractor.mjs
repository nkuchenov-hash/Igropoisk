const cleanNumber=value=>{
  const match=String(value??'').replace(',','.').match(/[0-9]+(?:\.[0-9]+)?/);
  const number=match?Number(match[0]):NaN;
  return Number.isFinite(number)?number:null;
};

const valid=(score,scale)=>Number.isFinite(score)&&Number.isFinite(scale)&&scale>0&&score>=0&&score<=scale&&scale<=100;
const fromPair=(score,scale,method)=>{
  const normalizedScore=cleanNumber(score),normalizedScale=cleanNumber(scale);
  return valid(normalizedScore,normalizedScale)
    ? {score:normalizedScore,scale:normalizedScale,method,scope:'editorial_review'}
    : null;
};

const visible=html=>String(html||'')
  .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;/gi,"'")
  .replace(/\s+/g,' ')
  .trim();

function inferredScale(score,source){
  const configured=Number(source?.review?.score?.default_scale);
  if(Number.isFinite(configured)&&configured>0)return configured;
  return Number(score)>10?100:10;
}

function schemaTypes(node){
  const raw=node?.['@type'];
  return (Array.isArray(raw)?raw:[raw]).filter(Boolean).map(value=>String(value).toLowerCase());
}

function ratingFromJsonLd(rootNode,source){
  let hit=null;
  const walk=(node,insideReview=false)=>{
    if(hit||node==null)return;
    if(Array.isArray(node)){for(const item of node)walk(item,insideReview);return;}
    if(typeof node!=='object')return;
    const types=schemaTypes(node);
    const reviewContext=insideReview||types.some(type=>type==='review'||type.endsWith('review'));
    if(reviewContext&&node.reviewRating&&typeof node.reviewRating==='object'){
      const rating=node.reviewRating;
      hit=fromPair(rating.ratingValue,rating.bestRating||inferredScale(rating.ratingValue,source),'jsonld.reviewRating');
      if(hit)return;
    }
    if(reviewContext&&types.some(type=>type==='rating')&&node.ratingValue!=null){
      hit=fromPair(node.ratingValue,node.bestRating||inferredScale(node.ratingValue,source),'jsonld.reviewRating');
      if(hit)return;
    }
    for(const [key,value] of Object.entries(node)){
      if(key==='aggregateRating')continue;
      walk(value,reviewContext||key==='review'||key==='reviewRating');
    }
  };
  walk(rootNode,false);
  return hit;
}

function parseJsonLd(html,source){
  for(const match of String(html||'').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    const raw=match[1].trim();
    if(!raw)continue;
    for(const candidate of [raw,raw.replace(/&quot;/g,'"').replace(/&amp;/g,'&')]){
      try{const hit=ratingFromJsonLd(JSON.parse(candidate),source);if(hit)return hit;}catch{}
    }
  }
  return null;
}

function attr(tag,name){
  return (String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`,'i'))||[])[1]||'';
}

function parseReviewMicrodata(html,source){
  const raw=String(html||'');
  for(const match of raw.matchAll(/<[^>]+itemprop=["']reviewRating["'][^>]*>[\s\S]{0,2000}?<\/[^>]+>/gi)){
    const block=match[0];
    const scoreTag=(block.match(/<[^>]+itemprop=["']ratingValue["'][^>]*>/i)||[])[0]||'';
    const bestTag=(block.match(/<[^>]+itemprop=["']bestRating["'][^>]*>/i)||[])[0]||'';
    const score=attr(scoreTag,'content')||attr(scoreTag,'value')||(block.match(/itemprop=["']ratingValue["'][^>]*>\s*([0-9.]+)/i)||[])[1];
    const scale=attr(bestTag,'content')||attr(bestTag,'value')||(block.match(/itemprop=["']bestRating["'][^>]*>\s*([0-9.]+)/i)||[])[1]||inferredScale(score,source);
    const hit=fromPair(score,scale,'microdata.reviewRating');
    if(hit)return hit;
  }
  return null;
}

function parseReviewDataAttributes(html,source){
  const raw=String(html||'');
  for(const tag of raw.match(/<[^>]+(?:data-review-score|data-review-rating)=["'][^"']+["'][^>]*>/gi)||[]){
    const score=attr(tag,'data-review-score')||attr(tag,'data-review-rating');
    const scale=attr(tag,'data-scale')||attr(tag,'data-max')||attr(tag,'data-best-rating')||inferredScale(score,source);
    const hit=fromPair(score,scale,'data-review-attribute');
    if(hit)return hit;
  }
  return null;
}

function parseConfiguredPatterns(html,source){
  const raw=String(html||''),text=visible(raw),patterns=source?.review?.score?.patterns||[];
  for(const entry of patterns){
    const pattern=typeof entry==='string'?entry:entry?.pattern;
    if(!pattern)continue;
    try{
      const rx=new RegExp(pattern,'i'),match=(entry?.html===true?raw:text).match(rx);
      if(!match)continue;
      const score=match[Number(entry?.score_group||1)];
      const scale=entry?.scale??match[Number(entry?.scale_group||2)]??inferredScale(score,source);
      const hit=fromPair(score,scale,`registry:${source.id}`);
      if(hit)return hit;
    }catch{}
  }
  return null;
}

function parseStrictEditorialLabels(html,source){
  const text=visible(html);
  const patterns=[
    /(?:overall score|final score|review score|our score|our rating|the verdict|verdict)\s*[:–—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:\/|out of)\s*(5|10|100)\b/i,
    /(?:overall score|final score|review score|our score|our rating)\s*[:–—-]?\s*([0-9]+(?:[.,][0-9]+)?)(?!\s*(?:votes?|users?|reader|community))/i,
    /(?:итоговая оценка|оценка редакции|оценка автора)\s*[:–—-]?\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*\/\s*(5|10|100))?/i
  ];
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(!match)continue;
    const score=cleanNumber(match[1]),scale=match[2]||inferredScale(score,source);
    const hit=fromPair(score,scale,'semantic-editorial-label');
    if(hit)return hit;
  }
  return null;
}

export function extractExplicitEditorialScore(html,source){
  return parseConfiguredPatterns(html,source)
    ||parseJsonLd(html,source)
    ||parseReviewMicrodata(html,source)
    ||parseReviewDataAttributes(html,source)
    ||parseStrictEditorialLabels(html,source);
}

export function isTrustedEditorialScore(item){
  const score=Number(item?.score),scale=Number(item?.scale),evidence=item?.score_evidence||{};
  if(!valid(score,scale))return false;
  if(evidence.scope!=='editorial_review')return false;
  const method=String(evidence.method||'');
  const criticIndex=(method==='historical-critic-index-attribution'||method==='critic-index-attribution')
    && evidence.index_source==='metacritic'
    && Boolean(evidence.attributed_publication)
    && evidence.aggregate_score_used!==true
    && evidence.user_score_used!==true;
  return method.startsWith('registry:')
    ||method==='jsonld.reviewRating'
    ||method==='microdata.reviewRating'
    ||method==='data-review-attribute'
    ||method==='semantic-editorial-label'
    ||criticIndex;
}

export function buildEditorialScoreEvidence(rating,{url='',configuredSourceId='',checkedAt=new Date().toISOString()}={}){
  if(!rating)return null;
  return {method:rating.method,scope:'editorial_review',checked_at:checkedAt,url,configured_source_id:configuredSourceId,direct_publisher:true};
}
