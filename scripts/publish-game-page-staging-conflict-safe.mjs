#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parserRunBelongsToSlug } from './lib/game-page-target-artifacts.mjs';

const sourceRoot = process.cwd();
const slug = String(process.argv[2] || process.env.GAME_TARGET_SLUG || '').trim().toLowerCase();
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
const reportPath = path.resolve(process.env.GAME_PAGE_STAGING_REPORT || path.join(os.tmpdir(), `igropoisk-game-page-staging-${runId}-${runAttempt}.json`));
const maxAttempts = Math.max(1, Math.min(5, Number(process.env.GAME_PAGE_STAGING_PUBLISH_ATTEMPTS || 3)));

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unsafe or missing game slug: ${slug || '(empty)'}`);

function command(name, args, { cwd = sourceRoot, quiet = false, allowFailure = false } = {}) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  if (!quiet && stdout.trim()) process.stdout.write(stdout);
  if (!quiet && stderr.trim()) process.stderr.write(stderr);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${name} ${args.join(' ')} failed (${result.status}): ${(stderr || stdout).trim()}`);
  }
  return { status: result.status, stdout, stderr };
}
const git = (args, options = {}) => command('git', args, options);
const gh = (args, options = {}) => command('gh', args, options);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const copyIfExists = (source, target) => {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
};

function copyTargetArtifacts(targetRoot) {
  const copied = [];
  const exact = [
    `data/parser-output/${slug}.json`,
    `data/reviews/${slug}.json`,
    `data/review-discovery-seeds/${slug}.json`,
    `data/ratings/${slug}.json`,
    `data/research/${slug}-source-matrix.json`,
    `data/similarity/${slug}.json`,
    `data/quality-control/page-${slug}-control.json`,
    `data/quality-control/game-page-${slug}.json`,
    `data/video-candidates/${slug}.json`,
  ];
  for (const relative of exact) {
    if (copyIfExists(path.join(sourceRoot, relative), path.join(targetRoot, relative))) copied.push(relative);
  }

  const parserRunsDir = path.join(sourceRoot, 'data/parser-runs');
  if (fs.existsSync(parserRunsDir)) {
    for (const name of fs.readdirSync(parserRunsDir)) {
      if (!parserRunBelongsToSlug(name, slug)) continue;
      const relative = `data/parser-runs/${name}`;
      if (copyIfExists(path.join(sourceRoot, relative), path.join(targetRoot, relative))) copied.push(relative);
    }
  }

  const sourceAcceptance = path.join(sourceRoot, 'data/content-pipeline/page-acceptance-target.json');
  const targetAcceptance = path.join(targetRoot, 'data/content-pipeline/page-acceptance-target.json');
  if (fs.existsSync(sourceAcceptance)) {
    const sourceValue = readJson(sourceAcceptance);
    let targetValue = null;
    try { targetValue = readJson(targetAcceptance); } catch {}
    const sourceSlug = String(sourceValue?.slug || sourceValue?.game_slug || '').trim().toLowerCase();
    const targetSlug = String(targetValue?.slug || targetValue?.game_slug || '').trim().toLowerCase();
    if (sourceSlug === slug && (!targetSlug || targetSlug === slug)) {
      copyIfExists(sourceAcceptance, targetAcceptance);
      copied.push('data/content-pipeline/page-acceptance-target.json');
    }
  }
  return copied;
}

function prepareFreshAttempt(targetRoot) {
  git(['fetch', 'origin', 'staging']);
  const baseSha = git(['rev-parse', 'origin/staging'], { quiet: true }).stdout.trim();
  git(['worktree', 'add', '--detach', targetRoot, baseSha]);

  const sourceReport = path.join(targetRoot, '.game-page-source-report.json');
  const materializedReport = path.join(targetRoot, '.game-page-materialized-report.json');
  writeJson(sourceReport, { ready_games: [{ slug }] });
  command(process.execPath, [
    path.join(sourceRoot, 'scripts/materialize-game-creator-pages.mjs'),
    '--target', targetRoot,
    '--report', sourceReport,
    '--output', materializedReport,
  ], { cwd: sourceRoot });
  fs.rmSync(sourceReport, { force: true });
  fs.rmSync(materializedReport, { force: true });

  const copied = copyTargetArtifacts(targetRoot);
  command(process.execPath, ['scripts/orchestrate-content.mjs', '--finalize'], { cwd: targetRoot });
  command(process.execPath, ['scripts/validate-game-shells.mjs', slug], { cwd: targetRoot });
  command(process.execPath, ['scripts/validate-pre-review-materials.mjs', slug], { cwd: targetRoot });
  const qcPath = path.join(targetRoot, `data/quality-control/page-${slug}-control.json`);
  if (!fs.existsSync(qcPath) || readJson(qcPath)?.green !== true) throw new Error(`Fresh staging candidate is not green for ${slug}`);
  git(['diff', '--check'], { cwd: targetRoot });
  return { baseSha, copied };
}

function readPrMergeState(prUrl, cwd) {
  const viewed = gh(['pr', 'view', prUrl, '--json', 'state,mergedAt,mergeCommit'], { cwd, quiet: true, allowFailure: true });
  if (viewed.status !== 0 || !viewed.stdout.trim()) return null;
  try { return JSON.parse(viewed.stdout); } catch { return null; }
}

let finalReport = null;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `igropoisk-staging-publish-${runId}-${attempt}-`));
  const targetRoot = path.join(tempRoot, 'staging');
  let branch = '';
  let prUrl = '';
  try {
    const prepared = prepareFreshAttempt(targetRoot);
    const changed = git(['status', '--porcelain'], { cwd: targetRoot, quiet: true }).stdout.trim();
    if (!changed) {
      finalReport = {
        status: 'already-current',
        slug,
        staging_sha: prepared.baseSha,
        attempt,
        copied_target_artifacts: prepared.copied,
      };
      break;
    }

    branch = `automation/post-create-safe-${runId}-${runAttempt}-${attempt}`;
    git(['checkout', '-b', branch], { cwd: targetRoot });
    git(['config', 'user.name', 'igropoisk-content-bot'], { cwd: targetRoot });
    git(['config', 'user.email', 'igropoisk-content-bot@users.noreply.github.com'], { cwd: targetRoot });
    git(['add', '-A'], { cwd: targetRoot });
    git(['commit', '-m', `Publish conflict-safe Game Page ${slug} ${runId}.${runAttempt}`], { cwd: targetRoot });
    git(['push', 'origin', branch], { cwd: targetRoot });
    prUrl = gh([
      'pr', 'create',
      '--base', 'staging',
      '--head', branch,
      '--title', `Publish bounded Game Page: ${slug}`,
      '--body', `Conflict-safe bounded Game Page publication for \`${slug}\`. The branch was materialized from the latest staging head and contains the verified target page, professional review/source corpus, all confirmed scores, QC artifacts, and freshly regenerated shared registries.`,
    ], { cwd: targetRoot, quiet: true }).stdout.trim();
    if (!prUrl) throw new Error('Staging PR URL was not returned');

    const mergeAttempt = gh(['pr', 'merge', prUrl, '--merge'], { cwd: targetRoot, quiet: true, allowFailure: true });
    const mergeState = readPrMergeState(prUrl, targetRoot);
    const didMerge = Boolean(mergeState?.mergedAt || mergeState?.mergeCommit?.oid || mergeState?.state === 'MERGED');
    if (mergeAttempt.status !== 0 && !didMerge) {
      gh(['pr', 'close', prUrl], { cwd: targetRoot, quiet: true, allowFailure: true });
      git(['push', 'origin', '--delete', branch], { cwd: targetRoot, quiet: true, allowFailure: true });
      console.error(`Staging changed during attempt ${attempt}; rebuilding ${slug} publication on the new staging head.`);
      continue;
    }

    git(['push', 'origin', '--delete', branch], { cwd: targetRoot, quiet: true, allowFailure: true });
    git(['fetch', 'origin', 'staging'], { cwd: targetRoot });
    const stagingSha = git(['rev-parse', 'origin/staging'], { cwd: targetRoot, quiet: true }).stdout.trim();
    finalReport = {
      status: 'published',
      slug,
      staging_sha: stagingSha,
      base_sha: prepared.baseSha,
      staging_pr: prUrl,
      staging_merge_sha: mergeState?.mergeCommit?.oid || null,
      attempt,
      copied_target_artifacts: prepared.copied,
    };
    break;
  } finally {
    git(['worktree', 'remove', '--force', targetRoot], { quiet: true, allowFailure: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (!finalReport) throw new Error(`Could not publish ${slug} to staging after ${maxAttempts} fresh-head attempts`);
writeJson(reportPath, finalReport);
console.log(JSON.stringify(finalReport, null, 2));
