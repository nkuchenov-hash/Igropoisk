import {generateFreeEditorialJSON,ensureFreeEditorialAI} from './free-editorial-ai.mjs';

export async function generateGamePageEditorialJSON(options={}){
  await ensureFreeEditorialAI();
  const result=await generateFreeEditorialJSON(options);
  return {...result,provider:'local-qwen-ollama'};
}
