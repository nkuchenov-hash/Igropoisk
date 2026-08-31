import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishNewsSnapshot } from './publish-news-storage-core.mjs';

export * from './publish-news-storage-core.mjs';

export function pendingVerifiedGamePages({ root = process.cwd() } = {}) {
  const file = path.join(root, 'tmp/news-game-page-requests.json');
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const requests = Array.isArray(payload?.requests) ? payload.requests : [];
    return {
      count: Number(payload?.count ?? requests.length ?? 0),
      requests
    };
  } catch {
    return { count: 0, requests: [] };
  }
}

export async function publishNewsSnapshotWhenPagesReady(options = {}) {
  const root = options.root || process.cwd();
  const pending = pendingVerifiedGamePages({ root });
  if (pending.count > 0) {
    const report = {
      schema_version: 1,
      status: 'deferred',
      reason: 'verified-game-pages-not-live',
      pending_game_pages: pending.count,
      generated_at: new Date().toISOString()
    };
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp/news-storage-publication-deferred.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[news/storage] publication deferred: ${pending.count} verified game page(s) must become live first. Previous Object Storage snapshot remains active.`);
    return report;
  }
  return publishNewsSnapshot(options);
}

export function parsePublicationArguments(argv = []) {
  return { dryRun: argv.includes('--dry-run') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishNewsSnapshotWhenPagesReady(parsePublicationArguments(process.argv.slice(2)));
  if (result?.manifest) {
    console.log(`${result.dryRun ? 'Prepared' : 'Published'} news snapshot ${result.manifest.version}: ${Object.keys(result.manifest.files).length} compact JSON files, ${result.archive.months} archive months (${result.archive.monthsWritten} rewritten), ${result.media.length} cached media references, ${result.manifest.media.fallbackCount} media fallbacks.`);
  }
}
