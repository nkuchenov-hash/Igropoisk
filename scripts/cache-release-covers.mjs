import fs from 'node:fs';
import path from 'node:path';
import { ensureVisibleReleaseCovers, validateVisibleReleaseCovers } from './lib/release-cover-resolver.mjs';

const root = process.cwd();
const currentFile = path.join(root, 'data/releases/current.json');
const publicFile = path.join(root, 'data/releases/public.json');

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};
const writeJSON = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const keyOf = item => String(item?.id || item?.slug || '').trim();

const current = readJSON(currentFile, { releases: [] });
const publicCalendar = readJSON(publicFile, { releases: [], personalized_releases: [] });
const visibleByKey = new Map();
for (const release of [...(publicCalendar.releases || []), ...(publicCalendar.personalized_releases || [])]) {
  const key = keyOf(release);
  if (key && !visibleByKey.has(key)) visibleByKey.set(key, release);
}
const visible = [...visibleByKey.values()];
if (!visible.length) throw new Error('Public release calendar has no visible releases to cover.');

const resolution = await ensureVisibleReleaseCovers(visible, {
  root,
  visibleIds: visible.map(release => release.id),
  minimumBytes: 40_000,
  minimumWidth: 600,
  minimumHeight: 900,
  minimumRatio: 0.62,
  maximumRatio: 0.72,
  concurrency: 6
});

if (resolution.unresolved.length) {
  throw new Error(`Quality release covers unresolved: ${resolution.unresolved.map(item => `${item.slug}: ${item.error}`).join(' | ')}`);
}

const resolvedByKey = new Map(resolution.candidates.map(release => [keyOf(release), release]));
const syncRelease = release => {
  const resolved = resolvedByKey.get(keyOf(release));
  if (!resolved?.image) return release;
  return {
    ...release,
    external_ids: resolved.external_ids || release.external_ids,
    image: resolved.image,
    image_candidates: [...new Set([
      resolved.image.local_url,
      ...(release.image_candidates || []),
      ...(resolved.image.candidate_urls || [])
    ].filter(Boolean))]
  };
};

const nextPublic = {
  ...publicCalendar,
  releases: (publicCalendar.releases || []).map(syncRelease),
  personalized_releases: (publicCalendar.personalized_releases || []).map(syncRelease)
};
const validationErrors = validateVisibleReleaseCovers(nextPublic, {
  minimumBytes: 40_000,
  minimumWidth: 600,
  minimumHeight: 900,
  minimumRatio: 0.62,
  maximumRatio: 0.72
});
if (validationErrors.length) throw new Error(`Public cover contract failed: ${validationErrors.join(' | ')}`);

const nextCurrent = {
  ...current,
  releases: (current.releases || []).map(syncRelease)
};
writeJSON(currentFile, nextCurrent);
writeJSON(publicFile, nextPublic);

console.log(JSON.stringify({
  requested: resolution.statistics.requested,
  resolved: resolution.statistics.resolved,
  unresolved: resolution.statistics.unresolved,
  coverage_percent: resolution.statistics.coverage_percent,
  rule: 'Every visible release keeps its place and receives a verified >=600x900 portrait cover before publication; no card is dropped to hide missing media.'
}, null, 2));
