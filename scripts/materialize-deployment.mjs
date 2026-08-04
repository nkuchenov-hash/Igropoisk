import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const AUTH_VERSION = '20260804-6';
const HEADER_VERSION = '20260803-2';
const changed = new Set();

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function write(relativePath, content) {
  const absolutePath = path.join(ROOT, relativePath);
  const previous = fs.readFileSync(absolutePath, 'utf8');
  if (previous === content) return;
  fs.writeFileSync(absolutePath, content, 'utf8');
  changed.add(relativePath);
}

function injectBeforeClosing(text, closingTag, payload) {
  if (text.includes(payload)) return text;
  const index = text.toLowerCase().lastIndexOf(closingTag.toLowerCase());
  if (index < 0) throw new Error(`Missing ${closingTag}`);
  return `${text.slice(0, index).trimEnd()}\n${payload}\n${text.slice(index)}`;
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, files);
    else files.push(absolutePath);
  }
  return files;
}

function normalizeHomepage() {
  const relativePath = 'index.html';
  let html = read(relativePath);
  html = injectBeforeClosing(html, '</head>', '<link rel="stylesheet" href="fix.css">');
  html = injectBeforeClosing(html, '</body>', '<script src="fix.js"></script>');
  html = html.replace(
    /class="ig-button"\s+data-auth-link/g,
    'class="ig-button account-action" data-auth-link'
  );
  write(relativePath, html);
}

function normalizeAssetVersions() {
  const files = walk(ROOT).filter(file => /\.(?:html|js)$/i.test(file));
  for (const absolutePath of files) {
    const relativePath = path.relative(ROOT, absolutePath).split(path.sep).join('/');
    let content = fs.readFileSync(absolutePath, 'utf8');
    const next = content
      .replace(/auth\.js\?v=[0-9-]+/g, `auth.js?v=${AUTH_VERSION}`)
      .replace(/site-header\.css\?v=[0-9-]+/g, `site-header.css?v=${HEADER_VERSION}`)
      .replace(/site-header\.js\?v=[0-9-]+/g, `site-header.js?v=${HEADER_VERSION}`);
    if (next !== content) write(relativePath, next);
  }
}

function assertAuthLoopIsAbsent() {
  const auth = read('assets/auth.js');
  if (/new\s+MutationObserver\s*\(\s*syncHeader\s*\)/.test(auth)) {
    throw new Error('assets/auth.js still contains the recursive header MutationObserver');
  }
}

execFileSync(process.execPath, ['scripts/inject-release-ui.mjs'], { stdio: 'inherit' });
normalizeHomepage();
normalizeAssetVersions();
assertAuthLoopIsAbsent();
execFileSync('python3', ['scripts/enforce_layout_contract.py', '--write'], { stdio: 'inherit' });

console.log(changed.size ? `Materialized deployment files: ${[...changed].sort().join(', ')}` : 'Deployment files are already materialized.');
