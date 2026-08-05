import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const defaultValidationCommands = [
  'node scripts/validate-news-pipeline.mjs --baseline HEAD',
  'node scripts/test-news-content-api.mjs',
  'node scripts/validate-news-module.mjs'
];

export function generatedAtFromPayload(payload) {
  const value = payload?.generatedAt || payload?.generated_at || payload?.checkedAt || payload?.checked_at || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function groupIsDue(group, now, readJson, force = false) {
  if (force) return true;
  let payload;
  try {
    payload = readJson(group.freshness_file);
  } catch {
    return true;
  }
  const lastRun = generatedAtFromPayload(payload);
  if (!lastRun) return true;
  const intervalMs = Number(group.interval_minutes || 60) * 60_000;
  return now - lastRun >= Math.max(0, intervalMs - 5 * 60_000);
}

export function selectDueGroups(config, { now = Date.now(), force = false, readJson }) {
  return (config.groups || []).filter(group => groupIsDue(group, now, readJson, force));
}

function defaultReadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function defaultCommandRunner(command) {
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: process.env
  });
  return { status: result.status ?? 1, signal: result.signal || null };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function runPipeline({
  configPath = 'config/news-pipeline.json',
  reportPath = process.env.NEWS_PIPELINE_REPORT || 'tmp/news-pipeline-report.json',
  force = false,
  now = Date.now(),
  readJson = defaultReadJson,
  commandRunner = defaultCommandRunner
} = {}) {
  const config = readJson(configPath);
  const startedAt = new Date(now).toISOString();
  const report = {
    schema_version: 1,
    pipeline: 'news',
    started_at: startedAt,
    finished_at: null,
    status: 'running',
    forced: force,
    due_groups: [],
    stages: []
  };

  const execute = (scope, command) => {
    const stageStarted = Date.now();
    const result = commandRunner(command);
    const stage = {
      scope,
      command,
      status: result.status === 0 ? 'success' : 'error',
      exit_code: result.status,
      signal: result.signal,
      duration_ms: Date.now() - stageStarted
    };
    report.stages.push(stage);
    if (result.status !== 0) throw new Error(`${scope} failed: ${command}`);
  };

  try {
    const dueGroups = selectDueGroups(config, { now, force, readJson });
    report.due_groups = dueGroups.map(group => group.id);
    if (!dueGroups.length) {
      report.status = 'noop';
      report.finished_at = new Date().toISOString();
      writeReport(reportPath, report);
      console.log('News pipeline is current; no source group is due.');
      return report;
    }

    for (const group of dueGroups) {
      for (const command of group.commands || []) execute(group.id, command);
    }
    for (const command of config.rebuild_commands || []) execute('rebuild', command);
    for (const command of config.validation_commands || defaultValidationCommands) execute('validation', command);

    report.status = 'success';
    report.finished_at = new Date().toISOString();
    writeReport(reportPath, report);
    console.log(`News pipeline completed: ${report.due_groups.join(', ')}`);
    return report;
  } catch (error) {
    report.status = 'error';
    report.error = error.message;
    report.finished_at = new Date().toISOString();
    writeReport(reportPath, report);
    throw error;
  }
}

function parseArguments(argv) {
  const result = { force: false, reportPath: undefined, configPath: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--force') result.force = true;
    else if (value === '--report') result.reportPath = argv[++index];
    else if (value === '--config') result.configPath = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  runPipeline(options);
}
