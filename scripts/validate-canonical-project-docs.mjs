#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = 'config/canonical-project-docs.json';
const WORKFLOW_PATH = '.github/workflows/phase-a-validation.yml';

// Deliberately hard-coded as well as configured: removing a document from the
// JSON registry must not silently disable protection.
const REQUIRED = new Map([
  ['IGROPOISK_PROJECT_ROADMAP', 'docs/PROJECT_ROADMAP.md'],
  ['IGROPOISK_SYSTEM_ARCHITECTURE', 'docs/SYSTEM_ARCHITECTURE.md'],
]);

const fail = (message) => {
  console.error(`CANONICAL_DOCS_ERROR: ${message}`);
  process.exitCode = 1;
};

const readText = (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`required file is missing: ${relativePath}`);
    return null;
  }
  if (!fs.statSync(absolutePath).isFile()) {
    fail(`required path is not a file: ${relativePath}`);
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const configText = readText(CONFIG_PATH);
let config = null;
if (configText) {
  try {
    config = JSON.parse(configText);
  } catch (error) {
    fail(`${CONFIG_PATH} is invalid JSON: ${error.message}`);
  }
}

if (config) {
  if (config.schemaVersion !== 1) {
    fail(`${CONFIG_PATH} schemaVersion must be 1`);
  }

  if (!Array.isArray(config.documents)) {
    fail(`${CONFIG_PATH} documents must be an array`);
  } else {
    const ids = new Set();
    const paths = new Set();

    for (const doc of config.documents) {
      if (!doc || typeof doc !== 'object') {
        fail('canonical document entry must be an object');
        continue;
      }

      if (!doc.id || !doc.path) {
        fail('canonical document entry requires id and path');
        continue;
      }

      if (ids.has(doc.id)) fail(`duplicate canonical document id: ${doc.id}`);
      if (paths.has(doc.path)) fail(`duplicate canonical document path: ${doc.path}`);
      ids.add(doc.id);
      paths.add(doc.path);

      const text = readText(doc.path);
      if (!text) continue;

      const byteLength = Buffer.byteLength(text, 'utf8');
      const minimumBytes = Number(doc.minimumBytes || 1);
      if (byteLength < minimumBytes) {
        fail(`${doc.path} is suspiciously small: ${byteLength} bytes < ${minimumBytes}`);
      }

      for (const token of doc.requiredText || []) {
        if (!text.includes(token)) {
          fail(`${doc.path} lost required architecture token: ${JSON.stringify(token)}`);
        }
      }
    }

    for (const [id, requiredPath] of REQUIRED) {
      const registered = config.documents.find((doc) => doc.id === id);
      if (!registered) {
        fail(`${id} was removed from ${CONFIG_PATH}`);
      } else if (registered.path !== requiredPath) {
        fail(`${id} canonical path changed from ${requiredPath} to ${registered.path}`);
      }
    }
  }

  for (const entrypoint of config.entrypoints || []) {
    const text = readText(entrypoint.path);
    if (!text) continue;
    for (const token of entrypoint.requiredText || []) {
      if (!text.includes(token)) {
        fail(`${entrypoint.path} must visibly reference ${token}`);
      }
    }
  }

  for (const supportPath of config.protectedSupportFiles || []) {
    readText(supportPath);
  }
}

// Prevent an accidental duplicate from becoming a competing source of truth.
const docsRoot = path.join(ROOT, 'docs');
if (fs.existsSync(docsRoot)) {
  const markdownFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(full);
    }
  };
  walk(docsRoot);

  const architectureMarker = 'CANONICAL_PROJECT_DOCUMENT: IGROPOISK_SYSTEM_ARCHITECTURE';
  const roadmapTitle = '# Игропоиск — канонический ПУТЬ проекта';
  let architectureMarkers = 0;
  let roadmapTitles = 0;

  for (const file of markdownFiles) {
    const text = fs.readFileSync(file, 'utf8');
    architectureMarkers += text.split(architectureMarker).length - 1;
    roadmapTitles += text.split(roadmapTitle).length - 1;
  }

  if (architectureMarkers !== 1) {
    fail(`expected exactly one canonical system architecture marker, found ${architectureMarkers}`);
  }
  if (roadmapTitles !== 1) {
    fail(`expected exactly one canonical roadmap title, found ${roadmapTitles}`);
  }
}

// The existing required production/staging gate must invoke this guard. This
// makes protection part of the established gate instead of a best-effort side workflow.
const workflow = readText(WORKFLOW_PATH);
if (workflow && !workflow.includes('node scripts/validate-canonical-project-docs.mjs')) {
  fail(`${WORKFLOW_PATH} must execute validate-canonical-project-docs.mjs`);
}

if (process.exitCode) {
  console.error('Canonical project document protection FAILED.');
  process.exit(process.exitCode);
}

console.log('Canonical project documents: protected and consistent.');
