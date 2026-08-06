import { getPool, closePool } from './database.mjs';
import { currentPublication, ledgerHealth } from './queries.mjs';

try {
  const pool = getPool();
  const health = await ledgerHealth(pool);
  const publication = await currentPublication(pool, 'news');
  if (health.publishedCount < 1) throw new Error('News ledger has no published content.');
  if (!publication || publication.itemCount < 1) throw new Error('News ledger has no current publication.');
  console.log(JSON.stringify({ health, publication }, null, 2));
} finally {
  await closePool();
}
