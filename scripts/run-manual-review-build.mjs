import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){
  console.error('Usage: node scripts/run-manual-review-build.mjs <slug>');
  process.exit(1);
}
const dir=path.join(root,'data','manual-review-builds',`${slug}.parts`);
if(!fs.existsSync(dir)){
  console.error(`Manual review build not found: ${dir}`);
  process.exit(2);
}
const parts=fs.readdirSync(dir).filter(name=>name.endsWith('.b64part')).sort();
if(!parts.length){
  console.error(`No .b64part files found for ${slug}`);
  process.exit(2);
}
const buffers=parts.map(name=>Buffer.from(fs.readFileSync(path.join(dir,name),'utf8').trim(),'base64'));
const source=Buffer.concat(buffers);
const tempDir=path.join(root,'.tmp-manual-review-builds');
fs.mkdirSync(tempDir,{recursive:true});
const scriptPath=path.join(tempDir,`${slug}.mjs`);
fs.writeFileSync(scriptPath,source);
console.log(`Restored ${slug} manual build from ${parts.length} parts (${source.length} bytes).`);
const result=spawnSync(process.execPath,[scriptPath],{cwd:root,stdio:'inherit',env:process.env});
try{fs.rmSync(tempDir,{recursive:true,force:true})}catch{}
if((result.status??1)!==0)process.exit(result.status??1);
