import crypto from 'node:crypto';

const endpoint = new URL(process.env.YC_S3_ENDPOINT || 'https://storage.yandexcloud.net');
const region = process.env.YC_S3_REGION || 'ru-central1';
const service = 's3';
const accessKeyId = process.env.YC_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.YC_S3_SECRET_ACCESS_KEY;
const bucket = process.env.YC_S3_BUCKET;

for (const [name, value] of Object.entries({
  YC_S3_ACCESS_KEY_ID: accessKeyId,
  YC_S3_SECRET_ACCESS_KEY: secretAccessKey,
  YC_S3_BUCKET: bucket
})) {
  if (!value) throw new Error(`Missing required secret: ${name}`);
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const encodePath = value => value.split('/').map(segment => encodeURIComponent(segment)).join('/');

function signingKey(dateStamp) {
  const date = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
  const regionKey = hmac(date, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

async function request(method, key, body = '') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${encodeURIComponent(bucket)}/${encodePath(key)}`;
  const payloadHash = sha256(payload);
  const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = new URL(canonicalUri, endpoint);
  const response = await fetch(url, {
    method,
    body: method === 'PUT' ? payload : undefined,
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(method === 'PUT' ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {})
    }
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`${method} ${key} failed with ${response.status}: ${detail}`);
  }
  return response;
}

const probeKey = `system/probes/github-actions-${process.env.GITHUB_RUN_ID || Date.now()}.json`;
const payload = JSON.stringify({
  status: 'ok',
  repository: process.env.GITHUB_REPOSITORY || '',
  runId: process.env.GITHUB_RUN_ID || '',
  checkedAt: new Date().toISOString()
});

await request('PUT', probeKey, payload);
const readBack = await request('GET', probeKey);
const stored = await readBack.json();
if (stored.status !== 'ok' || stored.runId !== (process.env.GITHUB_RUN_ID || '')) {
  throw new Error('Object Storage probe returned unexpected content.');
}
await request('DELETE', probeKey);

console.log(`Yandex Object Storage connection verified for bucket ${bucket}.`);
