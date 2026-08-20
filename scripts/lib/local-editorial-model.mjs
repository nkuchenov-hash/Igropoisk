import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

export const LOCAL_EDITORIAL_MODEL = process.env.LOCAL_EDITORIAL_MODEL || process.env.LOCAL_TEXT_MODEL || 'qwen3:4b';
export const OLLAMA_HOST = String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

function ollamaJson(pathname,{method='GET',body=null,timeoutMs=900000}={}){
  const url=new URL(`${OLLAMA_HOST}${pathname}`),client=url.protocol==='https:'?https:http,payload=body===null?null:JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const request=client.request(url,{method,headers:{accept:'application/json',...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{})}},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        if((response.statusCode||0)<200||(response.statusCode||0)>=300){reject(new Error(`Local editorial model HTTP ${response.statusCode}: ${text.slice(0,4000)}`));return}
        try{resolve(text?JSON.parse(text):{})}catch(error){reject(new Error(`Local editorial model returned invalid transport JSON: ${error.message}`))}
      });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new Error(`Local editorial model request timed out after ${timeoutMs}ms`)));
    request.on('error',reject);
    if(payload)request.write(payload);
    request.end();
  });
}

export async function localModelReady({timeoutMs=2500}={}) {
  try {
    const payload=await ollamaJson('/api/tags',{timeoutMs});
    return (payload.models || []).some(item => String(item.name || item.model || '').startsWith(LOCAL_EDITORIAL_MODEL));
  } catch {
    return false;
  }
}

export async function imageToBase64(url, {timeoutMs=15000, maxBytes=8_000_000}={}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {'user-agent': 'IgropoiskLocalEditorial/2.0'}
  });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}: ${url}`);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`Not an image: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`Invalid image size ${buffer.length}: ${url}`);
  return buffer.toString('base64');
}

export function strengthenJsonSchema(schema) {
  if (!schema || schema === 'json' || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const copy = structuredClone(schema);
  const visit = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      for (const [key, property] of Object.entries(node.properties)) {
        if (required.has(key) && property?.type === 'string') property.minLength = Math.max(1, Number(property.minLength || 0));
        visit(property);
      }
    }
    if (node.type === 'array') visit(node.items);
    for (const key of ['allOf','anyOf','oneOf']) if (Array.isArray(node[key])) for (const child of node[key]) visit(child);
  };
  visit(copy);
  return copy;
}

export function isCompactBooleanAuditSchema(schema) {
  if (!schema || schema === 'json' || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const requiredBooleanCount = required.filter(key => properties[key]?.type === 'boolean').length;
  const hasIssueList = Object.entries(properties).some(([key, value]) => /issues?|problems?/i.test(key) && value?.type === 'array');
  return schema.type === 'object' && requiredBooleanCount >= 3 && hasIssueList;
}

export function boundedJsonPredictBudget({schema='json',numPredict=12000,timeoutMs=900000}={}) {
  const requested = Math.max(1, Number(numPredict || 1));
  if (timeoutMs <= 120000 && isCompactBooleanAuditSchema(schema)) return Math.min(requested, 256);
  return requested;
}

export async function chatJson({system='', prompt, schema='json', images=[], temperature=0.2, numCtx=32768, numPredict=12000, timeoutMs=900000, repeatPenalty=1.18, repeatLastN=1024}) {
  if (!prompt) throw new Error('Local editorial prompt is required');
  const ready = await localModelReady();
  if (!ready) throw new Error(`Local editorial model is not ready: ${LOCAL_EDITORIAL_MODEL}`);
  const format = strengthenJsonSchema(schema);
  const effectiveNumPredict = boundedJsonPredictBudget({schema: format, numPredict, timeoutMs});
  const payload=await ollamaJson('/api/chat',{
    method:'POST',
    timeoutMs,
    body:{
      model: LOCAL_EDITORIAL_MODEL,
      stream: false,
      think: false,
      format,
      messages: [
        ...(system ? [{role: 'system', content: system}] : []),
        {role: 'user', content: prompt, ...(images.length ? {images} : {})}
      ],
      options: {temperature, num_ctx: numCtx, num_predict: effectiveNumPredict, repeat_penalty: repeatPenalty, repeat_last_n: repeatLastN}
    }
  });
  const raw = payload?.message?.content;
  if (!raw) throw new Error('Local editorial model returned no content');
  try {
    return JSON.parse(String(raw).replace(/^```json\s*|\s*```$/g, ''));
  } catch (error) {
    throw new Error(`Local editorial model returned invalid JSON: ${error.message}`);
  }
}

export function readJsonFile(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
