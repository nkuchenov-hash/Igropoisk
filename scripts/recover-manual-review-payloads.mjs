import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/recover-manual-review-payloads.mjs <slug>');process.exit(1)}
const dir=path.join(root,'data','manual-review-builds',`${slug}.parts`);
const parts=fs.readdirSync(dir).filter(name=>name.endsWith('.b64part')).sort();
const rawParts=parts.map(name=>fs.readFileSync(path.join(dir,name),'utf8').trim());
const variants=[
  {name:'joined-base64',bytes:Buffer.from(rawParts.join(''),'base64')},
  {name:'per-part-base64',bytes:Buffer.concat(rawParts.map(value=>Buffer.from(value,'base64')))}
];
const outDir=path.join(root,'.tmp-recovered-review',slug);
fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
let recovered=0;

for(const variant of variants){
  const text=variant.bytes.toString('latin1');
  const starts=[];
  for(let index=text.indexOf('H4sI');index!==-1;index=text.indexOf('H4sI',index+4))starts.push(index);
  console.log(`${variant.name}: ${variant.bytes.length} decoded bytes, ${starts.length} gzip markers`);
  for(const [candidateIndex,start] of starts.entries()){
    let end=start;
    while(end<text.length && /[A-Za-z0-9+/=]/.test(text[end]))end++;
    const b64=text.slice(start,end);
    if(b64.length<80)continue;
    try{
      const data=zlib.gunzipSync(Buffer.from(b64,'base64'));
      const prefix=text.slice(Math.max(0,start-240),start);
      const pathMatch=prefix.match(/write\('([^']+)'\s*,\s*gun\('\s*$/);
      let filename=pathMatch?.[1]||`${variant.name}-candidate-${String(candidateIndex).padStart(3,'0')}.bin`;
      filename=filename.replace(/^\/+/, '').replace(/\.\./g,'_');
      const target=path.join(outDir,filename);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,data);
      recovered++;
      console.log(`Recovered ${filename} (${data.length} bytes)`);
    }catch(error){
      console.log(`${variant.name} candidate ${candidateIndex} gunzip failed: ${error.message}`);
    }
  }
}
console.log(`Recovered ${recovered} payloads total.`);
if(!recovered)process.exit(2);
