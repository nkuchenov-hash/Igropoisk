#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {applyCanonicalGameIdentity,loadEditorialRegistry,resolveEditorialGame} from './lib/editorial-game-registry-adapter.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim();if(!slug){console.error('Usage: node scripts/canonicalize-editorial-game-id.mjs <game-slug>');process.exit(1)}
const loaded=loadEditorialRegistry(root),identity=resolveEditorialGame({slug},{root,loaded});
const draftPath=path.join(root,`data/drafts/${slug}.json`);let publishedDraft=false;if(fs.existsSync(draftPath)){const draft=JSON.parse(fs.readFileSync(draftPath,'utf8'));publishedDraft=draft?.publication?.status==='published'&&draft?.publication?.public_ready===true}
const targets=[
  ...(publishedDraft?[]:[`data/drafts/${slug}.json`]),
  `data/research/${slug}-source-matrix.json`,`data/reviews/${slug}.json`,`data/ratings/${slug}.json`,`data/articles/${slug}.json`,`data/articles/review-${slug}.json`,`data/article-drafts/${slug}.json`,`data/article-media/${slug}.json`,`data/franchises/${slug}.json`,`data/similarity/${slug}.json`,`data/parser-runs/review-research-${slug}.json`,`data/parser-runs/review-output-${slug}.json`
];
let changed=0,found=0;
for(const relative of targets){const file=path.join(root,relative);if(!fs.existsSync(file))continue;found++;const current=JSON.parse(fs.readFileSync(file,'utf8')),next=applyCanonicalGameIdentity(current,identity);if(JSON.stringify(current)!==JSON.stringify(next)){fs.writeFileSync(file,`${JSON.stringify(next,null,2)}\n`);changed++}}
// Public catalog, shell and finalized draft are immutable here. Page identity changes must be
// applied to a needs_revision draft before scripts/finalize-game-page-publication.mjs runs.
console.log(JSON.stringify({slug:identity.slug,game_id:identity.game_id,matched_by:identity.matched_by,artifacts_found:found,artifacts_changed:changed,published_page_package_preserved:publishedDraft,public_state_mutations:0},null,2));
