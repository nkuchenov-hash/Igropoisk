import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AUTH_VERSION = '20260804-6';
const HEADER_VERSION = '20260803-2';
const errors = [];

const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const count = (text, fragment) => text.split(fragment).length - 1;
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else files.push(absolute);
  }
  return files;
}

const homepage = read('index.html');
assert(count(homepage, '<link rel="stylesheet" href="fix.css">') === 1, 'index.html must contain exactly one explicit fix.css link.');
assert(count(homepage, '<script src="fix.js"></script>') === 1, 'index.html must contain exactly one explicit fix.js script.');
assert(homepage.includes('class="ig-button account-action" data-auth-link'), 'Homepage account action is not materialized.');
assert(homepage.includes('data-ig-release-nav'), 'Homepage release calendar navigation is missing.');
assert(homepage.includes('data-ig-home-editorial="section"'), 'Homepage editorial/release section is missing.');
assert(homepage.includes('assets/reviews-of-day/index.css?v=20260819-1'), 'Reviews-of-day stylesheet is missing.');
assert(homepage.includes('assets/home-releases/index.css?v=20260804-1'), 'Home releases stylesheet is missing.');
assert(homepage.includes('assets/reviews-of-day/index.js?v=20260819-2'), 'Reviews-of-day script is missing.');
assert(homepage.includes('assets/home-releases/index.js?v=20260805-1'), 'Home releases script is missing.');
assert(homepage.includes('href="reviews/"'), 'Homepage review archive link is missing.');
assert(!/data-ig-release-home|assets\/release-home\.(?:css|js)/.test(homepage), 'Legacy release-home injection remains in index.html.');

const auth = read('assets/auth.js');
assert(!/new\s+MutationObserver\s*\(\s*syncHeader\s*\)/.test(auth), 'assets/auth.js contains the recursive header MutationObserver.');

for (const absolute of walk(ROOT).filter(file => file.endsWith('.html'))) {
  const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
  const html = fs.readFileSync(absolute, 'utf8');

  for (const match of html.matchAll(/auth\.js(?:\?v=([0-9-]+))?/g)) {
    assert(match[1] === AUTH_VERSION, `${relative} references auth.js without the canonical version ${AUTH_VERSION}.`);
  }
  for (const match of html.matchAll(/site-header\.css(?:\?v=([0-9-]+))?/g)) {
    assert(match[1] === HEADER_VERSION, `${relative} references site-header.css without the canonical version ${HEADER_VERSION}.`);
  }
  for (const match of html.matchAll(/site-header\.js(?:\?v=([0-9-]+))?/g)) {
    assert(match[1] === HEADER_VERSION, `${relative} references site-header.js without the canonical version ${HEADER_VERSION}.`);
  }
}

if (errors.length) {
  throw new Error(`Deployment source is not canonical:\n${errors.map(error => `- ${error}`).join('\n')}`);
}

console.log('Deployment source is canonical and requires no build-time rewriting.');
