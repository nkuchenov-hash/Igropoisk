import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonBuffer = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const safeImage = value => /^(assets\/(?:news|publisher-news)\/[a-f0-9]{16}\.(?:jpg|jpeg|png|webp|avif|gif))$/i.test(String(value || ''));

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return ({
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif'
  })[extension] || 'application/octet-stream';
}

function collectImagePaths(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectImagePaths(item, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'image' && typeof child === 'string' && safeImage(child)) output.add(child);
    else collectImagePaths(child, output);
  }
  return output;
}

function replaceImagePaths(value, replacements) {
  if (Array.isArray(value)) return value.map(item => replaceImagePaths(item, replacements));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === 'image' && typeof child === 'string' && replacements.has(child)
      ? replacements.get(child)
      : replaceImagePaths(child, replacements)
  ]));
}

function versionId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.000', '').replace(/\.\d{3}/, '');
  const revision = String(process.env.GITHUB_SHA || 'local').slice(0, 12);
  const run = String(process.env.GITHUB_RUN_ID || 'manual');
  return `${timestamp}-${revision}-${run}`;
}

async function exists(storage, key) {
  try {
    await storage.headObject(key);
    return true;
  } catch (error) {
    if (/failed with 404/.test(error.message)) return false;
    throw error;
  }
}

export async function publishNewsSnapshot({
  root = process.cwd(),
  configPath = 'config/news-pipeline.json',
  storage = createYandexObjectStorageClient(),
  now = new Date(),
  dryRun = false
} = {}) {
  const config = readJson(path.join(root, configPath));
  const requiredFiles = config.publication?.required_files || [];
  const storageConfig = config.publication?.storage || {};
  const snapshotPrefix = storageConfig.snapshot_prefix || 'news/snapshots';
  const mediaPrefix = storageConfig.media_prefix || 'news/media';
  const currentManifestKey = storageConfig.current_manifest || 'news/manifests/current.json';
  const immutableCache = storageConfig.immutable_cache_control || 'public, max-age=31536000, immutable';
  const manifestCache = storageConfig.manifest_cache_control || 'no-store, max-age=0';
  const version = versionId(now);
  const snapshotRoot = `${snapshotPrefix}/${version}`;

  const payloads = new Map();
  for (const relative of requiredFiles) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) throw new Error(`Required news output is missing: ${relative}`);
    payloads.set(relative, readJson(absolute));
  }

  const imagePaths = new Set();
  for (const payload of payloads.values()) collectImagePaths(payload, imagePaths);
  const imageUrls = new Map();
  const media = [];

  for (const relative of [...imagePaths].sort()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) throw new Error(`News image is missing: ${relative}`);
    const body = fs.readFileSync(absolute);
    const digest = sha256(body);
    const extension = path.extname(relative).toLowerCase();
    const key = `${mediaPrefix}/${digest}${extension}`;
    const publicUrl = storage.publicUrl(key);
    imageUrls.set(relative, publicUrl);
    media.push({ source: relative, key, url: publicUrl, sha256: digest, bytes: body.length });
    if (!dryRun && !(await exists(storage, key))) {
      await storage.putObject(key, body, { contentType: contentType(relative), cacheControl: immutableCache });
      await storage.headObject(key);
    }
  }

  const files = {};
  let snapshotBytes = 0;
  for (const [relative, payload] of payloads) {
    const transformed = replaceImagePaths(payload, imageUrls);
    const body = jsonBuffer(transformed);
    const key = `${snapshotRoot}/${relative}`;
    const digest = sha256(body);
    files[relative] = { key, url: storage.publicUrl(key), sha256: digest, bytes: body.length };
    snapshotBytes += body.length;
    if (!dryRun) {
      await storage.putObject(key, body, { contentType: contentType(relative), cacheControl: immutableCache });
      const head = await storage.headObject(key);
      const storedBytes = Number(head.headers.get('content-length') || 0);
      if (storedBytes && storedBytes !== body.length) throw new Error(`Stored size mismatch for ${relative}.`);
    }
  }

  const maximumBytes = Number(storageConfig.maximum_snapshot_bytes || 25_000_000);
  if (snapshotBytes > maximumBytes) {
    throw new Error(`News JSON snapshot is ${snapshotBytes} bytes; maximum is ${maximumBytes}.`);
  }

  const manifest = {
    schemaVersion: 1,
    channel: 'news',
    version,
    publishedAt: now.toISOString(),
    sourceCommit: process.env.GITHUB_SHA || '',
    sourceRunId: process.env.GITHUB_RUN_ID || '',
    baseUrl: storage.publicUrl(`${snapshotRoot}/`),
    files,
    media: { count: media.length, bytes: media.reduce((sum, item) => sum + item.bytes, 0) },
    snapshot: { bytes: snapshotBytes },
    repositoryFallback: true
  };
  const manifestBody = jsonBuffer(manifest);
  const snapshotManifestKey = `${snapshotRoot}/manifest.json`;

  if (!dryRun) {
    await storage.putObject(snapshotManifestKey, manifestBody, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: immutableCache
    });
    await storage.headObject(snapshotManifestKey);
    await storage.putObject(currentManifestKey, manifestBody, {
      contentType: 'application/json; charset=utf-8',
      cacheControl: manifestCache
    });
    const published = await storage.getObject(currentManifestKey);
    const readBack = await published.json();
    if (readBack.version !== version || readBack.schemaVersion !== 1) {
      throw new Error('Current news manifest did not switch to the verified snapshot.');
    }
  }

  return { manifest, media, dryRun };
}

function parseArguments(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishNewsSnapshot(parseArguments(process.argv.slice(2)));
  console.log(`${result.dryRun ? 'Prepared' : 'Published'} news snapshot ${result.manifest.version}: ${Object.keys(result.manifest.files).length} JSON files, ${result.media.length} media objects.`);
}
