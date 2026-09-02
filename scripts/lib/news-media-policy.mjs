import fs from 'node:fs';
import path from 'node:path';

const clean = value => String(value || '').trim();

function storageMediaSegments(config = {}) {
  return clean(config.publication?.storage?.media_prefix || 'news/media')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
}

function safeSegments(pathname) {
  try {
    return String(pathname || '')
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment));
  } catch {
    return [];
  }
}

export function classifyNewsImage(imageValue, { root = process.cwd(), config = {}, env = process.env } = {}) {
  const image = clean(imageValue);
  if (!image) return { approved: false, kind: 'missing', exists: false };

  const localRoot = (config.publication?.image_roots || []).find(rootPrefix => image.startsWith(rootPrefix));
  if (localRoot) {
    const safe = /^[\w./-]+$/.test(image) && !image.includes('..');
    return {
      approved: safe,
      kind: 'local',
      safe,
      exists: safe && fs.existsSync(path.join(root, image))
    };
  }

  try {
    const url = new URL(image);
    const endpoint = new URL(clean(env.YC_S3_ENDPOINT) || 'https://storage.yandexcloud.net');
    if (url.protocol !== endpoint.protocol || url.host !== endpoint.host || url.username || url.password || url.search || url.hash) {
      return { approved: false, kind: 'remote', exists: false };
    }

    const segments = safeSegments(url.pathname);
    const mediaSegments = storageMediaSegments(config);
    if (segments.length <= mediaSegments.length + 1) return { approved: false, kind: 'remote', exists: false };

    const bucket = clean(env.YC_S3_BUCKET);
    if (bucket && segments[0] !== bucket) return { approved: false, kind: 'remote', exists: false };
    if (!segments[0] || segments[0] === '.' || segments[0] === '..') return { approved: false, kind: 'remote', exists: false };

    const prefix = segments.slice(1, 1 + mediaSegments.length);
    if (prefix.length !== mediaSegments.length || prefix.some((segment, index) => segment !== mediaSegments[index])) {
      return { approved: false, kind: 'remote', exists: false };
    }
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      return { approved: false, kind: 'remote', exists: false };
    }

    return {
      approved: true,
      kind: 'object-storage',
      exists: true,
      bucket: segments[0],
      key: segments.slice(1).join('/')
    };
  } catch {
    return { approved: false, kind: 'unknown', exists: false };
  }
}
