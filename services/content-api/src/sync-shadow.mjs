import path from 'node:path';
import { closePool, getPool } from './database.mjs';
import { importSnapshot } from './import-snapshot.mjs';
import { compareSnapshot } from './compare-snapshot.mjs';

function argumentsFrom(argv) {
  const result = {
    file: path.resolve(process.cwd(), '../../data/news-events.json'),
    channel: 'news',
    snapshotVersion: '',
    manifestUrl: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--file' && value) result.file = path.resolve(process.cwd(), value);
    if (name === '--channel' && value) result.channel = value;
    if (name === '--snapshot-version' && value) result.snapshotVersion = value;
    if (name === '--manifest-url' && value) result.manifestUrl = value;
    if (name.startsWith('--') && value && !value.startsWith('--')) index += 1;
  }
  return result;
}

export async function synchronizeShadow({
  pool = getPool(),
  file,
  channel = 'news',
  snapshotVersion = '',
  manifestUrl = ''
}) {
  const imported = await importSnapshot({ pool, file, channel, snapshotVersion, manifestUrl });
  const comparison = await compareSnapshot({ pool, file, channel, record: true });
  return { imported, comparison };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = argumentsFrom(process.argv.slice(2));
  try {
    const result = await synchronizeShadow(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.comparison.status !== 'exact') process.exitCode = 2;
  } finally {
    await closePool();
  }
}
