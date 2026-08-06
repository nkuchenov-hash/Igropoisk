function integer(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`Integer value must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function csv(value, fallback = []) {
  const source = value === undefined || value === null || value === '' ? fallback : String(value).split(',');
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

export function readRuntimeConfig(env = process.env) {
  const runtimeMode = String(env.CONTENT_RUNTIME_MODE || 'shadow').trim().toLowerCase();
  if (!['shadow', 'canary', 'live'].includes(runtimeMode)) {
    throw new Error('CONTENT_RUNTIME_MODE must be shadow, canary, or live.');
  }

  const readSource = String(env.CONTENT_READ_SOURCE || 'object_storage').trim().toLowerCase();
  if (!['object_storage', 'content_api'].includes(readSource)) {
    throw new Error('CONTENT_READ_SOURCE must be object_storage or content_api.');
  }
  if (readSource === 'content_api' && runtimeMode === 'shadow') {
    throw new Error('CONTENT_READ_SOURCE=content_api is forbidden while CONTENT_RUNTIME_MODE=shadow.');
  }

  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  return Object.freeze({
    databaseUrl,
    runtimeMode,
    readSource,
    port: integer(env.PORT, 8080, { minimum: 1, maximum: 65_535 }),
    host: String(env.HOST || '0.0.0.0').trim(),
    shutdownGraceMs: integer(env.SHUTDOWN_GRACE_MS, 10_000, { minimum: 1_000, maximum: 60_000 }),
    maxSyncAgeMs: integer(env.MAX_SYNC_AGE_SECONDS, 3_600, { minimum: 60, maximum: 86_400 }) * 1_000,
    shadowWriteEnabled: String(env.SHADOW_WRITE_ENABLED || 'false').trim().toLowerCase() === 'true',
    allowedOrigins: new Set(csv(env.ALLOWED_ORIGINS, ['https://nkuchenov-hash.github.io'])),
    serviceVersion: String(env.SERVICE_VERSION || 'development').trim()
  });
}
