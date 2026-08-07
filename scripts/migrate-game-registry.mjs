#!/usr/bin/env node
import path from 'node:path';
import {migrateRepository, writeMigrationArtifacts} from './lib/game-registry-migration.mjs';

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const root = path.resolve(value('--root') ?? process.cwd());
const write = args.includes('--write');
const result = migrateRepository(root, {
  dryRun: !write,
  baseCommit: value('--base-commit') ?? process.env.GITHUB_SHA ?? null,
  publicBaseUrl: value('--public-base-url') ?? '/game'
});
let artifacts = null;
if (write) artifacts = writeMigrationArtifacts(root, result, {
  registryOut: value('--registry-out') ?? 'data/game-registry/registry.transition.json',
  reportOut: value('--report-out') ?? 'data/game-registry/migration-report.json'
});
console.log(JSON.stringify({...result.report, artifacts}, null, 2));
