import { closePool, getPool } from './database.mjs';
import { runMigrations } from './migrate.mjs';
import { readRuntimeConfig } from './runtime-config.mjs';
import { recordRuntimeState } from './runtime-state.mjs';
import { createNewsServer } from './server.mjs';

const config = readRuntimeConfig();
const pool = getPool();
await runMigrations(pool);
const latestSync = await recordRuntimeState(pool, config);

const server = createNewsServer({
  pool,
  allowedOrigins: config.allowedOrigins,
  runtime: {
    mode: config.runtimeMode,
    readSource: config.readSource,
    version: config.serviceVersion
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, config.host, resolve);
});
console.log(JSON.stringify({
  event: 'content_api_started',
  host: config.host,
  port: config.port,
  runtimeMode: config.runtimeMode,
  readSource: config.readSource,
  serviceVersion: config.serviceVersion,
  latestSyncId: latestSync?.id || null
}));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'content_api_shutdown', signal }));
  const forceTimer = setTimeout(() => process.exit(1), config.shutdownGraceMs);
  forceTimer.unref();
  server.closeIdleConnections?.();
  await new Promise(resolve => server.close(resolve));
  await closePool();
  clearTimeout(forceTimer);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdown(signal).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
