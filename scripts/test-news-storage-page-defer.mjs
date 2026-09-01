import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePublicationArguments, pendingVerifiedGamePages } from './publish-news-storage.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-publish-pages-'));
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
assert.equal(pendingVerifiedGamePages({ root }).count, 0);
assert.deepEqual(parsePublicationArguments([]), { dryRun: false });
assert.deepEqual(parsePublicationArguments(['--dry-run']), { dryRun: true });

fs.writeFileSync(path.join(root, 'tmp/news-game-page-requests.json'), JSON.stringify({
  count: 2,
  requests: [{ slug: 'new-game-a' }, { slug: 'new-game-b' }]
}));
const pending = pendingVerifiedGamePages({ root });
assert.equal(pending.count, 2);
assert.deepEqual(pending.requests.map(item => item.slug), ['new-game-a', 'new-game-b']);

fs.rmSync(root, { recursive: true, force: true });
console.log('News storage publication defer guard and CLI contract passed.');
