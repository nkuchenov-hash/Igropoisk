#!/usr/bin/env node
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const fail=message=>{throw new Error(message)};

if(!workflow.includes('LOCAL_TEXT_MODEL: qwen3:4b'))fail('Required commercial local text model is not configured');
if(!workflow.includes('LOCAL_EDITORIAL_MODEL: qwen3:4b'))fail('Quick-review editorial model is not pinned to the commercial local text model');
if(!workflow.includes('LOCAL_VISION_MODEL: qwen3-vl:4b'))fail('Local vision model is not configured independently');
if(!workflow.includes('ollama-post-create-v2-qwen3-4b'))fail('Commercial local text model does not have its own cache generation');
if(!workflow.includes('scripts/build-review-bootstrap-commercial.mjs')||!workflow.includes('scripts/audit-review-bootstrap-local.mjs'))fail('Grounded commercial quick-review path is not wired');

const textAt=workflow.indexOf('LOCAL_TEXT_MODEL: qwen3:4b');
const editorialAt=workflow.indexOf('LOCAL_EDITORIAL_MODEL: qwen3:4b');
const visionAt=workflow.indexOf('LOCAL_VISION_MODEL: qwen3-vl:4b');
if(textAt<0||editorialAt<textAt||visionAt<editorialAt)fail('Text/editorial/vision model routing order is invalid');

console.log('Quick-review model wiring passed: grounded text synthesis/audit uses qwen3:4b and vision remains isolated to qwen3-vl:4b.');
