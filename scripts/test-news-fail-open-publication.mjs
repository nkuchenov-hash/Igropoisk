import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPipeline } from './run-news-pipeline.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-fail-open-'));
const configPath = path.join(temp, 'config.json');
const reportPath = path.join(temp, 'report.json');
const now = Date.parse('2026-09-03T08:00:00.000Z');
const config = {
  groups: [
    { id: 'source-a', interval_minutes: 60, freshness_file: 'missing-a.json', commands: ['source-a'] },
    { id: 'source-b', interval_minutes: 60, freshness_file: 'missing-b.json', commands: ['source-b'] }
  ],
  rebuild_commands: ['rebuild'],
  health: { command: 'health' },
  validation_commands: ['quality-check']
};
fs.writeFileSync(configPath, JSON.stringify(config));

const executed = [];
const result = runPipeline({
  configPath,
  reportPath,
  now,
  readJson: file => {
    if (file === configPath) return config;
    throw new Error('not generated yet');
  },
  commandRunner: command => {
    executed.push(command);
    if (command === 'source-a' || command === 'quality-check') return { status: 1, signal: null };
    return { status: 0, signal: null };
  }
});

assert.equal(result.status, 'success', 'one source or quality failure must never stop the news publication cycle');
assert.equal(result.publication_eligible, true, 'the publication cycle must remain eligible after non-fatal internal failures');
assert.equal(result.degraded, true, 'fail-open failures must remain visible in diagnostics');
assert.equal(result.failed_stages.length, 2);
assert.deepEqual(executed, [
  'source-a',
  'source-b',
  'rebuild',
  'health --groups source-a,source-b --run-started-at 2026-09-03T08:00:00.000Z',
  'quality-check'
], 'every remaining stage must continue after an earlier failure');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert.equal(report.publication_policy, 'fail-open-item-filtered');
assert.equal(report.status, 'success');
assert.equal(report.failed_stages.length, 2);

fs.rmSync(temp, { recursive: true, force: true });
console.log('News fail-open publication contract passed: internal failures never stop the whole feed.');
