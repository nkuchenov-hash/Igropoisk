#!/usr/bin/env node
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const fail=message=>{throw new Error(message)};

if(!workflow.includes('LOCAL_TEXT_MODEL: qwen3:1.7b'))fail('Required local text model is not configured');
if(!workflow.includes('LOCAL_EDITORIAL_MODEL: qwen3:1.7b'))fail('Quick-review editorial model is not pinned to the local text model');
if(!workflow.includes('LOCAL_VISION_MODEL: qwen3-vl:4b'))fail('Local vision model is not configured independently');

const textAt=workflow.indexOf('LOCAL_TEXT_MODEL: qwen3:1.7b');
const editorialAt=workflow.indexOf('LOCAL_EDITORIAL_MODEL: qwen3:1.7b');
const visionAt=workflow.indexOf('LOCAL_VISION_MODEL: qwen3-vl:4b');
if(textAt<0||editorialAt<textAt||visionAt<editorialAt)fail('Text/editorial/vision model routing order is invalid');

console.log('Quick-review model wiring passed: text synthesis uses qwen3:1.7b and vision remains isolated to qwen3-vl:4b.');
