import fs from 'node:fs';
import path from 'node:path';

const trustedNewsMediaPattern = /^\/[^/]+\/news\/media\/[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp)$/i;

export function isTrustedNewsMediaUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:'
      && url.hostname === 'storage.yandexcloud.net'
      && !url.search
      && !url.hash
      && trustedNewsMediaPattern.test(url.pathname);
  } catch {
    return false;
  }
}

export function validateNewsImageReference({ root, image, localRoots = [] } = {}) {
  const value = String(image || '').trim();
  if (isTrustedNewsMediaUrl(value)) return { ok: true, remote: true, value };
  if (!localRoots.some(prefix => value.startsWith(prefix))) return { ok: false, reason: 'outside-approved-roots', value };
  if (!/^[\w./-]+$/.test(value) || value.includes('..')) return { ok: false, reason: 'unsafe-local-path', value };
  if (!fs.existsSync(path.join(root, value))) return { ok: false, reason: 'missing-local-file', value };
  return { ok: true, remote: false, value };
}
