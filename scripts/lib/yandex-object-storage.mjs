import crypto from 'node:crypto';

const clean = value => String(value || '').trim();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const encodePath = value => String(value).split('/').map(segment => encodeURIComponent(segment)).join('/');
const encodeQuery = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const decodeXml = value => String(value || '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

function canonicalQueryString(query = {}) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(entry => [encodeQuery(key), encodeQuery(entry)]))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function parseListObjectsXml(xml) {
  const objects = [];
  for (const match of String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1];
    const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '');
    if (!key) continue;
    objects.push(Object.freeze({
      key,
      size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
      lastModified: decodeXml(block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || ''),
      etag: decodeXml(block.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1] || '').replace(/^"|"$/g, '')
    }));
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const continuationToken = decodeXml(String(xml).match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || '');
  return { objects, truncated, continuationToken };
}

export function createYandexObjectStorageClient(options = {}) {
  const endpoint = new URL(clean(options.endpoint || process.env.YC_S3_ENDPOINT) || 'https://storage.yandexcloud.net');
  const region = clean(options.region || process.env.YC_S3_REGION) || 'ru-central1';
  const accessKeyId = clean(options.accessKeyId || process.env.YC_S3_ACCESS_KEY_ID);
  const secretAccessKey = clean(options.secretAccessKey || process.env.YC_S3_SECRET_ACCESS_KEY);
  const bucket = clean(options.bucket || process.env.YC_S3_BUCKET);
  const service = 's3';

  for (const [name, value] of Object.entries({
    YC_S3_ACCESS_KEY_ID: accessKeyId,
    YC_S3_SECRET_ACCESS_KEY: secretAccessKey,
    YC_S3_BUCKET: bucket
  })) {
    if (!value) throw new Error(`Missing required Object Storage setting: ${name}`);
  }

  const signingKey = dateStamp => {
    const date = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
    const regionKey = hmac(date, region);
    const serviceKey = hmac(regionKey, service);
    return hmac(serviceKey, 'aws4_request');
  };

  async function request(method, key, { body = '', headers = {}, query = {} } = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = `/${encodeURIComponent(bucket)}/${encodePath(key)}`;
    const canonicalQuery = canonicalQueryString(query);
    const payloadHash = sha256(payload);
    const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
    const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const url = new URL(canonicalUri, endpoint);
    if (canonicalQuery) url.search = canonicalQuery;
    const response = await fetch(url, {
      method,
      body: method === 'PUT' ? payload : undefined,
      headers: {
        Authorization: authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...headers
      }
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      throw new Error(`${method} ${key} failed with ${response.status}: ${detail}`);
    }
    return response;
  }

  return Object.freeze({
    bucket,
    endpoint: endpoint.href.replace(/\/$/, ''),
    publicUrl(key) {
      return new URL(`/${encodeURIComponent(bucket)}/${encodePath(key)}`, endpoint).href;
    },
    async putObject(key, body, { contentType = 'application/octet-stream', cacheControl = '' } = {}) {
      return request('PUT', key, {
        body,
        headers: {
          'Content-Type': contentType,
          ...(cacheControl ? { 'Cache-Control': cacheControl } : {})
        }
      });
    },
    async getObject(key) {
      return request('GET', key);
    },
    async headObject(key) {
      return request('HEAD', key);
    },
    async deleteObject(key) {
      return request('DELETE', key);
    },
    async listObjects({ prefix = '', maxKeys = 1000 } = {}) {
      const objects = [];
      let continuationToken = '';
      do {
        const response = await request('GET', '', {
          query: {
            'list-type': '2',
            prefix,
            'max-keys': String(Math.max(1, Math.min(1000, Number(maxKeys) || 1000))),
            ...(continuationToken ? { 'continuation-token': continuationToken } : {})
          }
        });
        const page = parseListObjectsXml(await response.text());
        objects.push(...page.objects);
        continuationToken = page.truncated ? page.continuationToken : '';
        if (page.truncated && !continuationToken) throw new Error(`Object listing for ${prefix || '(bucket root)'} was truncated without a continuation token.`);
      } while (continuationToken);
      return Object.freeze(objects);
    }
  });
}
