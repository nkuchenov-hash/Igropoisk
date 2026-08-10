const cleanBase=value=>String(value||'').replace(/\/$/,'');

export function resolveAiProvider(env=process.env){
  const provider=String(env.AI_PROVIDER||'').trim().toLowerCase() || (env.OPENROUTER_API_KEY?'openrouter':'openai');
  const apiKey=env.AI_API_KEY||env.OPENROUTER_API_KEY||env.OPENAI_API_KEY||'';
  const baseUrl=cleanBase(env.AI_BASE_URL||(provider==='openrouter'?'https://openrouter.ai/api/v1':'https://api.openai.com/v1'));
  const model=env.AI_MODEL||env.OPENAI_RESEARCH_MODEL||env.OPENAI_MODEL||(provider==='openrouter'?'openrouter/auto':'gpt-5');
  const webTool=provider==='openrouter'?{type:'openrouter:web_search'}:{type:'web_search',search_context_size:'high'};
  return {provider,apiKey,baseUrl,model,webTool};
}

export function hasAiProvider(env=process.env){return Boolean(resolveAiProvider(env).apiKey)};

export async function callStructured({prompt,schema,name='igropoisk_output',model,webSearch=true,env=process.env}){
  const cfg=resolveAiProvider(env);
  if(!cfg.apiKey) throw new Error('No AI provider credential configured. Set AI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY.');
  const body={
    model:model||cfg.model,
    input:prompt,
    text:{format:{type:'json_schema',name,strict:true,schema}}
  };
  if(webSearch){body.tools=[cfg.webTool];body.tool_choice='required'}
  const headers={authorization:`Bearer ${cfg.apiKey}`,'content-type':'application/json'};
  if(cfg.provider==='openrouter'){
    headers['HTTP-Referer']=env.AI_SITE_URL||'https://nkuchenov-hash.github.io/Igropoisk/';
    headers['X-Title']=env.AI_APP_NAME||'Igropoisk';
  }
  const response=await fetch(`${cfg.baseUrl}/responses`,{method:'POST',headers,body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`${cfg.provider} AI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
  if(!text) throw new Error(`No structured output from ${cfg.provider}`);
  return JSON.parse(text);
}
