import {resolveAiProvider} from './ai-provider.mjs';

const nativeFetch=globalThis.fetch.bind(globalThis);
const cfg=resolveAiProvider(process.env);

function isLegacyOpenAiResponses(input){
  const value=typeof input==='string'?input:input?.url;
  return String(value||'').startsWith('https://api.openai.com/v1/responses');
}

function rewriteBody(raw){
  if(!raw)return raw;
  try{
    const body=JSON.parse(String(raw));
    if(process.env.AI_MODEL)body.model=process.env.AI_MODEL;
    if(cfg.provider==='openrouter'&&Array.isArray(body.tools)){
      body.tools=body.tools.map(tool=>tool?.type==='web_search'?{type:'openrouter:web_search'}:tool);
    }
    return JSON.stringify(body);
  }catch{return raw}
}

globalThis.fetch=async function providerAwareFetch(input,init={}){
  if(!isLegacyOpenAiResponses(input))return nativeFetch(input,init);
  if(!cfg.apiKey)throw new Error('No AI credential configured. Set AI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY.');
  const headers=new Headers(init.headers||{});
  headers.set('authorization',`Bearer ${cfg.apiKey}`);
  headers.set('content-type','application/json');
  if(cfg.provider==='openrouter'){
    headers.set('HTTP-Referer',process.env.AI_SITE_URL||'https://nkuchenov-hash.github.io/Igropoisk/');
    headers.set('X-Title',process.env.AI_APP_NAME||'Igropoisk');
  }
  return nativeFetch(`${cfg.baseUrl}/responses`,{...init,headers,body:rewriteBody(init.body)});
};
