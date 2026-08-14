import fs from 'node:fs';
const file='scripts/discover-review-sources-web-v8.mjs';
let source=fs.readFileSync(file,'utf8');
const gate="if(!game.identity)throw new Error('Missing game draft');";
if(!source.includes('const catalogItem='))source=source.replace(gate,"const catalog=read('data/catalog-visible.json',[]),catalogItem=Array.isArray(catalog)?catalog.find(item=>item?.slug===slug):null;\n"+gate);
const old='title=game.identity.title||slug,year=Number(String(game.release?.date||game.release?.date_text||\'\').match(/(?:19|20)\\d{2}/)?.[0]||0)';
const next='title=catalogItem?.title||game.identity.title||slug,year=Number(catalogItem?.year||String(game.release?.date||game.release?.date_text||\'\').match(/(?:19|20)\\d{2}/)?.[0]||0)';
if(!source.includes(next)){
  if(!source.includes(old))throw new Error('Unable to locate title/year declaration');
  source=source.replace(old,next);
}
fs.writeFileSync(file,source);
// one-shot patch trigger; remove this helper after the production file is committed.
