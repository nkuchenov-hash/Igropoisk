import fs from 'node:fs';

const scope = process.argv[2] || 'news-ui';
const changed = fs.readFileSync(0, 'utf8').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
const rules = {
  'news-ui': [
    /^features\/news\//
  ],
  'news-content': [
    /^data\/news(?:-[^/]+)?\.json$/,
    /^data\/news\//,
    /^data\/parser-runs\/news[^/]*\.json$/,
    /^assets\/news\//,
    /^assets\/publisher-news\//
  ]
};
const allowed = rules[scope];
if (!allowed) throw new Error(`Unknown boundary scope: ${scope}`);
const violations = changed.filter(path => !allowed.some(pattern => pattern.test(path)));
if (violations.length) {
  throw new Error(`${scope} change crossed the module boundary:\n${violations.map(path => `- ${path}`).join('\n')}`);
}
console.log(`${scope} boundary verified for ${changed.length} changed file(s).`);
