import { spawn } from 'node:child_process';
import { pgEnvironment } from './backup-contract.mjs';

export async function runPostgresTool(command, args, { databaseUrl, env = process.env, maximumStderrBytes = 256_000 } = {}) {
  if (!databaseUrl) throw new Error(`${command} requires a database URL.`);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: pgEnvironment(databaseUrl, env),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    const chunks = [];
    let bytes = 0;
    child.stderr.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= maximumStderrBytes) chunks.push(Buffer.from(chunk));
    });
    child.once('error', error => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once('close', code => {
      const stderr = Buffer.concat(chunks).toString('utf8').trim();
      if (code !== 0) return reject(new Error(`${command} failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`));
      resolve({ code, stderr });
    });
  });
}
