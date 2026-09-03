import process from 'node:process';
import {generateFreeEditorialJSON} from './free-editorial-ai.mjs';

const stripFence=value=>String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();

async function githubModelsJSON({system='',prompt,temperature=0.2,maxTokens=6000}){
  const token=String(process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'').trim();
  if(!token)throw new Error('GitHub Models token unavailable');
  const endpoint=String(process.env.GITHUB_MODELS_ENDPOINT||'https://models.github.ai/inference/chat/completions').trim();
  const model=String(process.env.GITHUB_GAME_PAGE_MODEL||'openai/gpt-4.1').trim();
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
    body:JSON.stringify({
      model,
      temperature,
      max_tokens:maxTokens,
      response_format:{type:'json_object'},
      messages:[...(system?[{role:'system',content:String(system)}]:[]),{role:'user',content:String(prompt||'')}]
    })
  });
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${(await response.text()).slice(0,1200)}`);
  const payload=await response.json();
  const raw=stripFence(payload?.choices?.[0]?.message?.content||'');
  if(!raw)throw new Error('GitHub Models returned empty output');
  let data;
  try{data=JSON.parse(raw)}catch(error){throw new Error(`GitHub Models returned invalid JSON: ${error.message}`)}
  return {data,provider:'github-models',model,endpoint};
}

export async function generateGamePageEditorialJSON(options={}){
  const errors=[];
  try{return await githubModelsJSON(options)}catch(error){errors.push(`github-models: ${error.message}`)}
  try{
    const result=await generateFreeEditorialJSON(options);
    return {...result,provider:'ollama-fallback'};
  }catch(error){errors.push(`ollama: ${error.message}`)}
  throw new Error(`No automatic Game Page editorial provider succeeded. ${errors.join(' | ')}`);
}
