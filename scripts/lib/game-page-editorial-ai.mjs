import fs from 'node:fs';
import path from 'node:path';
import {generateFreeEditorialJSON,ensureFreeEditorialAI} from './free-editorial-ai.mjs';
import {IGROPOISK_EDITORIAL_SYSTEM,buildEditorialAudienceContext} from './igropoisk-editorial-style.mjs';

const root=process.cwd();
const read=(relative,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};

function currentAudienceContext(){
  const slug=String(process.argv[2]||'').trim();
  if(!slug)return null;
  try{
    const draft=read(`data/drafts/${slug}.json`,{});
    const parser=read(`data/parser-output/${slug}.json`,{});
    const corpus=read(`data/game-sources/${slug}.json`,{});
    const normalizedDraft=draft?.identity?.slug?draft:{...draft,identity:{...(draft.identity||{}),slug}};
    return buildEditorialAudienceContext(normalizedDraft,parser,corpus);
  }catch{return null}
}

// The current local Qwen/Ollama adapter is a runtime default, not a Game Page
// module contract. Provider/model benchmarking may replace this adapter without
// changing page-module acceptance or the internal Audience Profile contract.
export async function generateGamePageEditorialJSON(options={}){
  await ensureFreeEditorialAI();
  const audience=currentAudienceContext();
  const audienceDirective=audience
    ? `\n\nINTERNAL AUDIENCE PROFILE (never render or mention it to the reader): ${JSON.stringify(audience)}\nUse it only for register, terminology, rhythm and emphasis. Never infer demographics.`
    : '\n\nINTERNAL AUDIENCE PROFILE unavailable: use the neutral Игропоиск register and never infer demographics.';
  const result=await generateFreeEditorialJSON({
    ...options,
    system:[IGROPOISK_EDITORIAL_SYSTEM,String(options.system||'').trim()].filter(Boolean).join('\n\n'),
    prompt:`${String(options.prompt||'')}${audienceDirective}`
  });
  return {
    ...result,
    audience_profile_used:Boolean(audience),
    audience_profile_confidence:audience?.confidence||'low',
    audience_profile_visibility:'internal_only'
  };
}
