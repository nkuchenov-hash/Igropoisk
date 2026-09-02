#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

const slug=String(process.argv[2]||'').trim();
const gameId=String(process.argv[3]||'').trim();
if(!slug)throw new Error('Usage: node scripts/materialize-green-game-page.mjs <slug> [game-id]');
const child=spawnSync('node',['scripts/finalize-game-page-publication.mjs',slug,gameId],{cwd:process.cwd(),encoding:'utf8',stdio:'inherit',env:process.env});
if(child.error)throw child.error;
process.exit(child.status??2);
