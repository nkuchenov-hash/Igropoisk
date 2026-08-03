import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/discover-review-media.mjs <game-slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const articlePath=fs.existsSync(path.join(root,`data/articles/${slug}.json`))?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
const draft=read(draftPath);
const article=read(articlePath);
const policy=read('config/parsers/review-media-policy.json');
const quality=policy.quality_gate||{};
const discovery=policy.discovery_policy||{};
const balance=policy.article_balance||{};
const identity=draft.identity||{};
const title=identity.title||draft.title||slug;
const year=Number(identity.release_year||draft.release_year||0);
const platform=(identity.platforms||draft.platforms||['PC']).join(' ');
const minPerSection=Number(balance.screenshots_per_section?.minimum||3);
const targetCandidates=Math.max(Number(balance.target_candidate_screenshots||120),(article.sections||[]).length*minPerSection*4);
const minWidth=Number(quality.minimum_width_historical||480);
const minHeight=Number(quality.minimum_height_historical||480);
const minBytes=Number(quality.minimum_bytes_historical||25000);
const maxBytes=Number(quality.maximum_download_bytes||25000000);
const providers=discovery.provider_order||['google_images','yandex_images','bing_images','official_galleries','historical_archives'];
const canonical=value=>{try{const url=new URL(value);url.hash='';return `${url.origin}${url.pathname}${url.search}`}catch{return String(value||'')}};

async function responseJson(body){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  return JSON.parse(data.output_text);
}
function dimensions(buffer,type){
  if(type.includes('png')&&buffer.length>24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(type.includes('jpeg')||type.includes('jpg')){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff){i++;continue}const marker=buffer[i+1];const length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};if(!length)break;i+=2+length}}
  if(type.includes('webp')&&buffer.length>30&&buffer.toString('ascii',12,16)==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
  return {width:0,height:0};
}
async function probe(item){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(item.url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 IgropoiskMediaAudit/2.0'}});
    if(!response.ok)return null;
    const mime=(response.headers.get('content-type')||'').toLowerCase();
    if(!mime.startsWith('image/'))return null;
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>maxBytes||buffer.length<minBytes)return null;
    const measured=dimensions(buffer,mime);
    if(measured.width<minWidth||measured.height<minHeight)return null;
    return {...item,url:response.url,mime,bytes:buffer.length,width:measured.width,height:measured.height,aspect_ratio:measured.width/measured.height};
  }catch{return null}finally{clearTimeout(timer)}
}

const schema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:10,maxItems:120,items:{type:'object',additionalProperties:false,required:['url','source_url','source_name','caption','visual_tags'],properties:{url:{type:'string'},source_url:{type:'string'},source_name:{type:'string'},caption:{type:'string'},visual_tags:{type:'array',items:{type:'string'}}}}}}};
const sections=(article.sections||[]).map(section=>({id:section.id,heading:section.heading,text:(section.paragraphs||[]).join(' ')}));
const seen=new Set();
const approved=[];
let round=0;
while(approved.length<targetCandidates){
  const provider=providers[round%providers.length];
  const section=sections[round%Math.max(1,sections.length)]||{heading:'gameplay',text:''};
  const intent=[section.heading,'gameplay screenshot','high quality original','PC',year,provider.replaceAll('_',' ')].join(' ');
  const result=await responseJson({
    model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',
    tools:[{type:'web_search'}],
    input:`Search the public web specifically for genuine screenshots of ${title} (${year}, ${platform}) for the review section "${section.heading}". Search independently from the text-review sources. Provider/search route for this round: ${provider}. Use image-search result pages, direct image pages, official galleries, press kits, historical archives, game databases and editorial galleries. Prefer the largest original file, follow thumbnails to originals, exclude remakes, sequels, artwork, covers, logos, tiny previews, visibly blurred files, stretched files and duplicate scenes. Search intent: ${intent}. Return direct jpg, jpeg, png or webp URLs plus the page where each was found.`,
    text:{format:{type:'json_schema',name:'review_media_candidates',strict:true,schema}}
  });
  const fresh=[];
  for(const item of result.candidates||[]){const key=canonical(item.url);if(!key||seen.has(key))continue;seen.add(key);fresh.push({...item,kind:'screenshot',search_provider:provider,search_round:round+1,section_hint:section.id});}
  for(let i=0;i<fresh.length;i+=8){const measured=await Promise.all(fresh.slice(i,i+8).map(probe));approved.push(...measured.filter(Boolean));}
  round++;
  write(`data/media-candidates/${slug}.json`,{schema_version:3,game_slug:slug,search_rounds:round,providers,approved_count:approved.length,target_candidates:targetCandidates,candidates:approved});
  if(round%providers.length===0&&approved.length<targetCandidates)console.log(`Expanding search: ${approved.length}/${targetCandidates} candidates after ${round} rounds`);
}

draft.media=draft.media||{};
const nonScreenshots=(draft.media.items||[]).filter(item=>item.kind!=='screenshot');
draft.media.items=[...nonScreenshots,...approved];
write(draftPath,draft);
console.log(JSON.stringify({slug,rounds:round,approved:approved.length,target:targetCandidates},null,2));
