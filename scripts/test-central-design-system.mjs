import assert from 'node:assert/strict';
import { parseAddedLines, validateFeatureCssText, validateMarkupText } from './validate-central-design-system.mjs';

const roles = {
  button: ['ig-button', 'ig-icon-button', 'ig-filter-chip', 'ig-action'],
  field: ['ig-input'],
  card: ['ig-card'],
  panel: ['ig-panel', 'ig-toolbar', 'ig-empty-state']
};

assert.deepEqual(validateFeatureCssText('feature.css', '.module{display:grid;gap:var(--ig-space-2)}'), []);
assert.deepEqual(validateFeatureCssText('feature.css', '.module{--ig-news-card-width:320px}', { allowedCustomPropertyPrefix: '--ig-news-' }), []);
assert.ok(validateFeatureCssText('feature.css', '.module{background:#fff}').length > 0);
assert.ok(validateFeatureCssText('feature.css', '.module:hover{display:block}').length > 0);

const open = name => `<${name}`;
assert.deepEqual(validateMarkupText('feature.js', `${open('button')} class="ig-button module__action">OK</button>`, roles), []);
assert.ok(validateMarkupText('feature.js', `${open('button')} class="module__button">OK</button>`, roles).length > 0);
assert.deepEqual(validateMarkupText('feature.js', `${open('input')} class="ig-input module__field">`, roles), []);
assert.ok(validateMarkupText('feature.js', `${open('div')} style="color:red">x</div>`, roles).length > 0);

const parsed = parseAddedLines('diff --git a/a.css b/a.css\n+++ b/a.css\n@@ -0,0 +1 @@\n+.x{color:red}\n');
assert.deepEqual(parsed.get('a.css'), ['.x{color:red}']);
console.log('Central design-system governance self-test passed.');
