#!/usr/bin/env node
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LOCAL_EDITORIAL_MODEL,localModelReady} from './lib/local-editorial-model.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const commandExists=command=>spawnSync('bash',['-lc',`command -v ${command}`],{stdio:'ignore'}).status===0;

export async function ensureLocalEditorialRuntime(){
  if(process.env.OPENAI_API_KEY)return{ready:true,provider:'openai'};
  if(await localModelReady({timeoutMs:1500}))return{ready:true,provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,reused:true};
  if(String(process.env.GITHUB_ACTIONS||'').toLowerCase()!=='true'&&!/^(1|true|yes|on)$/i.test(String(process.env.LOCAL_EDITORIAL_ENABLED||'')))return{ready:false,provider:'none',reason:'local runtime bootstrap only enabled in GitHub Actions or LOCAL_EDITORIAL_ENABLED'};
  if(!commandExists('ollama')){
    const install=spawnSync('bash',['-lc','curl -fsSL https://ollama.com/install.sh | sh'],{encoding:'utf8',stdio:'inherit',timeout:180000});
    if(install.status!==0)throw new Error(`Ollama installation failed with exit ${install.status}`);
  }
  const server=spawn('ollama',['serve'],{detached:true,stdio:'ignore',env:process.env});server.unref();
  let serverReady=false;for(let attempt=0;attempt<60;attempt++){if(await localModelReady({timeoutMs:1200})){serverReady=true;break}try{const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(1200)});if(response.ok){serverReady=true;break}}catch{}await sleep(1000)}
  if(!serverReady)throw new Error('Local Ollama service did not become ready');
  if(!await localModelReady({timeoutMs:2000})){
    const pull=spawnSync('ollama',['pull',LOCAL_EDITORIAL_MODEL],{encoding:'utf8',stdio:'inherit',timeout:1200000,env:process.env});
    if(pull.status!==0)throw new Error(`Could not pull ${LOCAL_EDITORIAL_MODEL}: exit ${pull.status}`);
  }
  if(!await localModelReady({timeoutMs:3000}))throw new Error(`Local editorial model is unavailable after pull: ${LOCAL_EDITORIAL_MODEL}`);
  process.env.LOCAL_EDITORIAL_ENABLED='true';
  return{ready:true,provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,reused:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])console.log(JSON.stringify(await ensureLocalEditorialRuntime(),null,2));
