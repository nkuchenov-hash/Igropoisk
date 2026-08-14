#!/usr/bin/env node
import {ensureLocalEditorialRuntime} from './ensure-local-editorial-runtime.mjs';
await ensureLocalEditorialRuntime();
await import('./run-content-pipeline-core.mjs');
