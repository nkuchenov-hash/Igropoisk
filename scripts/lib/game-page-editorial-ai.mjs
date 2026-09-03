import {generateFreeEditorialJSON,ensureFreeEditorialAI} from './free-editorial-ai.mjs';

// Game Page publication must not depend on a remote inference service.
// The local Qwen/Ollama backend is the canonical automatic editor; callers may
// explicitly opt into another provider in a separate integration, but the
// production Game Page path remains self-contained and free.
export async function generateGamePageEditorialJSON(options={}){
  await ensureFreeEditorialAI();
  const result=await generateFreeEditorialJSON(options);
  return {...result,provider:'local-qwen-ollama'};
}
