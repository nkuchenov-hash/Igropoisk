import process from 'node:process';

const trimSlash=value=>String(value||'').replace(/\/$/,'');
const stripFence=value=>String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();

export function freeEditorialAIConfig(){
  return {
    baseUrl:trimSlash(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434'),
    model:String(process.env.OLLAMA_EDITORIAL_MODEL||process.env.OLLAMA_MODEL||'qwen2.5:3b').trim(),
    timeoutMs:Number(process.env.OLLAMA_EDITORIAL_TIMEOUT_MS||240000)
  };
}

export async function generateFreeEditorialJSON({system='',prompt,temperature=0.25}){
  const {baseUrl,model,timeoutMs}=freeEditorialAIConfig();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`${baseUrl}/api/chat`,{
      method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({model,stream:false,format:'json',options:{temperature},messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')} ]})
    });
    if(!response.ok)throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0,1200)}`);
    const data=await response.json();const raw=stripFence(data?.message?.content||data?.response||'');if(!raw)throw new Error('Qwen/Ollama returned empty output');
    let parsed;try{parsed=JSON.parse(raw)}catch(error){throw new Error(`Qwen/Ollama returned invalid JSON: ${error.message}`)}
    return {data:parsed,provider:'ollama',model,baseUrl};
  }catch(error){if(error?.name==='AbortError')throw new Error(`Qwen/Ollama timed out after ${timeoutMs} ms`);throw error}finally{clearTimeout(timer)}
}

export async function assertFreeEditorialAI(){
  const {baseUrl,model,timeoutMs}=freeEditorialAIConfig();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,15000));
  try{const response=await fetch(`${baseUrl}/api/tags`,{signal:controller.signal});if(!response.ok)throw new Error(`Ollama health ${response.status}`);const payload=await response.json();const names=(payload?.models||[]).map(item=>String(item?.name||item?.model||''));const available=names.some(name=>name===model||name.startsWith(`${model}:`)||model.startsWith(`${name}:`));if(!available)throw new Error(`Required free model ${model} is not installed`);return {provider:'ollama',model,baseUrl}}finally{clearTimeout(timer)}
}
