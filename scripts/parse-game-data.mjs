#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {GameRegistryApi} from './lib/game-registry.mjs';

const root=process.cwd(),slug=process.argv[2];
await import('./parse-game-data-core.mjs');

const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}};
const yearOf=value=>Number(String(value||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const precision=value=>/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(String(value||''))?2:yearOf(value)?1:0;

if(slug&&!process.exitCode){
  const outputPath=path.join(root,'data/parser-output',`${slug}.json`),registryPath=path.join(root,'data/game-registry/registry.transition.json'),parsed=read(outputPath),registry=read(registryPath);
  if(parsed&&registry){
    const api=new GameRegistryApi(registry),entity=api.findBySlug(slug);
    const released=(entity?.releases||[]).filter(release=>{
      const status=String(release?.status?.value??release?.status??'').toLowerCase();
      return !/upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида/i.test(status);
    }).map(release=>String(release?.date?.value??release?.date??'')).filter(yearOf);
    released.sort((a,b)=>yearOf(a)-yearOf(b)||precision(b)-precision(a));
    const canonical=released[0]||'',storeText=String(parsed.release?.date_text||''),canonicalYear=yearOf(canonical),storeYear=yearOf(storeText);
    if(canonicalYear&&(!storeYear||canonicalYear<storeYear||(canonicalYear===storeYear&&precision(canonical)>precision(storeText)))){
      parsed.release=parsed.release||{};
      parsed.release.store_date_text=storeText||null;
      parsed.release.canonical_date_text=canonical;
      parsed.release.date_text=canonical;
      parsed.release.release_date_basis='canonical_game_registry_original_release';
      fs.writeFileSync(outputPath,`${JSON.stringify(parsed,null,2)}\n`);
    }
  }
}
