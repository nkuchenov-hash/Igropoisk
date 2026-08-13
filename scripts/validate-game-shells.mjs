#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog-visible.json'),'utf8'));
const errors=[];let checked=0;
for(const game of catalog){
  const slug=String(game?.slug||'').trim();if(!slug)continue;
  const relative=`game/${slug}/index.html`;const target=path.join(root,relative);
  if(!fs.existsSync(target)){errors.push(`${slug}: public game page missing`);continue}
  checked++;
  const html=fs.readFileSync(target,'utf8');
  const body=(html.match(/<body\b([^>]*)>/i)||[])[1]||'';
  const attr=name=>(body.match(new RegExp(`\\b${name}=["']([^"']*)["']`,'i'))||[])[1]||'';
  if(!/\.\.\/_shared\/game-shell\.js(?:\?[^"']*)?/i.test(html))errors.push(`${slug}: canonical game-shell.js loader missing`);
  if(/<section\s+class=["']hero["']/i.test(html)||/<main\s+class=["']wrap["']/i.test(html)||/id=["']gallery["']/i.test(html))errors.push(`${slug}: legacy Game Page shell remains in public HTML`);
  if(attr('data-slug')!==slug)errors.push(`${slug}: data-slug is ${attr('data-slug')||'missing'}`);
  if(attr('data-draft')!==slug)errors.push(`${slug}: data-draft is ${attr('data-draft')||'missing'}`);
  if(game?.game_id&&attr('data-game-id')!==String(game.game_id))errors.push(`${slug}: data-game-id mismatch`);
}
const report={catalog_games:catalog.length,checked_pages:checked,errors};
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exit(2);
