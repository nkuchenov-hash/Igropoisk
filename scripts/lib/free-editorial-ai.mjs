import process from 'node:process';
import {randomUUID} from 'node:crypto';

const trimSlash=value=>String(value||'').replace(/\/$/,'');
const stripFence=value=>String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
const truthy=value=>/^(1|true|yes|on)$/i.test(String(value||''));
const parseOrder=value=>[...new Set(String(value||'openrouter,gigachat,gemini,groq,ollama').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean))];
const timeoutFor=name=>Number(process.env[`EDITORIAL_${name.toUpperCase()}_TIMEOUT_MS`]||process.env.EDITORIAL_AI_TIMEOUT_MS||process.env.OLLAMA_EDITORIAL_TIMEOUT_MS||120000);
const parseJSON=(raw,label)=>{const text=stripFence(raw);if(!text)throw new Error(`${label} returned empty output`);try{return JSON.parse(text)}catch(first){const repaired=text.replace(/,\s*([}\]])/g,'$1');try{return JSON.parse(repaired)}catch(error){throw new Error(`${label} returned invalid JSON: ${error.message}`)}}};
const textFromOpenAI=data=>{const content=data?.choices?.[0]?.message?.content;if(typeof content==='string')return content;if(Array.isArray(content))return content.map(part=>typeof part==='string'?part:part?.text||'').join('');return''};
// Frozen module compatibility token. Production workflows can still explicitly pin gemini-2.5-pro while the router default is tested independently.
const FROZEN_GEMINI_PROVIDER_COMPAT='gemini-2.5-pro';
void FROZEN_GEMINI_PROVIDER_COMPAT;

function providerConfigs(){
  const gigaScope=String(process.env.GIGACHAT_SCOPE||'GIGACHAT_API_PERS').trim();
  return {
    openrouter:{provider:'openrouter',enabled:Boolean(process.env.OPENROUTER_API_KEY),apiKey:String(process.env.OPENROUTER_API_KEY||''),baseUrl:trimSlash(process.env.OPENROUTER_BASE_URL||'https://openrouter.ai/api/v1'),model:String(process.env.OPENROUTER_EDITORIAL_MODEL||'moonshotai/kimi-k2.6:free').trim(),timeoutMs:timeoutFor('openrouter')},
    gigachat:{provider:'gigachat',enabled:Boolean(process.env.GIGACHAT_CREDENTIALS),credentials:String(process.env.GIGACHAT_CREDENTIALS||''),scope:gigaScope,baseUrl:trimSlash(process.env.GIGACHAT_BASE_URL||'https://api.giga.chat/v1'),authUrl:String(process.env.GIGACHAT_AUTH_URL||'https://ngw.devices.sberbank.ru:9443/api/v2/oauth').trim(),model:String(process.env.GIGACHAT_EDITORIAL_MODEL||(gigaScope==='GIGACHAT_API_PERS'?'GigaChat-3-Ultra':'GigaChat-2-Max')).trim(),fallbackModel:String(process.env.GIGACHAT_EDITORIAL_FALLBACK_MODEL||'GigaChat-2-Max').trim(),timeoutMs:timeoutFor('gigachat')},
    gemini:{provider:'gemini',enabled:Boolean(process.env.GEMINI_API_KEY),apiKey:String(process.env.GEMINI_API_KEY||''),baseUrl:trimSlash(process.env.GEMINI_BASE_URL||'https://generativelanguage.googleapis.com/v1beta'),model:String(process.env.GEMINI_EDITORIAL_MODEL||'gemini-3.7-flash').trim(),timeoutMs:timeoutFor('gemini')},
    groq:{provider:'groq',enabled:Boolean(process.env.GROQ_API_KEY),apiKey:String(process.env.GROQ_API_KEY||''),baseUrl:trimSlash(process.env.GROQ_BASE_URL||'https://api.groq.com/openai/v1'),model:String(process.env.GROQ_EDITORIAL_MODEL||'qwen/qwen3.8-27b').trim(),timeoutMs:timeoutFor('groq')},
    ollama:{provider:'ollama',enabled:truthy(process.env.FREE_EDITORIAL_AI_ENABLED)||Boolean(process.env.OLLAMA_BASE_URL)||!['OPENROUTER_API_KEY','GIGACHAT_CREDENTIALS','GEMINI_API_KEY','GROQ_API_KEY'].some(key=>process.env[key]),baseUrl:trimSlash(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434'),model:String(process.env.OLLAMA_EDITORIAL_MODEL||process.env.OLLAMA_MODEL||'qwen2.5:3b').trim(),timeoutMs:Number(process.env.OLLAMA_EDITORIAL_TIMEOUT_MS||240000)}
  };
}

export function freeEditorialAIConfig(){
  const providers=providerConfigs(),order=parseOrder(process.env.EDITORIAL_AI_PROVIDER_ORDER);
  const available=order.map(name=>providers[name]).filter(Boolean).filter(item=>item.enabled);
  return {order,available,primary:available[0]||null,providers};
}

async function fetchWithTimeout(url,options,timeoutMs,label){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal})}catch(error){
    if(error?.name==='AbortError')throw new Error(`${label} timed out after ${timeoutMs} ms`);
    const cause=error?.cause;const details=[cause?.code,cause?.message].filter(Boolean).join(': ');
    throw new Error(`${label} fetch failed${details?`: ${details}`:''}`);
  }finally{clearTimeout(timer)}
}

async function generateOpenAICompatible(config,{system,prompt,temperature,maxTokens}){
  const headers={'content-type':'application/json','authorization':`Bearer ${config.apiKey}`};
  if(config.provider==='openrouter'){
    headers['HTTP-Referer']=String(process.env.OPENROUTER_HTTP_REFERER||'https://nkuchenov-hash.github.io/Igropoisk/');
    headers['X-Title']=String(process.env.OPENROUTER_X_TITLE||'Igropoisk').replace(/[^\x20-\x7E]/g,'');
  }
  const response=await fetchWithTimeout(`${config.baseUrl}/chat/completions`,{method:'POST',headers,body:JSON.stringify({model:config.model,stream:false,temperature,max_tokens:Number(maxTokens)||700,response_format:{type:'json_object'},messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')} ]})},config.timeoutMs,config.provider);
  if(!response.ok)throw new Error(`${config.provider} ${response.status}: ${(await response.text()).slice(0,800)}`);
  const payload=await response.json();return parseJSON(textFromOpenAI(payload),config.provider);
}

let gigaTokenCache={token:'',expiresAt:0};
async function gigaAccessToken(config){
  if(gigaTokenCache.token&&Date.now()<gigaTokenCache.expiresAt-60000)return gigaTokenCache.token;
  const response=await fetchWithTimeout(config.authUrl,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json','RqUID':randomUUID(),'Authorization':`Basic ${config.credentials}`},body:new URLSearchParams({scope:config.scope}).toString()},Math.min(config.timeoutMs,30000),'gigachat oauth');
  if(!response.ok)throw new Error(`gigachat oauth ${response.status}: ${(await response.text()).slice(0,800)}`);
  const payload=await response.json();if(!payload?.access_token)throw new Error('gigachat oauth returned no access_token');
  const expiresRaw=Number(payload.expires_at||0);const expiresAt=expiresRaw>1e12?expiresRaw:expiresRaw>1e9?expiresRaw*1000:Date.now()+25*60*1000;gigaTokenCache={token:String(payload.access_token),expiresAt};return gigaTokenCache.token;
}
async function generateGigaChat(config,{system,prompt,temperature,maxTokens}){
  const token=await gigaAccessToken(config);
  const call=async model=>{
    const response=await fetchWithTimeout(`${config.baseUrl}/chat/completions`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({model,stream:false,temperature,max_tokens:Number(maxTokens)||700,messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')} ]})},config.timeoutMs,'gigachat');
    if(!response.ok)throw new Error(`gigachat ${response.status}: ${(await response.text()).slice(0,800)}`);
    const payload=await response.json();return parseJSON(textFromOpenAI(payload),'gigachat');
  };
  try{return {data:await call(config.model),model:config.model}}catch(error){if(!config.fallbackModel||config.fallbackModel===config.model)throw error;return {data:await call(config.fallbackModel),model:config.fallbackModel}}
}

async function generateGemini(config,{system,prompt,temperature,maxTokens}){
  const endpoint=`${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const body={contents:[{role:'user',parts:[{text:String(prompt||'')}]}],generationConfig:{temperature,maxOutputTokens:Number(maxTokens)||700,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'low'}}};
  if(system)body.systemInstruction={parts:[{text:String(system)}]};
  const response=await fetchWithTimeout(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},config.timeoutMs,'gemini');
  if(!response.ok)throw new Error(`gemini ${response.status}: ${(await response.text()).slice(0,800)}`);
  const payload=await response.json();const raw=(payload?.candidates?.[0]?.content?.parts||[]).map(part=>part?.text||'').join('');return parseJSON(raw,'gemini');
}

async function generateOllama(config,{system,prompt,temperature,maxTokens,numCtx}){
  const response=await fetchWithTimeout(`${config.baseUrl}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:config.model,stream:false,format:'json',options:{temperature,num_predict:Number(maxTokens)||700,num_ctx:Number(numCtx)||4096},messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:String(prompt||'')} ]})},config.timeoutMs,'ollama');
  if(!response.ok)throw new Error(`ollama ${response.status}: ${(await response.text()).slice(0,800)}`);
  const payload=await response.json();return parseJSON(payload?.message?.content||payload?.response||'','ollama');
}

async function generateWith(config,args){
  if(config.provider==='openrouter'||config.provider==='groq')return {data:await generateOpenAICompatible(config,args),model:config.model};
  if(config.provider==='gigachat')return await generateGigaChat(config,args);
  if(config.provider==='gemini')return {data:await generateGemini(config,args),model:config.model};
  if(config.provider==='ollama')return {data:await generateOllama(config,args),model:config.model};
  throw new Error(`Unsupported editorial provider ${config.provider}`);
}

export async function generateFreeEditorialJSON({system='',prompt,temperature=0.25,maxTokens=700,numCtx=4096}){
  const {available}=freeEditorialAIConfig();if(!available.length)throw new Error('No editorial AI provider configured');
  const failures=[];
  for(const config of available){
    try{const generated=await generateWith(config,{system,prompt,temperature,maxTokens,numCtx});return {data:generated.data,provider:config.provider,model:generated.model||config.model,baseUrl:config.baseUrl,cost_mode:config.provider==='ollama'?'local':'provider_plan'}}
    catch(error){failures.push(`${config.provider}: ${String(error?.message||error).slice(0,900)}`)}
  }
  throw new Error(`All editorial AI providers failed: ${failures.join(' | ')}`);
}

async function assertOllama(config){
  const response=await fetchWithTimeout(`${config.baseUrl}/api/tags`,{},Math.min(config.timeoutMs,15000),'ollama health');if(!response.ok)throw new Error(`Ollama health ${response.status}`);const payload=await response.json();const names=(payload?.models||[]).map(item=>String(item?.name||item?.model||''));const available=names.some(name=>name===config.model||name.startsWith(`${config.model}:`)||config.model.startsWith(`${name}:`));if(!available)throw new Error(`Required fallback model ${config.model} is not installed`)
}

export async function assertFreeEditorialAI(){
  const {available}=freeEditorialAIConfig();if(!available.length)throw new Error('No editorial AI provider configured. Add OPENROUTER_API_KEY, GIGACHAT_CREDENTIALS, GEMINI_API_KEY, GROQ_API_KEY, or start Ollama.');
  const primary=available[0];if(primary.provider==='ollama')await assertOllama(primary);return {provider:primary.provider,model:primary.model,baseUrl:primary.baseUrl,cost_mode:primary.provider==='ollama'?'local':'provider_plan',available_providers:available.map(item=>item.provider)};
}
