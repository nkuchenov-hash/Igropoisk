import assert from 'node:assert/strict';
import test from 'node:test';
import { readRuntimeConfig } from '../src/runtime-config.mjs';

test('runtime defaults keep production reading Object Storage', () => {
  const config = readRuntimeConfig({ DATABASE_URL: 'postgresql://example/db' });
  assert.equal(config.runtimeMode, 'shadow');
  assert.equal(config.readSource, 'object_storage');
  assert.equal(config.port, 8080);
});

test('shadow mode cannot switch reads to the Content API', () => {
  assert.throws(() => readRuntimeConfig({
    DATABASE_URL: 'postgresql://example/db',
    CONTENT_RUNTIME_MODE: 'shadow',
    CONTENT_READ_SOURCE: 'content_api'
  }), /forbidden/);
});

test('runtime validates ports and required database configuration', () => {
  assert.throws(() => readRuntimeConfig({}), /DATABASE_URL/);
  assert.throws(() => readRuntimeConfig({
    DATABASE_URL: 'postgresql://example/db',
    PORT: '70000'
  }), /between/);
});
