#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page-baseline-editorial.mjs <slug>');

// The old fallback concatenated English source evidence while labelling it Russian.
// A fallback is still automatic, but it must use the same source-grounded Russian
// writer and quality bounds as the primary path. If that writer cannot produce a
// valid Russian page, fail closed instead of publishing source fragments.
const child=spawnSync('node',['scripts/build-game-page.mjs',slug],{
  cwd:process.cwd(),
  env:{...process.env,GAME_PAGE_EDITORIAL_RETRY:'fallback'},
  encoding:'utf8',
  stdio:'pipe',
  maxBuffer:32*1024*1024
});
if(child.stdout)process.stdout.write(child.stdout);
if(child.stderr)process.stderr.write(child.stderr);
if(child.status!==0)throw new Error(`${slug}: automatic source-grounded Russian fallback failed; page remains in revision state`);
