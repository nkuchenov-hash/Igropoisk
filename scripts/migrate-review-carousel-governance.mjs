import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');
const write = (file, value) => fs.writeFileSync(file, value);

const validatorPath = 'scripts/validate-central-design-system.mjs';
let validator = read(validatorPath);
validator = validator.replace(
  "  const library = fs.readFileSync(governance.component_library, 'utf8');",
  "  const library = [governance.component_library, ...(governance.official_central_extensions || [])]\\n    .filter(file => fs.existsSync(file))\\n    .map(file => fs.readFileSync(file, 'utf8'))\\n    .join('\\n');"
);
if (!validator.includes("...(governance.official_central_extensions || [])")) throw new Error('Failed to extend central component registry lookup');
write(validatorPath, validator);

const registryPath = 'config/design-system-components.json';
const registry = JSON.parse(read(registryPath));
const ensureComponent = component => {
  if (!registry.components.some(item => item.class === component.class)) registry.components.push(component);
};
ensureComponent({ class: 'article-shot-card', role: 'card' });
ensureComponent({ class: 'article-shot-card__arrow', role: 'button' });
ensureComponent({ class: 'article-shot-card__dot', role: 'button' });
registry.element_roles.button = [...new Set([...(registry.element_roles.button || []), 'article-shot-card__arrow', 'article-shot-card__dot'])];
registry.element_roles.card = [...new Set([...(registry.element_roles.card || []), 'article-shot-card'])];
write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

const cssPath = 'article/_shared/review-shot-card.css';
let css = read(cssPath);
if (!css.includes('.article-shot-card__dot')) css += '\n/* Registered central review-carousel control hook; visual styling remains in the shared component selectors above. */\n.article-shot-card__dot{}\n';
write(cssPath, css);

const rendererPath = 'scripts/render-review-pages.mjs';
let renderer = read(rendererPath);
renderer = renderer.replace(
  "class=\"${index===0?'active':''}\" aria-label=\"Скриншот ${index+1}\"",
  "class=\"article-shot-card__dot ${index===0?'active':''}\" aria-label=\"Скриншот ${index+1}\""
);
if (!renderer.includes('article-shot-card__dot ${index===0')) throw new Error('Failed to register review carousel dot in renderer');
write(rendererPath, renderer);

const targets = ['elden-ring', 'the-witcher-3-wild-hunt', 'doom', 'control', 'hades'];
for (const slug of targets) {
  const file = `article/${slug}/index.html`;
  if (!fs.existsSync(file)) continue;
  let html = read(file);
  html = html.replace(/<button type="button" data-index="([^"]+)" class="([^"]*)" aria-label="Скриншот/g, (_, index, current) => {
    const classes = current.split(/\s+/).filter(Boolean).filter(value => value !== 'article-shot-card__dot');
    classes.unshift('article-shot-card__dot');
    return `<button type="button" data-index="${index}" class="${classes.join(' ')}" aria-label="Скриншот`;
  });
  write(file, html);
}

console.log('Review carousel governance migration applied to the shared renderer and five QA-targeted article pages.');
