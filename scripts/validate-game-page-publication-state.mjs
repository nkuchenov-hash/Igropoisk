#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

export function isDeployableBaseShell(draft = {}) {
  return Boolean(
    draft?.publication?.status === 'published'
    && draft?.publication?.public_ready === true
    && draft?.publication?.page_available === true
    && draft?.publication?.gate_passed === true
    && draft?.publication?.gate?.passed === true
    && draft?.modules?.page === 'ready'
  );
}

export function publicationProblems({
  slug,
  draft,
  editorial,
  pageQc,
  contentQc,
  mediaQc,
  corpus,
  shellExists,
  allowBaseShell = false
} = {}) {
  const bad = [];
  if (!draft?.publication?.public_ready || draft?.publication?.status !== 'published') {
    bad.push('draft publication is not finalized');
  }

  const baseShell = allowBaseShell && isDeployableBaseShell(draft);
  if (!baseShell) {
    if (editorial?.game_slug !== slug || editorial?.quality_status !== 'green') bad.push('canonical page editorial is missing/not green');
    if (pageQc?.status !== 'green' || pageQc?.green !== true) bad.push('page QC is not green');
    if (contentQc?.status !== 'green') bad.push('content QC is not green');
    if (mediaQc?.status !== 'green') bad.push('media QC is not green');
    if (!corpus?.discovery?.complete) bad.push('source discovery is incomplete');
  }

  if (!shellExists) bad.push('public game shell is missing');
  return bad;
}

function runCli() {
  const args = process.argv.slice(2);
  const allowBaseShell = args.includes('--allow-base-shell');
  const slugs = [...new Set(args.filter(arg => arg !== '--allow-base-shell').map(String).map(x => x.trim()).filter(Boolean))];
  if (!slugs.length) {
    console.log('No changed game pages to validate.');
    return 0;
  }

  const read = (p, fallback = null) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }
    catch { return fallback; }
  };
  const exists = p => fs.existsSync(path.join(root, p));
  const catalog = read('data/catalog-visible.json', []);
  const errors = [];
  let baseShells = 0;
  let fullEditorialPages = 0;

  for (const slug of slugs) {
    const publiclyReferenced = catalog.some(item => item.slug === slug) || exists(`game/${slug}/index.html`);
    if (!publiclyReferenced) continue;

    const draft = read(`data/drafts/${slug}.json`);
    const editorial = read(`data/page-editorial/${slug}.json`);
    const pageQc = read(`data/quality-control/page-${slug}-control.json`);
    const contentQc = read(`data/quality-control/game-page-content-${slug}.json`);
    const mediaQc = read(`data/quality-control/game-page-${slug}.json`);
    const corpus = read(`data/game-sources/${slug}.json`);
    const shellExists = exists(`game/${slug}/index.html`);
    const baseShell = allowBaseShell && isDeployableBaseShell(draft);
    if (baseShell) baseShells += 1;
    else fullEditorialPages += 1;

    const bad = publicationProblems({
      slug,
      draft,
      editorial,
      pageQc,
      contentQc,
      mediaQc,
      corpus,
      shellExists,
      allowBaseShell
    });
    if (bad.length) errors.push(`${slug}: ${bad.join('; ')}`);
  }

  if (errors.length) {
    console.error('Game page publication gate failed:\n' + errors.map(x => `- ${x}`).join('\n'));
    return 2;
  }
  console.log(`Game page publication state passed for ${slugs.length} changed slug(s): ${baseShells} deployable base shell(s), ${fullEditorialPages} fully enriched page(s).`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(runCli());
