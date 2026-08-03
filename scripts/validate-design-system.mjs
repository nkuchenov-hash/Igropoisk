import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireFile = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Missing required file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
};
const expect = (condition, message) => {
  if (!condition) errors.push(message);
};
const declarations = (block = '') => Object.fromEntries(
  block
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      return separator === -1
        ? [entry, '']
        : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim().replace(/\s+/g, '')];
    }),
);
const cssBlock = (css, expression) => declarations(css.match(expression)?.[1] ?? '');

const designSystem = requireFile('assets/design-system.css');
const sharedCss = requireFile('game/_shared/game-page.css');
const sharedShell = requireFile('game/_shared/game-shell.js');
const sharedRenderer = requireFile('game/_shared/game-page.js');
const homepage = requireFile('index.html');

for (const token of [
  '--ig-bg', '--ig-surface', '--ig-surface-2', '--ig-text', '--ig-muted',
  '--ig-line', '--ig-rating', '--ig-accent', '--ig-radius-md', '--ig-container',
  '--ig-font', '--ig-display',
]) {
  expect(designSystem.includes(token), `Design system is missing token ${token}`);
}

expect(
  sharedCss.includes("@import url('../../assets/design-system.css')"),
  'game/_shared/game-page.css must import assets/design-system.css',
);
for (const contract of ['.score-grid', '.score-unit', '.favorite', '.media-item', '.tabs']) {
  expect(sharedCss.includes(contract), `Shared game CSS is missing component ${contract}`);
}
for (const contract of ['id="userScore"', 'id="favorite"', 'id="thumbs"', 'data-tab="reviews"', 'data-tab="guides"']) {
  expect(sharedShell.includes(contract), `Shared game shell is missing ${contract}`);
}
for (const contract of [
  "root.dataset.designSystem='igropoisk-v1'",
  'function ensureShell()',
  'function renderMedia(',
  'function setFavorite()',
  'function bindTabs()',
]) {
  expect(sharedRenderer.includes(contract), `Shared game renderer is missing contract ${contract}`);
}

// The current homepage still has compact local aliases. Verify that they are exact
// aliases of the canonical design-system values so visual drift fails CI.
if (!homepage.includes('assets/design-system.css')) {
  const designDark = cssBlock(designSystem, /:root\s*\{([^}]*)\}/);
  const designLight = cssBlock(designSystem, /html\[data-theme=["']?light["']?\]\s*\{([^}]*)\}/);
  const homeDark = cssBlock(homepage, /:root\s*\{([^}]*)\}/);
  const homeLight = cssBlock(homepage, /html\[data-theme=["']?light["']?\]\s*\{([^}]*)\}/);
  const darkMap = {
    '--bg': '--ig-bg',
    '--panel': '--ig-surface',
    '--panel2': '--ig-surface-2',
    '--text': '--ig-text',
    '--muted': '--ig-muted',
    '--line': '--ig-line',
    '--accent': '--ig-rating',
    '--purple': '--ig-accent',
    '--header': '--ig-header',
    '--shadow': '--ig-shadow',
  };
  const lightMap = {
    '--bg': '--ig-bg',
    '--panel': '--ig-surface',
    '--panel2': '--ig-surface-2',
    '--text': '--ig-text',
    '--muted': '--ig-muted',
    '--line': '--ig-line',
    '--header': '--ig-header',
    '--shadow': '--ig-shadow',
  };
  for (const [homeToken, systemToken] of Object.entries(darkMap)) {
    expect(
      homeDark[homeToken] === designDark[systemToken],
      `Homepage token ${homeToken} (${homeDark[homeToken] ?? 'missing'}) differs from ${systemToken} (${designDark[systemToken] ?? 'missing'})`,
    );
  }
  for (const [homeToken, systemToken] of Object.entries(lightMap)) {
    expect(
      homeLight[homeToken] === designLight[systemToken],
      `Homepage light token ${homeToken} (${homeLight[homeToken] ?? 'missing'}) differs from ${systemToken} (${designLight[systemToken] ?? 'missing'})`,
    );
  }
}

const gameRoot = path.join(root, 'game');
let checkedPages = 0;
if (!fs.existsSync(gameRoot)) {
  errors.push('Missing game directory');
} else {
  const directories = fs.readdirSync(gameRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of directories) {
    const relativePath = `game/${directory.name}/index.html`;
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      warnings.push(`${relativePath}: page is missing`);
      continue;
    }
    const html = read(relativePath);
    checkedPages += 1;
    expect(
      html.includes('../_shared/game-page.css'),
      `${relativePath}: must load ../_shared/game-page.css`,
    );
    expect(
      html.includes('../_shared/game-shell.js') || html.includes('../_shared/game-page.js'),
      `${relativePath}: must load the shared game shell or renderer`,
    );
    if (/<style(?:\s|>)/i.test(html)) {
      warnings.push(`${relativePath}: contains legacy inline CSS; shared renderer still normalizes its components`);
    }
  }
}

expect(checkedPages > 0, 'No game pages were found');

if (warnings.length) {
  console.warn(`Design-system warnings (${warnings.length}):`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}
if (errors.length) {
  console.error(`Design-system check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Design-system check passed for the homepage and ${checkedPages} game pages.`);
