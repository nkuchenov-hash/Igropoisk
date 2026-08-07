import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const normalize = file => file.split(path.sep).join('/');
const walk = directory => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    })
  : [];

const visualProperty = /^(?:color|background(?:-color|-image)?|border(?:-color|-radius|-style|-width)?|box-shadow|text-shadow|font(?:-family|-size|-weight|-style)?|line-height|letter-spacing|text-transform|text-decoration|outline(?:-color|-style|-width)?|opacity|filter|backdrop-filter|object-fit|aspect-ratio|transition|animation|fill|stroke)$/;
const literalColor = /(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|green|blue|orange|yellow|purple|pink|gray|grey|transparent)\b)/i;
const visualStateSelector = /:(?:hover|focus|focus-visible|active|visited|disabled|checked|selected)\b/i;
const localComponentHint = /(?:^|[-_])(card|button|input|select|textarea|chip|tag|toolbar|empty-state|page-title|modal|dialog|panel)(?:$|[-_])/i;
const permittedDiffExemptions = new Set(['scripts/test-central-design-system.mjs']);

export function validateFeatureCssText(file, css, { allowedCustomPropertyPrefix = null } = {}) {
  const errors = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@font-face\b/i.test(clean)) errors.push(`Local font definition is forbidden: ${file}`);
  for (const match of clean.matchAll(/(?:^|[;{])\s*(--ig-[a-z0-9-]+)\s*:/gim)) {
    if (!allowedCustomPropertyPrefix || !match[1].startsWith(allowedCustomPropertyPrefix)) {
      errors.push(`Central --ig-* tokens cannot be declared locally: ${file}`);
    }
  }
  for (const match of clean.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:\s*([^;}]*)/gm)) {
    if (visualProperty.test(match[1])) errors.push(`Component visual property ${match[1]} is forbidden in ${file}`);
    if (literalColor.test(match[2])) errors.push(`Literal color is forbidden outside the central design system: ${file}`);
  }
  for (const selector of clean.matchAll(/(?:^|})\s*([^@{}][^{}]*)\{/gm)) {
    if (visualStateSelector.test(selector[1])) errors.push(`Local visual state selector is forbidden in ${file}: ${selector[1].trim()}`);
  }
  return errors;
}

function classTokens(tag) {
  const match = tag.match(/\bclass\s*=\s*(["'])(.*?)\1/is);
  return match ? match[2].split(/\s+/).filter(Boolean) : [];
}

function matchesCentralClass(value, className) {
  return value === className
    || value.startsWith(`${className}--`)
    || value.startsWith(`${className}__`)
    || value.startsWith(`${className}\${`);
}

function usesCentralClass(classes, centralClasses) {
  return classes.some(value => centralClasses.some(className => matchesCentralClass(value, className)));
}

export function validateMarkupText(file, source, roles, registeredComponents = Object.values(roles).flat()) {
  const errors = [];
  if (/\bstyle\s*=\s*["']/i.test(source) || /\.style\s*(?:\.|=)/.test(source)) {
    errors.push(`Inline or scripted component styling is forbidden in ${file}`);
  }
  for (const match of source.matchAll(/<(button|input|select|textarea|a|article|section|div)\b[^>]*>/gis)) {
    const tagName = match[1].toLowerCase();
    const tag = match[0];
    const classes = classTokens(tag);
    if (tagName === 'button' && !usesCentralClass(classes, roles.button || [])) {
      errors.push(`Button must use a central component in ${file}: ${tag}`);
    }
    if (['input', 'select', 'textarea'].includes(tagName) && !usesCentralClass(classes, roles.field || [])) {
      errors.push(`Form field must use a central component in ${file}: ${tag}`);
    }
    if (classes.some(value => localComponentHint.test(value)) && !usesCentralClass(classes, registeredComponents)) {
      errors.push(`Local component-like class lacks a central component in ${file}: ${tag}`);
    }
  }
  return errors;
}

export function parseAddedLines(diff) {
  const files = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      if (!files.has(current)) files.set(current, []);
      continue;
    }
    if (!current || !line.startsWith('+') || line.startsWith('+++')) continue;
    files.get(current).push(line.slice(1));
  }
  return files;
}

function getAddedLines(base) {
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', `${base}...HEAD`, '--'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return parseAddedLines(diff);
}

function validateRegistry(errors, governance, featureRegistry) {
  const library = fs.readFileSync(governance.component_library, 'utf8');
  const seenClasses = new Set();
  for (const component of governance.components) {
    if (!component.class || !component.role) errors.push('Every central component registry entry requires class and role.');
    if (seenClasses.has(component.class)) errors.push(`Duplicate central component: ${component.class}`);
    seenClasses.add(component.class);
    if (!library.includes(`.${component.class}`)) errors.push(`Central design system is missing .${component.class}`);
  }
  for (const [role, classes] of Object.entries(governance.element_roles)) {
    for (const className of classes) {
      if (!seenClasses.has(className)) errors.push(`Role ${role} references an unregistered component: ${className}`);
    }
  }
  for (const file of governance.diff_exempt_files || []) {
    if (!permittedDiffExemptions.has(file)) errors.push(`Unapproved design-system diff exemption: ${file}`);
    if (!fs.existsSync(file)) errors.push(`Design-system diff exemption does not exist: ${file}`);
  }

  if (featureRegistry.default_enforcement !== 'strict') errors.push('New feature modules must default to strict enforcement.');

  const moduleDirs = fs.existsSync(featureRegistry.root)
    ? fs.readdirSync(featureRegistry.root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    : [];
  const registered = new Map(featureRegistry.modules.map(module => [module.id, module]));
  for (const directory of moduleDirs) {
    if (!registered.has(directory)) errors.push(`Feature module is not registered: ${featureRegistry.root}/${directory}`);
  }
  for (const module of featureRegistry.modules) {
    if (module.path !== `${featureRegistry.root}/${module.id}`) errors.push(`Feature path must match its id: ${module.id}`);
    if (!fs.existsSync(module.path)) errors.push(`Registered feature path does not exist: ${module.path}`);
    if (!['strict', 'metadata-only'].includes(module.enforcement)) errors.push(`Unknown enforcement mode for ${module.id}: ${module.enforcement}`);
    if (module.enforcement === 'metadata-only' && module.grandfathered !== true) errors.push(`Metadata-only mode is reserved for grandfathered rule/data modules: ${module.id}`);
  }
}

function validateStrictModule(errors, module, governance) {
  const manifestPath = path.join(module.path, 'module.json');
  const rulesPath = path.join(module.path, 'RULES.md');
  const registeredComponents = governance.components.map(component => component.class);
  if (!fs.existsSync(manifestPath)) errors.push(`Strict module requires module.json: ${module.path}`);
  if (!fs.existsSync(rulesPath)) errors.push(`Strict module requires RULES.md: ${module.path}`);
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== module.id) errors.push(`Module manifest id mismatch in ${manifestPath}`);
    if (manifest.enforcement !== 'strict') errors.push(`Strict module manifest must declare enforcement=strict: ${manifestPath}`);
    if (manifest.designSystem?.source !== governance.component_library) errors.push(`Module must consume ${governance.component_library}: ${manifestPath}`);
    if (manifest.designSystem?.policy !== 'central-components-only') errors.push(`Module must declare central-components-only: ${manifestPath}`);
    if (manifest.designSystem?.localStyles !== 'composition-only') errors.push(`Module must declare composition-only local styles: ${manifestPath}`);
    if (!Array.isArray(manifest.centralComponents) || manifest.centralComponents.length === 0) {
      errors.push(`Strict module must declare consumed centralComponents: ${manifestPath}`);
    } else {
      const registeredSet = new Set(registeredComponents);
      for (const className of manifest.centralComponents) {
        if (!registeredSet.has(className)) errors.push(`Module consumes an unregistered central component ${className}: ${manifestPath}`);
      }
    }
  }
  for (const file of walk(module.path)) {
    const relative = normalize(file);
    if (file.endsWith('.css')) errors.push(...validateFeatureCssText(relative, fs.readFileSync(file, 'utf8'), { allowedCustomPropertyPrefix: `--ig-${module.id}-` }));
    if (/\.(?:js|mjs|html)$/.test(file)) {
      errors.push(...validateMarkupText(relative, fs.readFileSync(file, 'utf8'), governance.element_roles, registeredComponents));
    }
  }
}

function validateMetadataOnlyModule(errors, module) {
  const forbidden = walk(module.path).filter(file => /\.(?:css|js|mjs|html|htm|ts|tsx|jsx)$/.test(file));
  for (const file of forbidden) errors.push(`Metadata-only module cannot contain runtime or styles: ${normalize(file)}`);
}

function validateDiff(errors, base, governance, featureRegistry) {
  const centralFiles = new Set([
    governance.component_library,
    ...governance.official_central_extensions,
    ...governance.layout_contract_files
  ]);
  const exemptFiles = new Set(governance.diff_exempt_files || []);
  const registeredComponents = governance.components.map(component => component.class);
  for (const [file, lines] of getAddedLines(base)) {
    if (exemptFiles.has(file)) continue;
    const source = lines.join('\n');
    if (file.endsWith('.css') && !centralFiles.has(file)) {
      const module = featureRegistry.modules.find(candidate => file === candidate.path || file.startsWith(`${candidate.path}/`));
      const allowedCustomPropertyPrefix = module?.enforcement === 'strict' ? `--ig-${module.id}-` : null;
      errors.push(...validateFeatureCssText(file, source, { allowedCustomPropertyPrefix }));
    }
    if (/\.(?:html|htm|js|mjs)$/.test(file)) {
      errors.push(...validateMarkupText(file, source, governance.element_roles, registeredComponents));
    }
  }
}

export function runValidation({ base = null } = {}) {
  const errors = [];
  const governance = readJson('config/design-system-components.json');
  const featureRegistry = readJson('config/feature-modules.json');
  validateRegistry(errors, governance, featureRegistry);
  for (const module of featureRegistry.modules) {
    if (module.enforcement === 'strict') validateStrictModule(errors, module, governance);
    else validateMetadataOnlyModule(errors, module);
  }
  if (base) validateDiff(errors, base, governance, featureRegistry);
  return errors;
}

function main() {
  const baseIndex = process.argv.indexOf('--base');
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : null;
  const errors = runValidation({ base });
  if (errors.length) throw new Error(`Central design-system governance failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  console.log(base
    ? `Central design-system governance verified against ${base}.`
    : 'Central design-system registry and strict modules verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
