import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/discover-review-media.mjs <game-slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);
const policy=read('config/parsers/review-media-policy.json');
const balance=policy.article_balance||{};
const identity=draft.identity||{};
const title=identity.title||draft.title||slug;
const year=identity.release_year||draft.release_year||'';
const platform=(identity.platforms||draft.platforms||[]).join(' ');
const topics=['gameplay','locations','characters','combat','vehicles','interface map','missions','official screenshots','high resolution screenshots','original version screenshots'];
const queries=topics.map(topic=>`${title} ${year} ${platform} ${topic}`.trim());

async function responseJson(body){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  return JSON.parse(data.output_text);
}
const schema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:30,maxItems:160,items:{type:'object',additionalProperties:false,required:['url','source_url','source_name','caption','visual_tags'],properties:{url:{type:'string'},source_url:{type:'string'},source_name:{type:'string'},caption:{type:'string'},visual_tags:{type:'array',items:{type:'string'}}}}}}};
const result=await responseJson({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search'}],input:`Find direct URLs to a large and varied set of genuine screenshots for ${title} (${year}, ${platform}). Use official galleries, professional publications, historical game databases and image-result pages. Prefer the largest original file. Exclude covers, artwork, logos, fan art, remakes and sequels. Search intents: ${queries.join(' | ')}. Return direct jpg, jpeg, png or webp URLs and their source pages.`,text:{format:{type:'json_schema',name:'review_media_candidates',strict:true,schema}}});
const existing=(draft.media?.items||[]).filter(item=>item.kind!=='screenshot');
const seen=new Set();
const candidates=[];
for(const item of result.candidates){
  try{
    const url=new URL(item.url);
    url.hash='';
    const key=url.toString();
    if(seen.has(key))continue;
    seen.add(key);
    candidates.push({...item,kind:'screenshot'});
  }catch{}
}
write(`data/media-candidates/${slug}.json`,{schema_version:1,game_slug:slug,queries,found:candidates.length,candidates});
draft.media=draft.media||{};
draft.media.items=[...existing,...candidates];
write(draftPath,draft);
console.log(JSON.stringify({slug,queries:queries.length,candidates:candidates.length},null,2));
if(candidates.length<Number(balance.minimum_candidate_screenshots||80))process.exitCode=2;
