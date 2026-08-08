import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/run-review-synthesis.mjs <slug>');process.exit(1)}
const sourcePath=path.join(root,'scripts/synthesize-review.mjs');
let source=fs.readFileSync(sourcePath,'utf8');
const marker='Не раскрывай крупные сюжетные повороты.';
const guidance=' Не бойся лёгкой иронии и сухого юмора, когда сама механика, условность или устаревшее решение игры это провоцирует. Юмор должен быть редким, точным и доброжелательным: максимум одна короткая ироничная реплика на несколько абзацев, без мемов, стендапа, сарказма ради сарказма и без подмены анализа шутками.';
if(!source.includes(marker))throw new Error('Review synthesis prompt marker not found');
source=source.replace(marker,marker+guidance);
const tempPath=path.join(os.tmpdir(),`igropoisk-synthesize-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(tempPath,source);
try{
  const result=spawnSync(process.execPath,[tempPath,slug],{cwd:root,stdio:'inherit',env:process.env});
  process.exitCode=result.status??1;
}finally{
  try{fs.unlinkSync(tempPath)}catch{}
}
