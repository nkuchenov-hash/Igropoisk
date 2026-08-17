import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAddedLines, validateFeatureCssText, validateMarkupText, validateSectionHeadingActions } from './validate-central-design-system.mjs';

const roles = {
  button: ['ig-button', 'ig-icon-button', 'ig-filter-chip', 'ig-action'],
  field: ['ig-input'],
  card: ['ig-card'],
  panel: ['ig-panel', 'ig-toolbar'],
  tag: ['ig-chip', 'ig-hashtag', 'ig-pill'],
  tag_list: ['ig-chip-list'],
  state: ['ig-empty-state'],
  title: ['ig-page-title'],
  tabs: ['ig-tabs']
};
const registeredComponents = Object.values(roles).flat();

assert.deepEqual(validateFeatureCssText('feature.css', '.module{display:grid;gap:var(--ig-space-2)}'), []);
assert.deepEqual(validateFeatureCssText('feature.css', '.module{--ig-news-card-width:320px}', { allowedCustomPropertyPrefix: '--ig-news-' }), []);
assert.ok(validateFeatureCssText('feature.css', '.module{background:#fff}').length > 0);
assert.ok(validateFeatureCssText('feature.css', '.module:hover{display:block}').length > 0);

const open = name => `<${name}`;
assert.deepEqual(validateMarkupText('feature.js', `${open('button')} class="ig-button module__action">OK</button>`, roles, registeredComponents), []);
assert.ok(validateMarkupText('feature.js', `${open('button')} class="module__button">OK</button>`, roles, registeredComponents).length > 0);
assert.deepEqual(validateMarkupText('feature.js', `${open('input')} class="ig-input module__field">`, roles, registeredComponents), []);
assert.deepEqual(validateMarkupText('feature.js', `${open('div')} class="ig-chip-list">`, roles, registeredComponents), []);
assert.deepEqual(validateMarkupText('feature.js', `${open('span')} class="ig-hashtag">#Doom</span>`, roles, registeredComponents), []);
assert.deepEqual(validateMarkupText('feature.js', `${open('div')} class="ig-empty-state\${kind}">`, roles, registeredComponents), []);
assert.ok(validateMarkupText('feature.js', `${open('div')} style="color:red">x</div>`, roles, registeredComponents).length > 0);

const boxedSectionCta = '<div class="section-head"><h2>Релизы</h2><a class="ig-button" href="calendar/">Календарь</a></div>';
const lightweightSectionCta = '<div class="section-head"><h2>Релизы</h2><a class="ig-button ig-text-link" href="calendar/">Календарь →</a></div>';
const nestedHeadingControls = '<div class="section-head"><h2>Новости</h2><div class="controls"><button class="ig-icon-button">→</button></div></div>';
assert.ok(validateSectionHeadingActions('index.html', boxedSectionCta).length > 0, 'Boxed CTA must be rejected inside a section heading.');
assert.deepEqual(validateSectionHeadingActions('index.html', lightweightSectionCta), [], 'Lightweight section navigation must remain allowed.');
assert.deepEqual(validateSectionHeadingActions('index.html', nestedHeadingControls), [], 'Icon controls may remain in a section heading.');

const designSystem = fs.readFileSync('assets/design-system.css', 'utf8');
const hashtagRule = designSystem.match(/\.ig-hashtag\{([^}]*)\}/)?.[1] || '';
assert.match(hashtagRule, /color:var\(--ig-accent\)/, 'The central game hashtag must remain purple through --ig-accent.');
assert.match(hashtagRule, /background:transparent/, 'The central game hashtag must remain a lightweight text element.');
assert.match(hashtagRule, /border:0/, 'The central game hashtag must not regress into a chip or pill.');

const parsed = parseAddedLines('diff --git a/a.css b/a.css\n+++ b/a.css\n@@ -0,0 +1 @@\n+.x{color:red}\n');
assert.deepEqual(parsed.get('a.css'), ['.x{color:red}']);
console.log('Central design-system governance self-test passed.');
