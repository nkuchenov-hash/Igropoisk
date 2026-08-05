import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const configPath = path.join(root, 'config/parsers/schedule.json');
const reportPath = path.join(root, 'data/parser-runs/scheduler.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const checkedAt = new Date().toISOString();
const now = Date.now();
const force = /^(1|true|yes)$/i.test(String(process.env.PARSER_FORCE || ''));
const results = [];

function git(args, options = {}) {
  return execSync(`git ${args}`, { cwd: root, stdio: options.stdio || 'pipe', encoding: 'utf8', env: process.env });
}
function existingOutputs(outputs) {
  return (outputs || []).filter(output => fs.existsSync(path.join(root, output)));
}
function restoreOutputs(outputs) {
  for (const output of (outputs || []).filter(Boolean)) {
    const quoted = JSON.stringify(output);
    try { git(`restore --staged --worktree -- ${quoted}`); } catch {}
    try { git(`clean -fd -- ${quoted}`); }
    catch (error) { console.error(`Failed to clean incomplete parser output ${output}: ${error.message}`); }
  }
}

for (const parser of config.parsers || []) {
  if (!parser.enabled) { results.push({ id: parser.id, status: 'disabled' }); continue; }
  const runFile = path.join(root, `data/parser-runs/${parser.id}.json`);
  let lastRun = 0;
  try {
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    lastRun = Date.parse(run.checked_at || run.generated_at || 0) || 0;
  } catch {}
  const intervalMs = Number(parser.interval_minutes || config.default_interval_minutes || 60) * 60_000;
  const due = force || !lastRun || now - lastRun >= intervalMs - 5 * 60_000;
  if (!due) {
    const nextRunAt = new Date(lastRun + intervalMs).toISOString();
    console.log(`${parser.id}: skipped, next interval at ${nextRunAt}`);
    results.push({ id: parser.id, status: 'skipped', last_run_at: lastRun ? new Date(lastRun).toISOString() : null, next_run_at: nextRunAt });
    continue;
  }
  const started = Date.now();
  console.log(`${parser.id}: running ${parser.command}`);
  try {
    execSync(parser.command, { cwd: root, stdio: 'inherit', env: process.env });
    results.push({ id: parser.id, status: 'success', duration_ms: Date.now() - started, outputs: existingOutputs(parser.outputs) });
  } catch (error) {
    console.error(`${parser.id}: failed with exit code ${error.status ?? 'unknown'}`);
    restoreOutputs(parser.outputs);
    results.push({ id: parser.id, status: 'error', duration_ms: Date.now() - started, error: error.message, outputs_restored: true });
  }
}

let editorialQuality = { status: 'skipped' };
if (fs.existsSync(path.join(root, 'data/popular/current.json')) && fs.existsSync(path.join(root, 'data/releases/current.json'))) {
  const started = Date.now();
  try {
    execSync('node scripts/curate-home-feeds.mjs', { cwd: root, stdio: 'inherit', env: process.env });
    editorialQuality = { status: 'success', duration_ms: Date.now() - started, output: 'data/home-feeds-quality.json' };
  } catch (error) {
    editorialQuality = { status: 'error', duration_ms: Date.now() - started, error: error.message };
    results.push({ id: 'editorial-quality', ...editorialQuality });
  }
}

const failed = results.filter(result => result.status === 'error');
const succeeded = results.filter(result => result.status === 'success');
const report = {
  schema_version: 2,
  checked_at: checkedAt,
  forced: force,
  status: failed.length ? (succeeded.length ? 'partial' : 'error') : 'success',
  summary: {
    enabled: results.filter(result => result.status !== 'disabled').length,
    succeeded: succeeded.length,
    failed: failed.length,
    skipped: results.filter(result => result.status === 'skipped').length
  },
  editorial_quality: editorialQuality,
  results
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
