import fs from 'node:fs';
import { execSync } from 'node:child_process';

const config = JSON.parse(fs.readFileSync('config/parsers/schedule.json', 'utf8'));
const now = Date.now();

for (const parser of config.parsers || []) {
  if (!parser.enabled) continue;
  const runFile = `data/parser-runs/${parser.id}.json`;
  let lastRun = 0;
  try {
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    lastRun = Date.parse(run.checked_at || run.generated_at || 0) || 0;
  } catch {}

  const intervalMs = Number(parser.interval_minutes || config.default_interval_minutes || 60) * 60_000;
  const due = !lastRun || now - lastRun >= intervalMs - 5 * 60_000;
  if (!due) {
    console.log(`${parser.id}: skipped, next interval not reached`);
    continue;
  }

  console.log(`${parser.id}: running ${parser.command}`);
  execSync(parser.command, { stdio: 'inherit', env: process.env });
}
