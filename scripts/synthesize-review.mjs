import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/synthesize-review.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}

const readJSON=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const exists=file=>fs.existsSync(path.join(root,file));
const writeJSON=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const checkedAt=new Date().toISOString();
const config=readJSON('config/parsers/review-synthesis.json');
const reviewsPath=`data/reviews/${slug}.json`;
const ratingPath=`data/ratings/${slug}.json`;
const gamePath=`data/drafts/${slug}.json`;
if(!exists(reviewsPath)||!exists(ratingPath)||!exists(gamePath)){console.error('Verified reviews, rating output and game draft are required before synthesis');process.exit(1)}

const reviews=readJSON(reviewsPath);
const rating=readJSON(ratingPath);
const game=readJSON(gamePath);
const gate=config.publication_gate||{};
const requiredEditorial=Number(gate.editorial_reviews_required||20);
const requiredPublications=Number(gate.independent_publications_required||requiredEditorial);
const requiredScreenshots=Number(gate.verified_screenshots_required||6);
const minimumSections=Number(gate.minimum_sections||8);
const maximumSections=Number(gate.maximum_sections||10);
const minimumWords=Number(gate.minimum_article_words||2000);
const configuredEditorial=(config.sources||[]).filter(source=>source.enabled!==false&&source.family==='editorial');
const verifiedMedia=[game.media?.hero,game.media?.cover,...(game.media?.screenshots||[]),...(game.media?.artwork||[])].filter(Boolean);

const canonicalUrl=value=>{try{const url=new URL(value);url.hash='';['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(key=>url.searchParams.delete(key));return `${url.origin}${url.pathname.replace(/\/$/,'')}${url.search}`}catch{return String(value||'').trim()}};
const hostname=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const configuredDomains=[...new Set(configuredEditorial.map(source=>hostname(source.url)).filter(Boolean))];
const allowedDomain=domain=>configuredDomains.some(configured=>domain===configured||domain.endsWith(`.${configured}`)||configured.endsWith(`.${domain}`));
const allowedImages=new Set(verifiedMedia.map(canonicalUrl));
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’-]+/g)||[]).length;

async function callOpenAI(body){
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const result=await response.json();
  const outputText=result.output_text||result.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('The model returned no structured output');
  return JSON.parse(outputText);
}

const imageSchema={
  type:'object',additionalProperties:false,
  required:['url','alt','caption','source_name','source_url','reason'],
  properties:{
    url:{type:'string'},alt:{type:'string'},caption:{type:'string'},
    source_name:{type:'string'},source_url:{type:'string'},reason:{type:'string'}
  }
};
const schema={
  type:'object',additionalProperties:false,
  required:['title','dek','author','published_at','hero','lead','sections','sources','methodology','claim_sources'],
  properties:{
    title:{type:'string'},dek:{type:'string'},author:{type:'string'},published_at:{type:'string'},hero:{type:'string'},lead:{type:'string'},
    sections:{type:'array',minItems:minimumSections,maxItems:maximumSections,items:{
      type:'object',additionalProperties:false,required:['id','heading','paragraphs','image'],
      properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:3,items:{type:'string'}},image:imageSchema}
    }},
    sources:{type:'array',minItems:requiredEditorial,items:{
      type:'object',additionalProperties:false,required:['name','publication','url','purpose','type'],
      properties:{name:{type:'string'},publication:{type:'string'},url:{type:'string'},purpose:{type:'string'},type:{type:'string',enum:['editorial','official','aggregate','media']}}
    }},
    methodology:{type:'string'},
    claim_sources:{type:'array',minItems:8,items:{
      type:'object',additionalProperties:false,required:['claim','urls'],
      properties:{claim:{type:'string'},urls:{type:'array',minItems:1,items:{type:'string'}}}
    }}
  }
};

const input=`You are the Игропоиск editorial research and review synthesizer. Write in Russian.

PUBLICATION GATE
- A finished article requires at least ${requiredEditorial} unique professional game reviews from at least ${requiredPublications} independent publications.
- The article must contain ${minimumSections}-${maximumSections} substantive thematic sections and at least ${minimumWords} Russian words.
- Official pages, stores, Metacritic, OpenCritic and user reviews do not count toward the editorial gate.
- Prefer the direct canonical review URLs already present in SEED REVIEW RECORDS. Search only to verify or replace broken/incorrect links.
- Review hubs are not evidence when a direct game-specific review exists.
- Syndicated copies, translations of the same article and multiple URLs for one publication count once.
- Every editorial source in the final JSON must materially affect a claim or comparison. Do not pad the list.

WRITING METHOD
- Explain what the game is, its normal play rhythm, characters, world, quests, monster contracts, combat, progression, interface, presentation, technical state and who should play it.
- Build a comparison matrix of agreements, disagreements, minority views, platform-specific issues and factual claims.
- Organize the article by game systems and player experience, never source by source.
- Each section must contain a thesis, concrete explanation, limitations and conclusion.
- Select only images from VERIFIED MEDIA. The visual subject must match the section: a combat section needs visible combat, a character section may use a portrait, exploration needs travel or landscape.
- Put a relevant screenshot inside every section and explain the choice in image.reason.
- Map major claims to direct source URLs.
- Put all materially used sources at the end through the sources array.
- Do not invent quotes, facts, scores, dates or links.
- No sentence may copy more than 12 consecutive words from a source.
- The final score is assigned by code from the rating parser and must not be argued from one review.

CONFIGURED EDITORIAL PUBLICATIONS:
${JSON.stringify(configuredEditorial,null,2)}

SEED REVIEW RECORDS:
${JSON.stringify(reviews.reviews||[],null,2)}

RATING CALCULATION:
${JSON.stringify(rating,null,2)}

VERIFIED GAME FACTS:
${JSON.stringify({identity:game.identity,release:game.release,companies:game.companies,classification:game.classification,editorial:game.editorial,requirements:game.requirements,links:game.links},null,2)}

VERIFIED MEDIA URLS:
${JSON.stringify(verifiedMedia,null,2)}`;

const article=await callOpenAI({
  model:process.env.OPENAI_MODEL||'gpt-5',
  tools:[{type:'web_search'}],
  input,
  text:{format:{type:'json_schema',name:'igropoisk_review_article',strict:true,schema}}
});
article.slug=slug;
article.game_slug=slug;
article.score=rating.calculation?.score_10;
article.hero=allowedImages.has(canonicalUrl(article.hero))?article.hero:(game.media?.hero||game.media?.screenshots?.[0]||game.media?.cover||'');

const editorialSources=(article.sources||[]).filter(source=>source.type==='editorial');
const acceptedEditorial=[];
const rejected=[];
const seenUrls=new Set();
const seenPublications=new Set();
for(const source of editorialSources){
  const url=canonicalUrl(source.url);
  const publication=String(source.publication||source.name||'').trim().toLowerCase();
  const domain=hostname(url);
  const reasons=[];
  if(!url.startsWith('http'))reasons.push('invalid URL');
  if(!allowedDomain(domain))reasons.push('publication is outside configured source list');
  if(seenUrls.has(url))reasons.push('duplicate URL');
  if(seenPublications.has(publication))reasons.push('duplicate publication');
  if(reasons.length){rejected.push({source,reasons});continue}
  seenUrls.add(url);
  seenPublications.add(publication);
  acceptedEditorial.push({...source,url});
}

const validSections=[];
for(const section of article.sections||[]){
  const imageUrl=canonicalUrl(section.image?.url);
  const reasons=[];
  if(!allowedImages.has(imageUrl))reasons.push('image is outside verified media set');
  if(countWords(section.image?.reason)<5)reasons.push('image selection reason is too vague');
  if((section.paragraphs||[]).length<3)reasons.push('section is too short');
  if(reasons.length){rejected.push({section:section.id,reasons});continue}
  validSections.push(section);
}

let imageAudit={results:[],error:null};
if(validSections.length){
  const auditSchema={
    type:'object',additionalProperties:false,required:['results'],
    properties:{results:{type:'array',minItems:validSections.length,maxItems:validSections.length,items:{
      type:'object',additionalProperties:false,required:['section_id','matches','confidence','visible_subject','explanation'],
      properties:{section_id:{type:'string'},matches:{type:'boolean'},confidence:{type:'number'},visible_subject:{type:'string'},explanation:{type:'string'}}
    }}}
  };
  const content=[{type:'input_text',text:'Проверь, соответствует ли каждый официальный скриншот теме и тексту раздела. Боевой раздел должен показывать реальное сражение или явную боевую ситуацию. Портрет персонажа не подходит для боя, интерфейса или исследования. Верни результаты в том же порядке.'}];
  for(const section of validSections){
    content.push({type:'input_text',text:`SECTION_ID: ${section.id}\nHEADING: ${section.heading}\nTEXT: ${(section.paragraphs||[]).join('\n')}\nAUTHOR_REASON: ${section.image.reason}`});
    content.push({type:'input_image',image_url:section.image.url});
  }
  try{
    imageAudit=await callOpenAI({
      model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',
      input:[{role:'user',content}],
      text:{format:{type:'json_schema',name:'igropoisk_image_relevance_audit',strict:true,schema:auditSchema}}
    });
  }catch(error){
    imageAudit={results:[],error:error.message};
    rejected.push({stage:'image-audit',reasons:[error.message]});
  }
}

const auditById=new Map((imageAudit.results||[]).map(item=>[item.section_id,item]));
for(const section of validSections){
  const audit=auditById.get(section.id);
  if(!audit||audit.matches!==true||Number(audit.confidence)<0.7){
    rejected.push({section:section.id,reasons:['image does not semantically match section'],audit:audit||null});
  }
}
const auditedSections=validSections.filter(section=>{
  const audit=auditById.get(section.id);
  return audit?.matches===true&&Number(audit.confidence)>=0.7;
});
const claimUrls=new Set((article.claim_sources||[]).flatMap(item=>item.urls||[]).map(canonicalUrl));
const materiallyUsed=acceptedEditorial.filter(source=>claimUrls.has(canonicalUrl(source.url))).length;
const articleWordCount=countWords(article.lead)+auditedSections.reduce((sum,section)=>sum+(section.paragraphs||[]).reduce((subtotal,paragraph)=>subtotal+countWords(paragraph),0),0);
const uniqueImages=new Set(auditedSections.map(section=>canonicalUrl(section.image.url))).size;
const passed=
  acceptedEditorial.length>=requiredEditorial&&
  seenPublications.size>=requiredPublications&&
  auditedSections.length>=minimumSections&&
  auditedSections.length<=maximumSections&&
  articleWordCount>=minimumWords&&
  uniqueImages>=requiredScreenshots&&
  materiallyUsed>=requiredEditorial&&
  !imageAudit.error;

article.sections=auditedSections;
article.sources=[...acceptedEditorial,...(article.sources||[]).filter(source=>source.type!=='editorial')];
article.publication_status=passed?'published':'blocked';
article.reading_time_minutes=Math.max(1,Math.ceil(articleWordCount/180));
article.source_gate={required_editorial:requiredEditorial,accepted_editorial:acceptedEditorial.length,required_publications:requiredPublications,accepted_publications:seenPublications.size,passed};
article.source_coverage={configured_editorial:configuredEditorial.length,discovered:editorialSources.length,accepted_editorial:acceptedEditorial.length,rejected:rejected.length,materially_used:materiallyUsed};
article.validation={
  checked_at:checkedAt,
  required_sections:minimumSections,
  accepted_sections:auditedSections.length,
  minimum_words:minimumWords,
  accepted_words:articleWordCount,
  required_screenshots:requiredScreenshots,
  accepted_unique_screenshots:uniqueImages,
  image_audit:imageAudit,
  rejected
};

const run={
  parser:'review-synthesis',
  status:passed?'success':'blocked',
  game_slug:slug,
  checked_at:checkedAt,
  gate:{
    required_editorial:requiredEditorial,accepted_editorial:acceptedEditorial.length,
    required_publications:requiredPublications,accepted_publications:seenPublications.size,
    minimum_sections:minimumSections,accepted_sections:auditedSections.length,
    minimum_words:minimumWords,accepted_words:articleWordCount,
    required_screenshots:requiredScreenshots,accepted_screenshots:uniqueImages,
    materially_used:materiallyUsed,image_audit_passed:!imageAudit.error&&auditedSections.length===validSections.length,
    passed
  },
  sections:auditedSections.length,
  sources:acceptedEditorial.length,
  output:passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,
  note:passed?'20-source, length and semantic image checks passed.':'Research draft saved; publication is blocked until source, length and image relevance checks pass.'
};

if(passed)writeJSON(`data/articles/${slug}.json`,article);
else writeJSON(`data/article-drafts/${slug}.json`,article);
writeJSON('data/parser-runs/review-synthesis.json',run);
console.log(JSON.stringify(run,null,2));
