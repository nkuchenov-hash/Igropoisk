import fs from 'node:fs';
import path from 'node:path';

const root = process.env.WOLF3D_PUBLIC_OUT || '/tmp/wolf3d-final/benchmark/wolfenstein-3d-models';
if (!fs.existsSync(root)) throw new Error(`Benchmark output not found: ${root}`);

const compositionCss = `.wrap{max-width:1280px;margin:0 auto;padding:42px 24px 88px}
.topbar{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:28px}
.hero{padding:28px 0 34px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:14px;margin:30px 0}
.bench-card{padding:20px;display:flex;flex-direction:column;min-height:270px}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:15px 0}
.metric{padding:9px}
.excerpt{flex:1}
.section{padding:35px 0}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.compare-pane{padding:18px}
.compare select{width:100%;margin-bottom:14px}
.frame{width:100%;height:760px}
.bench-article-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:36px;margin-top:32px}
.article{max-width:830px}
.sidebar{position:sticky;top:18px;height:max-content}
.sidebar .row{display:flex;justify-content:space-between;gap:12px;padding:8px 0}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}
.notice{margin:20px 0}
.source-list{display:grid;gap:8px}
@media(max-width:900px){.compare,.bench-article-layout{grid-template-columns:1fr}.sidebar{position:static}.frame{height:600px}}
`;
fs.writeFileSync(path.join(root, 'styles.css'), compositionCss, 'utf8');

const HEADER_STYLE = '<link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style">';
const LAYOUT_STYLE = '<link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style">';
const HEADER_SCRIPT = '<script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script>';
const LAYOUT_SCRIPT = '<script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script>';

const htmlFiles = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith('.html')) htmlFiles.push(p);
  }
}
walk(root);

function addCentralAssets(html, file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const inModels = rel.startsWith('models/');
  const central = inModels ? '../../../assets/design-system.css' : '../../assets/design-system.css';
  const local = inModels ? '../styles.css' : 'styles.css';
  html = html.replace(/<link rel="stylesheet" href="(?:\.\.\/)?styles\.css">/g, '');
  const links = `<link rel="stylesheet" href="${central}"><link rel="stylesheet" href="${local}">`;
  return html.replace('</head>', `${links}</head>`);
}

function addLayoutContract(html) {
  html = html
    .replace(/\s*<link\b[^>]*data-ig-shared-header="style"[^>]*>\s*/gi, '')
    .replace(/\s*<link\b[^>]*data-ig-layout-contract="style"[^>]*>\s*/gi, '')
    .replace(/\s*<script\b[^>]*data-ig-shared-header="script"[^>]*>\s*<\/script>\s*/gi, '')
    .replace(/\s*<script\b[^>]*data-ig-layout-contract="script"[^>]*>\s*<\/script>\s*/gi, '');
  html = html.replace('</head>', `${HEADER_STYLE}${LAYOUT_STYLE}</head>`);
  html = html.replace('</body>', `${HEADER_SCRIPT}${LAYOUT_SCRIPT}</body>`);
  return html;
}

function patchMarkup(html) {
  html = html
    .replace(/class="brand"/g, 'class="ig-logo brand"')
    .replace(/class="eyebrow"/g, 'class="ig-kicker"')
    .replace(/class="btn secondary"/g, 'class="ig-button"')
    .replace(/class="btn"/g, 'class="ig-button"')
    .replace(/class="chip ok"/g, 'class="ig-chip ig-rating"')
    .replace(/class="chip bad"/g, 'class="ig-chip ig-muted"')
    .replace(/class="chip warn"/g, 'class="ig-chip ig-muted"')
    .replace(/class="chip"/g, 'class="ig-chip"')
    .replace(/class="card"/g, 'class="ig-card bench-card"')
    .replace(/class="metric"/g, 'class="ig-panel metric"')
    .replace(/class="compare-pane"/g, 'class="ig-panel compare-pane"')
    .replace(/class="article-shell"/g, 'class="bench-article-layout"')
    .replace(/class="sidebar"/g, 'class="ig-panel sidebar"')
    .replace(/class="notice"/g, 'class="ig-panel notice"')
    .replace(/class="errorbox"/g, 'class="ig-panel errorbox"')
    .replace(/class="meta"/g, 'class="ig-muted meta"')
    .replace(/class="excerpt"/g, 'class="ig-muted excerpt"')
    .replace(/class="small"/g, 'class="ig-muted small"')
    .replace(/class="ok"/g, 'class="ig-rating"')
    .replace(/class="bad"/g, 'class="ig-muted"')
    .replace(/class="warn"/g, 'class="ig-muted"')
    .replace(/<h1>/g, '<h1 class="ig-page-title ig-display">')
    .replace(/<select(?![^>]*class=)/g, '<select class="ig-input"');

  html = html.replace(/<nav class="nav">([\s\S]*?)<\/nav>/g, (_whole, inner) => {
    const patched = inner.replace(/<a(?![^>]*class=)/g, '<a class="ig-button"');
    return `<nav class="nav">${patched}</nav>`;
  });
  return html;
}

for (const file of htmlFiles) {
  let html = fs.readFileSync(file, 'utf8');
  html = addCentralAssets(html, file);
  html = patchMarkup(html);
  html = addLayoutContract(html);
  fs.writeFileSync(file, html, 'utf8');
}

console.log(`Patched ${htmlFiles.length} benchmark HTML files for central design + shared layout contracts.`);
