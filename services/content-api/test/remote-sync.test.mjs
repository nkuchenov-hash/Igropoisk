import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncRemoteSnapshot } from '../src/sync-remote.mjs';
import { fixtureServer } from './helpers/remote-fixture.mjs';

test('verified remote snapshot is synchronized, reported and temporary file is removed', async () => {
  const fixture = await fixtureServer();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'igropoisk-remote-report-'));
  const reportPath = path.join(directory, 'report.json');
  let temporaryFile;
  try {
    const report = await syncRemoteSnapshot({ manifestUrl: fixture.manifestUrl, reportPath,
      fetchOptions: { allowedHosts: ['127.0.0.1'], allowHttpForTests: true },
      synchronize: async options => {
        temporaryFile = options.file;
        assert.equal((await fs.stat(options.file)).mode & 0o777, 0o600);
        assert.equal(JSON.parse(await fs.readFile(options.file, 'utf8')).items.length, 1);
        return { imported: { itemCount: 1 }, comparison: { status: 'exact', sourceCount: 1, ledgerCount: 1 } };
      } });
    assert.equal(report.status, 'exact');
    assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).source.itemCount, 1);
    await assert.rejects(fs.stat(temporaryFile), { code: 'ENOENT' });
  } finally {
    await fixture.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
