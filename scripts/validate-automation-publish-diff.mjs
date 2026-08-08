import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROFILES = {
  'parser-50': {
    exact: new Set([
      'data/public/games.json',
      'data/public/catalog.json',
      'data/parser-report-50.json',
    ]),
    prefixes: ['data/drafts/'],
    patterns: [/^game\/[^/]+\/index\.html$/],
  },
  'content-pipeline': {
    exact: new Set(['data/catalog-visible.json']),
    prefixes: [
      'data/content-pipeline/',
      'data/game-registry/',
      'data/top-250/',
      'data/parser-runs/',
      'data/parser-output/',
      'data/drafts/',
      'data/game-content/',
      'data/research/',
      'data/reviews/',
      'data/ratings/',
      'data/media-candidates/',
      'data/articles/',
      'data/article-drafts/',
      'data/article-media/',
      'article/',
    ],
    patterns: [/^game\/[^/]+\/index\.html$/],
  },
};

function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    const separator = entry.indexOf('\t');
    if (separator === -1) return { status: '', path: entry.trim() };
    return {
      status: entry.slice(0, separator).trim(),
      path: entry.slice(separator + 1).trim(),
    };
  }
  return {
    status: String(entry?.status ?? '').trim(),
    path: String(entry?.path ?? '').trim(),
  };
}

function isAllowedPath(profile, path) {
  return profile.exact.has(path)
    || profile.prefixes.some((prefix) => path.startsWith(prefix))
    || profile.patterns.some((pattern) => pattern.test(path));
}

export function validateEntries(profileName, rawEntries) {
  const profile = PROFILES[profileName];
  if (!profile) return [`Unknown automation diff profile: ${profileName}`];

  const errors = [];
  for (const rawEntry of rawEntries) {
    const { status, path } = normalizeEntry(rawEntry);
    if (!status && !path) continue;
    if (!status || !path) {
      errors.push(`Malformed staged diff entry: ${JSON.stringify(rawEntry)}`);
      continue;
    }

    const primaryStatus = status[0];
    if (!['A', 'M'].includes(primaryStatus)) {
      errors.push(`Automation may only add or modify files: ${status}\t${path}`);
      continue;
    }

    if (path === 'game/_shared' || path.startsWith('game/_shared/')) {
      errors.push(`Protected game runtime path is immutable for automation: ${path}`);
      continue;
    }

    if (!isAllowedPath(profile, path)) {
      errors.push(`Path is outside the ${profileName} automation allowlist: ${path}`);
    }
  }

  return errors;
}

function readStagedEntries() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-status', '--no-renames'],
    { encoding: 'utf8' },
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function parseProfile(argv) {
  const direct = argv.find((arg) => arg.startsWith('--profile='));
  if (direct) return direct.slice('--profile='.length);
  const index = argv.indexOf('--profile');
  return index >= 0 ? argv[index + 1] : '';
}

function main() {
  const profileName = parseProfile(process.argv.slice(2));
  if (!profileName) {
    throw new Error('Usage: node scripts/validate-automation-publish-diff.mjs --profile <name>');
  }

  const entries = readStagedEntries();
  const errors = validateEntries(profileName, entries);
  if (errors.length) {
    console.error(`Automation publish diff rejected (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Automation publish diff accepted: profile=${profileName}; files=${entries.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
