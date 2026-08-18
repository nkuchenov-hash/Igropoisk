export const GITHUB_EDITORIAL_MODEL=process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1';
export const GITHUB_AUDIT_MODEL=process.env.GITHUB_AUDIT_MODEL||GITHUB_EDITORIAL_MODEL;

export async function githubChatJson({system='',prompt,model=GITHUB_EDITORIAL_MODEL,temperature=0.12,maxTokens=3000,timeoutMs=90000}={}){
  if(!prompt)throw new Error('GitHub editorial prompt is required');
  const token=String(process.env.GITHUB_TOKEN||'').trim();
  if(!token)throw new Error('GITHUB_TOKEN unavailable for GitHub Models');
  const response=await fetch('https://models.github.ai/inference/chat/completions',{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/vnd.github+json','x-github-api-version':'2026-03-10'},
    body:JSON.stringify({model,messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:prompt}],response_format:{type:'json_object'},temperature,max_tokens:maxTokens}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${(await response.text()).slice(0,1200)}`);
  const payload=await response.json(),raw=payload?.choices?.[0]?.message?.content;
  if(!raw)throw new Error('GitHub Models returned no editorial JSON');
  try{return JSON.parse(String(raw).replace(/^```json\s*|\s*```$/g,''))}
  catch(error){throw new Error(`GitHub Models returned invalid JSON: ${error.message}`)}
}
