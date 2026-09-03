import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';

const trimSlash=value=>String(value||'').replace(/\/$/,'');
const stripFence=value=>String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let bootstrapPromise=null;

export function freeEditorialAIConfig(){
  return {
    baseUrl:trimSlash(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434'),
    model:String(process.env.OLLAMA_EDITORIAL_MODEL||process.env.OLLAMA_MODEL||'qwen2.5:1.5b').trim(),
    timeoutMs:Number(process.env.OLLAMA_EDITORIAL_TIMEOUT_MS||180000),
    numCtx:Number(process.env.OLLAMA_EDITORIAL_NUM_CTX||8192)
  };
}

async function tagsPayload(timeoutMs=8000){
  const {baseUrl}=freeEditorialAIConfig();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await fetch(`${baseUrl}/api/tags`,{signal:controller.signal});if(!response.ok)throw new Error(`Ollama health ${response.status}`);return await response.json()}finally{clearTimeout(timer)}
}

export async function assertFreeEditorialAI(){
  const {baseUrl,model,timeoutMs}=freeEditorialAIConfig();const payload=await tagsPayload(Math.min(timeoutMs,15000));const names=(payload?.models||[]).map(item=>String(item?.name||item?.model||''));const available=names.some(name=>name===model||name.startsWith(`${model}:`)||model.startsWith(`${name}:`));if(!available)throw new Error(`Required free model ${model} is not installed`);return {provider:'ollama',model,baseUrl};
}

async function bootstrapFreeEditorialAI(){
  const {model,baseUrl}=freeEditorialAIConfig();
  if(!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(baseUrl))throw new Error(`Automatic Ollama bootstrap only supports a local endpoint, got ${baseUrl}`);
  const allowed=String(process.env.OLLAMA_AUTO_BOOTSTRAP||'').toLowerCase()==='true'||String(process.env.GITHUB_ACTIONS||'').toLowerCase()==='true';
  if(!allowed)throw new Error('Local Ollama is unavailable and automatic bootstrap is disabled outside CI');
  if(process.platform!=='linux')throw new Error(`Automatic Ollama bootstrap is only supported on Linux CI, got ${process.platform}`);
  const which=spawnSync('bash',['-lc','command -v ollama'],{encoding:'utf8'});
  if(which.status!==0){
    const install=spawnSync('bash',['-lc','curl -fsSL https://ollama.com/install.sh | sh'],{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
    if(install.status!==0)throw new Error(`Ollama install failed: ${(install.stderr||install.stdout||'unknown error').slice(-4000)}`);
  }
  let serviceReady=false;
  try{await tagsPayload(2500);serviceReady=true}catch{}
  if(!serviceReady){const child=spawn('ollama',['serve'],{detached:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});child.unref();for(let i=0;i<30;i++){await sleep(1000);try{await tagsPayload(2500);serviceReady=true;break}catch{}}}
  if(!serviceReady)throw new Error('Ollama service did not become ready after bootstrap');
  try{return await assertFreeEditorialAI()}catch{}
  const pull=spawnSync('ollama',['pull',model],{encoding:'utf8',timeout:Number(process.env.OLLAMA_PULL_TIMEOUT_MS||900000),maxBuffer:32*1024*1024,env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});
  if(pull.status!==0)throw new Error(`Ollama model pull failed for ${model}: ${(pull.stderr||pull.stdout||'unknown error').slice(-5000)}`);
  return await assertFreeEditorialAI();
}

export async function ensureFreeEditorialAI(){
  try{return await assertFreeEditorialAI()}catch{}
  if(!bootstrapPromise)bootstrapPromise=bootstrapFreeEditorialAI().catch(error=>{bootstrapPromise=null;throw error});
  return await bootstrapPromise;
}

export async function generateFreeEditorialJSON({system='',prompt,temperature=0.25,maxTokens=1600}){
  await ensureFreeEditorialAI();
  const {baseUrl,model,timeoutMs,numCtx}=freeEditorialAIConfig();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const numPredict=Math.max(128,Math.min(Number(maxTokens)||1600,2400));
  try{
    const response=await fetch(`${baseUrl}/api/chat`,{
      method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({model,stream:false,format:'json',options:{temperature,num_ctx:numCtx,num_predict:numPredict},messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')} ]})
    });
    if(!response.ok)throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0,1200)}`);
    const data=await response.json();const raw=stripFence(data?.message?.content||data?.response||'');if(!raw)throw new Error('Qwen/Ollama returned empty output');
    let parsed;try{parsed=JSON.parse(raw)}catch(error){throw new Error(`Qwen/Ollama returned invalid JSON: ${error.message}`)}
    return {data:parsed,provider:'ollama',model,baseUrl};
  }catch(error){if(error?.name==='AbortError')throw new Error(`Qwen/Ollama timed out after ${timeoutMs} ms`);throw error}finally{clearTimeout(timer)}
}
