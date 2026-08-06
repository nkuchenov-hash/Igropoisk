import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function withTemporarySnapshot(body, work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'igropoisk-news-shadow-'));
  const file = path.join(directory, 'news-events.json');
  try {
    await fs.writeFile(file, body, { mode: 0o600, flag: 'wx' });
    return await work(file);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export async function writeReport(file, report) {
  if (!file) return;
  const target = path.resolve(process.cwd(), file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, target);
}
