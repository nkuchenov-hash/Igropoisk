#!/usr/bin/env node
import fs from 'node:fs';

const source=fs.readFileSync('scripts/publish-post-create-production.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/post-create-production-publisher.yml','utf8');
const fail=message=>{throw new Error(message)};
for(const marker of [
  'post-create-enrichment-(?:dna|bootstrap|quick-review|full-review)-',
  '^data\\/drafts\\/[^/]+\\.json$',
  '^data\\/game-dna\\/[^/]+\\.json$',
  '^data\\/similarity\\/[^/]+\\.json$',
  '^data\\/reviews\\/[^/]+\\.json$',
  '^data\\/ratings\\/[^/]+\\.json$',
  '^data\\/review-bootstrap\\/[^/]+\\.json$',
  '^article\\/[^/]+\\/index\\.html$',
  "status:'ignored_non_post_create_merge'",
  "status:'no_production_content'",
  'Production parity failed',
  "event_type:'production-pages'",
  "source:'post-create-production'",
  'trigger_sha:trigger'
])if(!source.includes(marker))fail(`Production publisher contract missing: ${marker}`);
for(const forbidden of ['data/research','data/parser-runs','data/game-enrichment-requests','data/catalog-visible.json'])if(source.includes(`^${forbidden.replaceAll('/','\\/')}`))fail(`Production publisher must not promote scratch/global path: ${forbidden}`);
for(const marker of ['ref: ${{ github.sha }}','cancel-in-progress: false','scripts/test-post-create-production-publisher.mjs','Publish only verified post-create game artifacts'])if(!workflow.includes(marker))fail(`Production workflow contract missing: ${marker}`);
console.log('Fail-closed post-create production publisher contract passed.');
