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
if(!exists(ratingPath)||!exists(gamePath)){console.error('Rating output and verified game draft are required before synthesis');process.exit(1)}

const reviews=exists(reviewsPath)?readJSON(reviewsPath):{reviews:[]};
const rating=readJSON(ratingPath);
const game=readJSON(gamePath);
const gate=config.publication_gate||{};
const requiredEditorial=Number(gate.editorial_reviews_required||20);
const requiredPublications=Number(gate.independent_publications_required||requiredEditorial);
const requiredScreenshots=Number(gate.verified_screenshots_required||4);
const configuredEditorial=(config.sources||[]).filter(source=>source.enabled!==false&&source.family==='editorial');
const verifiedMedia=[game.media?.hero,game.media?.cover,...(game.media?.screenshots||[]),...(game.media?.artwork||[])].filter(Boolean);

const canonicalUrl=value=>{try{const url=new URL(value);url.hash='';['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(key=>url.searchParams.delete(key));return `${url.origin}${url.pathname.replace(/\/$/,'')}${url.search}`}catch{return String(value||'').trim()}};
const hostname=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const configuredDomains=[...new Set(configuredEditorial.map(source=>hostname(source.url)).filter(Boolean))];
const allowedDomain=domain=>configuredDomains.some(configured=>domain===configured||domain.endsWith(`.${configured}`)||configured.endsWith(`.${domain}`));
const allowedImages=new Set(verifiedMedia.map(canonicalUrl));

const schema={
  type:'object',additionalProperties:false,
  required:['slug','game_slug','title','dek','author','published_at','score','hero','lead','publication_status','source_gate','sections','sources','methodology','claim_sources','source_coverage'],
  properties:{
    slug:{type:'string'},game_slug:{type:'string'},title:{type:'string'},dek:{type:'string'},author:{type:'string'},published_at:{type:'string'},score:{type:'number'},hero:{type:'string'},lead:{type:'string'},publication_status:{type:'string'},
    source_gate:{type:'object',additionalProperties:false,required:['required_editorial','accepted_editorial','required_publications','accepted_publications','passed'],properties:{required_editorial:{type:'integer'},accepted_editorial:{type:'integer'},required_publications:{type:'integer'},accepted_publications:{type:'integer'},passed:{type:'boolean'}}},
    sections:{type:'array',minItems:Number(gate.minimum_sections||4),maxItems:Number(gate.maximum_sections||7),items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','image'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:2,items:{type:'string'}},image:{type:'object',additionalProperties:false,required:['url','alt','caption','source_name','source_url','reason'],properties:{url:{type:'string'},alt:{type:'string'},caption:{type:'string'},source_name:{type:'string'},source_url:{type:'string'},reason:{type:'string'}}}}}},
    sources:{type:'array',minItems:requiredEditorial,items:{type:'object',additionalProperties:false,required:['name','publication','url','purpose','type'],properties:{name:{type:'string'},publication:{type:'string'},url:{type:'string'},purpose:{type:'string'},type:{type:'string',enum:['editorial','official','aggregate','media']}}}},
    methodology:{type:'string'},
    claim_sources:{type:'array',minItems:8,items:{type:'object',additionalProperties:false,required:['claim','urls'],properties:{claim:{type:'string'},urls:{type:'array',minItems:1,items:{type:'string'}}}}},
    source_coverage:{type:'object',additionalProperties:false,required:['configured_editorial','discovered','accepted_editorial','rejected','materially_used'],properties:{configured_editorial:{type:'integer'},discovered:{type:'integer'},accepted_editorial:{type:'integer'},rejected:{type:'integer'},materially_used:{type:'integer'}}}
  }
};

const input=`You are the Игропоиск editorial research and review synthesizer. Write in Russian.

PUBLICATION GATE
- A finished article requires at least ${requiredEditorial} unique professional game reviews from at least ${requiredPublications} independent publications.
- Official pages, stores, Metacritic, OpenCritic and user reviews do not count toward that editorial gate.
- Search the web for direct, canonical, game-specific review URLs inside the configured publication set.
- Do not use review hubs as evidence when a direct review URL can be found.
- Syndicated copies, translations of the same article and several URLs for one publication count once.
- Every editorial source listed in the final JSON must materially affect the comparison matrix or article. Do not pad the list.
- If the gate cannot be satisfied, still return the best research draft, but set publication_status to blocked and source_gate.passed to false.

WRITING METHOD
- Build a comparison matrix of agreements, disagreements, minority views, platform-specific issues and factual claims.
- Produce an original critical review organized by game systems and player experience, not by publication.
- Use 4–7 thematic sections. Each section needs a thesis, evidence, limitations and conclusion.
- Select only images from VERIFIED MEDIA below. Put a relevant screenshot inside every section and explain why it belongs there.
- Map major claims to source URLs.
- Put all materially used sources at the end through the sources array.
- Do not invent quotes, facts, scores, dates or links.
- No sentence may copy more than 12 consecutive words from a source.
- The final score must equal ${rating.calculation?.score_10}.

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

const response=await fetch('https://api.openai.com/v1/responses',{
  method:'POST',
  headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},
  body:JSON.stringify({
    model:process.env.OPENAI_MODEL||'gpt-5',
    tools:[{type:'web_search'}],
    input,
    text:{format:{type:'json_schema',name:'igropoisk_review_article',strict:true,schema}}
  })
});
if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
const result=await response.json();
const outputText=result.output_text||result.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
if(!outputText)throw new Error('The model returned no structured article');
const article=JSON.parse(outputText);
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
  const url=canonicalUrl(source.url),publication=String(source.publication||source.name||'').trim().toLowerCase(),domain=hostname(url);
  const reasons=[];
  if(!url.startsWith('http'))reasons.push('invalid URL');
  if(!allowedDomain(domain))reasons.push('publication is outside configured source list');
  if(seenUrls.has(url))reasons.push('duplicate URL');
  if(seenPublications.has(publication))reasons.push('duplicate publication');
  if(reasons.length){rejected.push({source,reasons});continue}
  seenUrls.add(url);seenPublications.add(publication);acceptedEditorial.push({...source,url});
}

const validSections=[];
for(const section of article.sections||[]){
  if(!allowedImages.has(canonicalUrl(section.image?.url))){rejected.push({section:section.id,reasons:['image is outside verified media set']});continue}
  validSections.push(section);
}
const claimUrls=new Set((article.claim_sources||[]).flatMap(item=>item.urls||[]).map(canonicalUrl));
const materiallyUsed=acceptedEditorial.filter(source=>claimUrls.has(canonicalUrl(source.url))).length;
const passed=acceptedEditorial.length>=requiredEditorial&&seenPublications.size>=requiredPublications&&validSections.length>=Number(gate.minimum_sections||4)&&new Set(validSections.map(section=>canonicalUrl(section.image.url))).size>=requiredScreenshots&&materiallyUsed>=requiredEditorial;

article.sections=validSections;
article.sources=[...acceptedEditorial,...(article.sources||[]).filter(source=>source.type!=='editorial')];
article.publication_status=passed?'published':'blocked';
article.source_gate={required_editorial:requiredEditorial,accepted_editorial:acceptedEditorial.length,required_publications:requiredPublications,accepted_publications:seenPublications.size,passed};
article.source_coverage={configured_editorial:configuredEditorial.length,discovered:editorialSources.length,accepted_editorial:acceptedEditorial.length,rejected:rejected.length,materially_used:materiallyUsed};
article.validation={checked_at:checkedAt,required_screenshots:requiredScreenshots,accepted_sections:validSections.length,rejected};

const run={
  parser:'review-synthesis',status:passed?'success':'blocked',game_slug:slug,checked_at:checkedAt,
  gate:{required_editorial:requiredEditorial,accepted_editorial:acceptedEditorial.length,required_publications:requiredPublications,accepted_publications:seenPublications.size,required_screenshots:requiredScreenshots,accepted_screenshots:new Set(validSections.map(section=>canonicalUrl(section.image.url))).size,materially_used:materiallyUsed,passed},
  sections:validSections.length,output:passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,
  note:passed?'20-source publication gate passed.':'Research draft saved; finished article publication is blocked until the 20-source gate passes.'
};

if(passed)writeJSON(`data/articles/${slug}.json`,article);
else writeJSON(`data/article-drafts/${slug}.json`,article);
writeJSON('data/parser-runs/review-synthesis.json',run);
console.log(JSON.stringify(run,null,2));
