import fs from 'node:fs';
import path from 'node:path';

const errors = [];
const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
}) : [];

const designSystem = fs.readFileSync('assets/design-system.css', 'utf8');
[
  '.ig-card--interactive', '.ig-card__media', '.ig-card__body', '.ig-card__meta', '.ig-card__title', '.ig-card__summary',
  '.ig-icon-button', '.ig-input', '.ig-filter-chip', '.ig-chip-list', '.ig-toolbar', '.ig-empty-state', '.ig-page-title'
].forEach(token => { if (!designSystem.includes(token)) errors.push(`Central design system is missing ${token}`); });

const forbiddenProperties = /^(?:color|background(?:-color|-image)?|border(?:-color|-radius|-style|-width)?|box-shadow|text-shadow|font(?:-family|-size|-weight|-style)?|line-height|letter-spacing|text-transform|text-decoration|outline(?:-color|-style|-width)?|opacity|filter|backdrop-filter|object-fit|aspect-ratio|transition|animation)$/;
for (const file of walk('features').filter(file => file.endsWith('.css'))) {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(css)) errors.push(`Literal color is forbidden in feature CSS: ${file}`);
  for (const match of css.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/gm)) {
    if (forbiddenProperties.test(match[1])) errors.push(`Component visual property ${match[1]} is forbidden in ${file}`);
  }
}

for (const file of walk('features').filter(file => file.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const tag of source.matchAll(/<button\b[^>]*>/g)) {
    if (!/class=\"[^\"]*\b(?:ig-button|ig-icon-button|ig-filter-chip)\b/.test(tag[0])) errors.push(`Feature button does not use a central component in ${file}: ${tag[0]}`);
  }
  for (const tag of source.matchAll(/<input\b[^>]*>/g)) {
    if (!/class=\"[^\"]*\big-input\b/.test(tag[0])) errors.push(`Feature input does not use ig-input in ${file}: ${tag[0]}`);
  }
  for (const tag of source.matchAll(/<a\b[^>]*class=\"[^\"]*ig-news-card[^\"]*\"[^>]*>/g)) {
    if (!/\big-card\b/.test(tag[0])) errors.push(`Feature card does not use ig-card in ${file}: ${tag[0]}`);
  }
}

if (errors.length) throw new Error(`Central design-system validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
console.log('Central design-system component policy verified.');
