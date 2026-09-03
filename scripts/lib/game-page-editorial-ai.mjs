import {generateFreeEditorialJSON,ensureFreeEditorialAI} from './free-editorial-ai.mjs';

const githubModel=()=>String(process.env.GITHUB_PAGE_EDITORIAL_MODEL||process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1').trim();
const stripFence=value=>String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();

async function generateGitHubEditorialJSON({system='',prompt,temperature=0.2,maxTokens=1600}){
  const token=String(process.env.GITHUB_TOKEN||'').trim();
  if(!token)throw new Error('GITHUB_TOKEN unavailable for GitHub Models');
  const model=githubModel();
  const timeoutMs=Number(process.env.GITHUB_PAGE_EDITORIAL_TIMEOUT_MS||90000);
  const response=await fetch('https://models.github.ai/inference/chat/completions',{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/vnd.github+json','x-github-api-version':'2026-03-10'},
    body:JSON.stringify({
      model,
      messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')}],
      response_format:{type:'json_object'},
      temperature,
      max_tokens:Math.max(128,Math.min(Number(maxTokens)||1600,3000))
    }),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${(await response.text()).slice(0,1200)}`);
  const payload=await response.json();
  const raw=stripFence(payload?.choices?.[0]?.message?.content||'');
  if(!raw)throw new Error('GitHub Models returned no editorial JSON');
  let data;
  try{data=JSON.parse(raw)}catch(error){throw new Error(`GitHub Models returned invalid JSON: ${error.message}`)}
  return {data,provider:'github-models',model,baseUrl:'https://models.github.ai/inference'};
}

export async function generateGamePageEditorialJSON(options={}){
  const preferGitHub=String(process.env.GAME_PAGE_EDITORIAL_PROVIDER||'github-models').toLowerCase()!=='ollama';
  if(preferGitHub&&String(process.env.GITHUB_TOKEN||'').trim()){
    try{return await generateGitHubEditorialJSON(options)}
    catch(error){console.warn(`[game-page-editorial] GitHub Models unavailable, falling back to local Qwen: ${error.message}`)}
  }
  await ensureFreeEditorialAI();
  const result=await generateFreeEditorialJSON(options);
  return {...result,provider:'local-qwen-ollama'};
}
