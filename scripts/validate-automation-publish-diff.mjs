import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROFILES = {
  'parser-50': {
    exact: new Set(['data/public/games.json','data/public/catalog.json','data/parser-report-50.json']),
    prefixes: ['data/drafts/'],
    patterns: [/^game\/[^/]+\/index\\.html$/],
  },
  'content-pipeline': {
    exact: new Set(['data/catalog-visible.json']),
    prefixes: [
      'data/content-pipeline/','data/game-registry/','data/top-250/','data/parser-runs/',
      'data/parser-output/','data/drafts/','data/game-content/','data/game-dna/',
      'data/research/','data/reviews/','data/ratings/','data/similarity/','data/franchises/',
      'data/guides/','data/quality-control/','data/media-candidates/','data/articles/',
      'data/article-drafts/','data/article-media/','article/',
    ],
    patterns: [/^game\/[^/]+\/index\\.html$/],
  },
};

function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    const separator = entry.indexOf('\t');
    if (separator === -1) return { status: '', path: entry.trim() };
    return { status: entry.slice(0, separator).trim(), path: entry.slice(separator + 1).trim() };
  }
  return { status: String(entry?.status ?? '').trim(), path: String(entry?.path ?? '').trim() };
}
function isAllowedPath(profile, filePath) {
  return profile.exact.has(filePath)
    || profile.prefixes.some(prefix => filePath.startsWith(prefix))
    || profile.patterns.some(pattern => pattern.test(filePath));
}
export function validateEntries(profileName, rawEntries) {
  const profile = PROFILES[profileName];
  if (!profile) return [`Unknown automation diff profile: ${profileName}`];
  const errors = [];
  for (const rawEntry of rawEntries) {
    const { status, path: filePath } = normalizeEntry(rawEntry);
    if (!status && !filePath) continue;
    if (!status || !filePath) { errors.push(`Malformed staged diff entry: ${JSON.stringify(rawEntry)}`); continue; }
    if (!['A','M'].includes(status[0])) { errors.push(`Automation may only add or modify files: ${status}\t${filePath}`); continue; }
    if (filePath === 'game/_shared' || filePath.startsWith('game/_shared/')) {
      errors.push(`Protected game runtime path is immutable for automation: ${filePath}`); continue;
    }
    if (!isAllowedPath(profile, filePath)) errors.push(`Path is outside the ${profileName} automation allowlist: ${filePath}`);
  }
  return errors;
}
function readStagedEntries() {
  const output = execFileSync('git', ['diff','--cached','--name-status','--no-renames'], { encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean);
}
function parseProfile(argv) {
  const direct = argv.find(arg => arg.startsWith('--profile='));
  if (direct) return direct.slice('--profile='.length);
  const index = argv.indexOf('--profile');
  if (index !== -1) return argv[argv+index+1] || '';
  return 'content-pipeline';
}
function main() {
  const profileName = parseProfile(process.argv.slice(2));
  const errors = validateEntries(profileName, readStagedEntries());
  if (errors.length) { console.error(errors.join('\n')); process.exit(2); }
  console.log(`Automation diff is isolated for profile ${profileName}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
