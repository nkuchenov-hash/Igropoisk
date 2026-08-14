import fs from 'node:fs';

export const LOCAL_EDITORIAL_MODEL = process.env.LOCAL_EDITORIAL_MODEL || 'qwen3-vl:4b';
export const OLLAMA_HOST = String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

export async function localModelReady({timeoutMs=2500}={}) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {signal: AbortSignal.timeout(timeoutMs)});
    if (!response.ok) return false;
    const payload = await response.json();
    return (payload.models || []).some(item => String(item.name || item.model || '').startsWith(LOCAL_EDITORIAL_MODEL));
  } catch {
    return false;
  }
}

export async function imageToBase64(url, {timeoutMs=15000, maxBytes=8_000_000}={}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {'user-agent': 'IgropoiskLocalEditorial/1.0'}
  });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}: ${url}`);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`Not an image: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`Invalid image size ${buffer.length}: ${url}`);
  return buffer.toString('base64');
}

export async function chatJson({system='', prompt, schema='json', images=[], temperature=0.2, numCtx=32768, numPredict=12000, timeoutMs=900000}) {
  if (!prompt) throw new Error('Local editorial prompt is required');
  const ready = await localModelReady();
  if (!ready) throw new Error(`Local editorial model is not ready: ${LOCAL_EDITORIAL_MODEL}`);
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      model: LOCAL_EDITORIAL_MODEL,
      stream: false,
      think: false,
      format: schema,
      messages: [
        ...(system ? [{role: 'system', content: system}] : []),
        {role: 'user', content: prompt, ...(images.length ? {images} : {})}
      ],
      options: {temperature, num_ctx: numCtx, num_predict: numPredict}
    })
  });
  if (!response.ok) throw new Error(`Local editorial model HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
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
