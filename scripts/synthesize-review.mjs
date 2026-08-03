import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/synthesize-review.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}

const reviewsPath=path.join(root,'data','reviews',`${slug}.json`);
const ratingPath=path.join(root,'data','ratings',`${slug}.json`);
if(!fs.existsSync(reviewsPath)||!fs.existsSync(ratingPath)){console.error('Review sources and rating output are required before synthesis');process.exit(1)}
const reviews=JSON.parse(fs.readFileSync(reviewsPath,'utf8'));
const rating=JSON.parse(fs.readFileSync(ratingPath,'utf8'));
if((reviews.reviews||[]).filter(item=>item.url).length<3){console.error('At least three sourced reviews are required');process.exit(1)}

const schema={
  type:'object',additionalProperties:false,
  required:['slug','game_slug','title','dek','author','published_at','score','hero','lead','sections','sources','methodology','claim_sources'],
  properties:{
    slug:{type:'string'},game_slug:{type:'string'},title:{type:'string'},dek:{type:'string'},author:{type:'string'},published_at:{type:'string'},score:{type:'number'},hero:{type:'string'},lead:{type:'string'},
    sections:{type:'array',minItems:4,items:{type:'object',additionalProperties:false,required:['heading','paragraphs'],properties:{heading:{type:'string'},paragraphs:{type:'array',minItems:2,items:{type:'string'}}}}},
    sources:{type:'array',minItems:3,items:{type:'object',additionalProperties:false,required:['name','url'],properties:{name:{type:'string'},url:{type:'string'}}}},
    methodology:{type:'string'},
    claim_sources:{type:'array',items:{type:'object',additionalProperties:false,required:['claim','urls'],properties:{claim:{type:'string'},urls:{type:'array',items:{type:'string'}}}}}
  }
};

const input=`You are the Игропоиск editorial review synthesizer. Follow the attached source contract strictly. Write in Russian. Produce an original critical review, not a source-by-source digest. Do not invent quotes or facts. The final score must equal ${rating.calculation?.score_10}.\n\nReview source records:\n${JSON.stringify(reviews.reviews,null,2)}\n\nRating calculation:\n${JSON.stringify(rating,null,2)}\n\nAdditional rule: no sentence may copy more than 12 consecutive words from any source.`;
const response=await fetch('https://api.openai.com/v1/responses',{
  method:'POST',
  headers:{'authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},
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
article.slug=slug;article.game_slug=slug;article.score=rating.calculation.score_10;
fs.mkdirSync(path.join(root,'data','articles'),{recursive:true});
fs.writeFileSync(path.join(root,'data','articles',`${slug}.json`),`${JSON.stringify(article,null,2)}\n`);
fs.mkdirSync(path.join(root,'data','parser-runs'),{recursive:true});
fs.writeFileSync(path.join(root,'data','parser-runs','review-synthesis.json'),`${JSON.stringify({parser:'review-synthesis',status:'success',game_slug:slug,checked_at:new Date().toISOString(),sources:article.sources.length,sections:article.sections.length,output:`data/articles/${slug}.json`},null,2)}\n`);
console.log(`Published synthesized review: data/articles/${slug}.json`);
