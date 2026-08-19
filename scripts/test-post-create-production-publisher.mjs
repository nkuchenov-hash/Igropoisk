#!/usr/bin/env node
import fs from 'node:fs';
const source=fs.readFileSync('scripts/publish-post-create-production.mjs','utf8'),overlay=fs.readFileSync('scripts/publish-game-post-create-overlay.mjs','utf8'),pages=fs.readFileSync('.github/workflows/pages.yml','utf8');const fail=message=>{throw new Error(message)};
for(const marker of [
  'post-create-enrichment-(?:dna|bootstrap|commercial-review|full-review)-',
  '^data\\/drafts\\/[^/]+\\.json$',
  '^data\\/game-dna\\/[^/]+\\.json$',
  '^data\\/similarity\\/[^/]+\\.json$',
  '^data\\/reviews\\/[^/]+\\.json$',
  '^data\\/ratings\\/[^/]+\\.json$',
  '^data\\/articles\\/[^/]+\\.json$',
  '^data\\/article-media\\/[^/]+\\.json$',
  '^article\\/[^/]+\\/index\\.html$',
  "status:'ignored_non_post_create_merge'",
  "status:'no_production_content'",
  'Production parity failed',
  "event_type:'production-pages'",
  'production_sha:mainSha',
  "source:'post-create-production'",
  'trigger_sha:trigger',
  'process.env.POST_CREATE_TRIGGER_SHA||process.env.GITHUB_SHA',
  'POST_CREATE_PRODUCTION_PHASE'
])if(!source.includes(marker))fail(`Production publisher contract missing: ${marker}`);
for(const forbidden of ['data/research','data/review-article-corpus','data/review-discovery-audits','data/parser-runs','data/game-enrichment-requests','data/catalog-visible.json','data/review-bootstrap'])if(source.includes(`^${forbidden.replaceAll('/','\\/')}`))fail(`Production publisher must not promote scratch/legacy/global path: ${forbidden}`);
for(const marker of ["command('node',['scripts/publish-post-create-production.mjs']",'POST_CREATE_TRIGGER_SHA:triggerSha','POST_CREATE_PRODUCTION_PHASE:publishPhase',"status:'merged_and_published'",'const staging=refreshStaging();','const production=publishProduction(staging)',"git(['reset','--hard','HEAD'])","git(['clean','-fd'])","git(['reset','--hard',fresh])"])if(!overlay.includes(marker))fail(`Checkpoint publisher does not directly and safely publish production: ${marker}`);
for(const marker of ['repository_dispatch:','types: [production-pages]','github.event.client_payload.production_sha || github.sha'])if(!pages.includes(marker))fail(`Pages exact-SHA dispatch contract missing: ${marker}`);if(overlay.includes("gh',['workflow','run'"))fail('Post-create production must not depend on recursively triggered workflow events');console.log('Direct fail-closed exact-SHA post-create production publisher contract passed.');
