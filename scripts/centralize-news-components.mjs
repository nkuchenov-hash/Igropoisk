import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, content) => fs.writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
const replace = (path, from, to) => {
  const source = read(path);
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Expected fragment not found in ${path}: ${from.slice(0, 100)}`);
  write(path, source.replace(from, to));
};

const componentMarker = '/* Central component library: modules may consume, never redefine. */';
let designCss = read('assets/design-system.css');
if (!designCss.includes(componentMarker)) {
  designCss += `\n\n${componentMarker}\n:root{\n  --ig-space-1:4px;\n  --ig-space-2:8px;\n  --ig-space-3:12px;\n  --ig-space-4:16px;\n  --ig-space-5:24px;\n  --ig-space-6:32px;\n  --ig-control-height:46px;\n  --ig-control-size-sm:38px;\n  --ig-radius-pill:999px;\n}\n.ig-card--interactive{cursor:pointer;transition:transform var(--ig-transition),border-color var(--ig-transition),background var(--ig-transition)}\n.ig-card--interactive:hover{transform:translateY(-3px);border-color:var(--ig-line-strong)}\n.ig-card--interactive:active{transform:translateY(-1px)}\n.ig-card__media{display:block;width:100%;background:var(--ig-surface-2)}\n.ig-card__media--landscape{aspect-ratio:16/9;object-fit:cover}\n.ig-card__body{display:flex;flex:1;flex-direction:column;padding:var(--ig-space-4)}\n.ig-card__meta{margin:0 0 var(--ig-space-2);color:var(--ig-muted);font-size:var(--ig-font-min);line-height:1.5}\n.ig-card__title{margin:0;font-size:20px;line-height:1.35}\n.ig-card__summary{margin:var(--ig-space-3) 0 0;color:var(--ig-muted);font-size:var(--ig-font-min);line-height:1.5}\n.ig-chip-list{display:flex;flex-wrap:wrap;gap:var(--ig-space-1);margin:0 0 var(--ig-space-3)}\n.ig-control-group{display:flex;align-items:center;gap:var(--ig-space-2)}\n.ig-icon-button{width:var(--ig-control-size-sm);height:var(--ig-control-size-sm);display:grid;place-items:center;padding:0;border:1px solid var(--ig-line);border-radius:var(--ig-radius-pill);background:var(--ig-surface);color:var(--ig-text);font:700 18px/1 var(--ig-font);transition:border-color var(--ig-transition),background var(--ig-transition),transform var(--ig-transition)}\n.ig-icon-button:hover{border-color:var(--ig-line-strong);background:var(--ig-surface-2)}\n.ig-icon-button:active{transform:translateY(1px)}\n.ig-input{width:100%;height:var(--ig-control-height);padding:0 var(--ig-space-4);border:1px solid var(--ig-line);border-radius:var(--ig-radius-lg);background:var(--ig-surface);color:var(--ig-text);font:inherit}\n.ig-input--search{width:min(100%,520px)}\n.ig-toolbar{display:grid;gap:var(--ig-space-4);margin:0 0 var(--ig-space-5)}\n.ig-filter-list{display:flex;flex-wrap:wrap;gap:var(--ig-space-2)}\n.ig-filter-chip{border:1px solid var(--ig-line);border-radius:var(--ig-radius-pill);background:transparent;color:var(--ig-muted);padding:var(--ig-space-2) var(--ig-space-3);font:700 12px/1 var(--ig-font);transition:background var(--ig-transition),color var(--ig-transition),border-color var(--ig-transition)}\n.ig-filter-chip:hover{color:var(--ig-text);border-color:var(--ig-line-strong)}\n.ig-filter-chip.is-active{background:var(--ig-text);border-color:var(--ig-text);color:var(--ig-bg)}\n.ig-empty-state{width:100%;padding:var(--ig-space-5);color:var(--ig-muted);border:1px dashed var(--ig-line-strong);border-radius:var(--ig-radius-md)}\n.ig-empty-state--error{color:var(--ig-danger)}\n.ig-page-title{margin:0 0 var(--ig-space-5);font:800 clamp(25px,1.65vw,34px)/1 var(--ig-game-display);letter-spacing:-.04em}\n`;
  write('assets/design-system.css', designCss);
}

write('features/news/styles/index.css', `
.ig-news{--ig-news-home-card:360px;min-width:0}
.ig-news--home .ig-news__home-grid{display:flex;gap:16px;width:100%;overflow-x:auto;overflow-y:hidden;padding:2px 0 14px;scroll-snap-type:inline proximity;scroll-behavior:auto;overscroll-behavior-inline:contain;scrollbar-width:none;cursor:grab;touch-action:pan-x pan-y;user-select:none;-webkit-overflow-scrolling:touch}
.ig-news--home .ig-news__home-grid::-webkit-scrollbar{display:none}
.ig-news--home .ig-news__home-grid.is-dragging{cursor:grabbing;scroll-snap-type:none}
.ig-news--home .ig-news-card{flex:0 0 var(--ig-news-home-card);width:var(--ig-news-home-card);scroll-snap-align:start}
.ig-news--home .ig-card__body{min-height:132px}
.ig-news--archive.ig-container{width:100%!important;max-width:none!important;margin:0!important;padding:48px var(--ig-gutter) 80px!important}
.ig-news--archive .ig-news__archive-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;width:100%;align-items:stretch}
.ig-news--archive .ig-news-card{width:100%}
@media(min-width:1800px){.ig-news{--ig-news-home-card:390px}.ig-news--archive .ig-news__archive-grid{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}}
@media(min-width:2400px){.ig-news{--ig-news-home-card:420px}}
@media(min-width:3200px){.ig-news{--ig-news-home-card:440px}}
@media(max-width:760px){.ig-news{--ig-news-home-card:min(84vw,340px)}.ig-news--home .ig-news__home-grid{gap:11px;padding-bottom:10px}.ig-news--home .ig-card__body{min-height:118px}.ig-news--archive.ig-container{padding:34px 20px 60px!important}.ig-news--archive .ig-news__archive-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.ig-news--home .ig-news__home-grid{scroll-behavior:auto}}
`.trim());

replace('features/news/shared/index.js',
`    return \`<a class="card ig-news-card\${compact ? ' ig-news-card--compact' : ''}" href="\${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer" data-news-external>
      <img class="ig-news-card__image" src="\${escapeHtml(absoluteAsset(item.image))}" alt="\${title}" loading="lazy">
      <div class="card-body ig-news-card__body">
        <div class="ig-news-card__date">\${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · \${escapeHtml(sourceName(item))}</div>
        \${tags.length ? \`<div class="ig-news-card__tags">\${tags.map(tag => \`<span>\${escapeHtml(tag)}</span>\`).join('')}</div>\` : ''}
        <h3 class="ig-news-card__title">\${title}</h3>
        \${compact || !summary ? '' : \`<p class="ig-news-card__summary">\${summary}</p>\`}
      </div>
    </a>\`;`,
`    return \`<a class="ig-card ig-card--interactive ig-news-card\${compact ? ' ig-news-card--compact' : ''}" href="\${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer" data-news-external>
      <img class="ig-card__media ig-card__media--landscape" src="\${escapeHtml(absoluteAsset(item.image))}" alt="\${title}" loading="lazy">
      <div class="ig-card__body">
        <div class="ig-card__meta">\${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · \${escapeHtml(sourceName(item))}</div>
        \${tags.length ? \`<div class="ig-chip-list">\${tags.map(tag => \`<span class="ig-chip">\${escapeHtml(tag)}</span>\`).join('')}</div>\` : ''}
        <h3 class="ig-card__title">\${title}</h3>
        \${compact || !summary ? '' : \`<p class="ig-card__summary">\${summary}</p>\`}
      </div>
    </a>\`;`);
replace('features/news/shared/index.js',
`    target.innerHTML = \`<div class="ig-news__state\${kind ? \` ig-news__state--\${escapeHtml(kind)}\` : ''}">\${escapeHtml(message)}</div>\`;`,
`    target.innerHTML = \`<div class="ig-empty-state\${kind ? \` ig-empty-state--\${escapeHtml(kind)}\` : ''}">\${escapeHtml(message)}</div>\`;`);

replace('features/news/home-widget/index.js',
`        : \`<div class="ig-news__state">\${api.escapeHtml(copy.empty)}</div>\`;`,
`        : \`<div class="ig-empty-state">\${api.escapeHtml(copy.empty)}</div>\`;`);

replace('features/news/archive-page/index.js',
`      : \`<div class="ig-news__state">\${api.escapeHtml(copy.empty)}</div>\`;`,
`      : \`<div class="ig-empty-state">\${api.escapeHtml(copy.empty)}</div>\`;`);
replace('features/news/archive-page/index.js',
`    toolbar.innerHTML = \`<div class="ig-news-toolbar__top"><input type="search" data-news-search placeholder="\${api.escapeHtml(copy.search)}"></div>
      <div class="ig-news-toolbar__tags"><button class="is-active" type="button" data-news-tag="">\${api.escapeHtml(copy.all)}</button>\${tags.map(tag => \`<button type="button" data-news-tag="\${api.escapeHtml(tag)}">\${api.escapeHtml(tag)}</button>\`).join('')}</div>\`;`,
`    toolbar.innerHTML = \`<div><input class="ig-input ig-input--search" type="search" data-news-search placeholder="\${api.escapeHtml(copy.search)}"></div>
      <div class="ig-filter-list"><button class="ig-filter-chip is-active" type="button" data-news-tag="">\${api.escapeHtml(copy.all)}</button>\${tags.map(tag => \`<button class="ig-filter-chip" type="button" data-news-tag="\${api.escapeHtml(tag)}">\${api.escapeHtml(tag)}</button>\`).join('')}</div>\`;`);

replace('index.html', 'class="ig-news__controls" data-news-home-controls', 'class="ig-control-group ig-news__controls" data-news-home-controls');
replace('index.html', 'class="ig-news__control" type="button" data-news-direction="prev"', 'class="ig-icon-button ig-news__control" type="button" data-news-direction="prev"');
replace('index.html', 'class="ig-news__control" type="button" data-news-direction="next"', 'class="ig-icon-button ig-news__control" type="button" data-news-direction="next"');
replace('index.html', '<div class="ig-news__home-grid" data-news-home aria-live="polite"><div class="ig-news__state">', '<div class="ig-news__home-grid" data-news-home aria-live="polite"><div class="ig-empty-state">');
replace('index.html', '<h1>Новости</h1>', '<h1 class="ig-page-title">Новости</h1>');
replace('index.html', 'class="ig-news-toolbar" data-news-toolbar', 'class="ig-toolbar ig-news-toolbar" data-news-toolbar');
replace('index.html', '<div class="ig-news__archive-grid" data-news-archive aria-live="polite"><div class="ig-news__state">', '<div class="ig-news__archive-grid" data-news-archive aria-live="polite"><div class="ig-empty-state">');

write('DESIGN_SYSTEM.md', `# Дизайн-система Игропоиска

## Единственный источник компонентов

Все визуальные компоненты сайта определяются только в центральной дизайн-системе: \`assets/design-system.css\` и её официальных центральных расширениях. Модулям, страницам, блокам, парсерам и отдельным функциям запрещено создавать собственные кнопки, карточки, поля ввода, теги, панели, состояния, типографику компонентов, цвета, тени, радиусы и варианты взаимодействия.

Модуль может определять только композицию: сетку, порядок элементов, размеры областей, размещение, прокрутку и адаптивное расположение. Внешний вид элементов всегда задаётся центральным компонентом класса \`ig-*\`.

Новый визуальный элемент сначала добавляется как универсальный компонент или вариант в центральную дизайн-систему. Только после этого его разрешено использовать в конкретном блоке.

## Обязательные центральные компоненты

- \`ig-card\`, \`ig-card--interactive\` и элементы \`ig-card__*\` — карточки;
- \`ig-button\` и \`ig-icon-button\` — кнопки;
- \`ig-input\` — поля ввода;
- \`ig-filter-chip\` — кнопки фильтра;
- \`ig-chip\` и \`ig-chip-list\` — теги;
- \`ig-toolbar\` — панель инструментов и фильтров;
- \`ig-empty-state\` — загрузка, пустое состояние и ошибка;
- \`ig-page-title\` — заголовок страницы.

Локальный класс разрешён только как технический крючок для размещения и поведения. Он не может задавать цвет, фон, границу, радиус, тень, шрифт, размер текста, состояние наведения или другой внешний вид компонента.

## Базовые принципы

Все заголовки и карточки используют общую сетку контейнера. Заголовки секций всегда выровнены по левому краю содержимого. Отдельные центрированные заголовки на главной запрещены.

## Обязательные состояния

У каждого интерактивного компонента должны быть состояния \`hover\`, \`focus-visible\` и \`active\`, определённые централизованно. Модуль не переопределяет эти состояния.

## Даты и метаданные

Дата обязательна для новостей, обзоров, статей и гайдов. Формат: \`2 августа 2026\`. Карточка без даты не публикуется.

## Светлая и тёмная темы

Все компоненты используют только центральные токены \`--ig-*\`. Жёстко заданные цвета внутри модулей запрещены.
`);

let projectRules = read('PROJECT_RULES.md');
const projectMarker = '## Центральная дизайн-система компонентов';
if (!projectRules.includes(projectMarker)) {
  projectRules += `\n\n${projectMarker}\n\nЛюбому блоку, странице и функциональному модулю запрещено создавать или оформлять собственные компоненты. Все кнопки, карточки, поля, фильтры, теги, панели, состояния и типографические компоненты должны поступать из центральной дизайн-системы. Локальные стили разрешены только для композиции и размещения. Любое новое визуальное решение сначала создаётся в центральной дизайн-системе и только затем подключается к модулю. Автоматическая проверка должна блокировать локальные цвета, фоны, границы, радиусы, тени, шрифты и состояния компонентов.\n`;
  write('PROJECT_RULES.md', projectRules);
}

write('features/news/RULES.md', `# Модуль новостей

## Граница модуля

Интерфейс новостей находится только в \`features/news/\`.

- \`home-widget/\` отвечает только за новостной блок главной.
- \`archive-page/\` отвечает только за страницу списка новостей, поиск и фильтры.
- \`shared/\` отвечает за загрузку, нормализацию и представление общих новостных данных.
- \`styles/\` содержит только композицию и селекторы, начинающиеся с \`.ig-news\`.

## Центральные компоненты

Модуль не владеет ни одним визуальным компонентом. Карточки, кнопки, поля поиска, фильтры, теги, заголовки и состояния берутся только из \`assets/design-system.css\` через классы \`ig-*\`.

В \`features/news/styles/\` запрещены цвета, фоны, границы, радиусы, тени, шрифты, размеры текста, визуальные состояния и любые собственные варианты компонентов. Разрешены только сетка, размеры областей, размещение, прокрутка и адаптивная композиция.

## Запрещено

При задаче на внешний вид или функции новостей нельзя изменять шапку, общую сетку, авторизацию, игры, обзоры, релизы, календарь и их данные. Нельзя добавлять глобальные CSS-селекторы в стили модуля. Нельзя создавать локальную кнопку, карточку, поле, тег или панель даже под префиксом \`.ig-news\`.

## Данные

Модуль только читает структурированные данные:

- \`data/news-events.json\`
- \`data/news.json\`
- \`data/publisher-news.json\`
- \`data/news-home-ru.json\`
- \`assets/news/\`
- \`assets/publisher-news/\`

Изменение интерфейса не должно переписывать эти файлы. Парсеры не должны редактировать HTML, CSS или JavaScript модуля.

## Ветки

- \`news-ui/*\` — разрешены изменения только в \`features/news/\`, но новые компоненты требуют отдельного согласованного изменения центральной дизайн-системы.
- \`news-content/*\` — разрешены только новостные JSON и изображения.
- изменения парсеров выполняются отдельной задачей и отдельной веткой.
`);

const module = JSON.parse(read('features/news/module.json'));
module.designSystem = {
  source: 'assets/design-system.css',
  policy: 'central-components-only',
  localStyles: 'composition-only'
};
write('features/news/module.json', JSON.stringify(module, null, 2));

write('scripts/validate-central-design-system.mjs', `import fs from 'node:fs';\nimport path from 'node:path';\n\nconst errors = [];\nconst walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {\n  const target = path.join(directory, entry.name);\n  return entry.isDirectory() ? walk(target) : [target];\n}) : [];\n\nconst designSystem = fs.readFileSync('assets/design-system.css', 'utf8');\n[\n  '.ig-card--interactive', '.ig-card__media', '.ig-card__body', '.ig-card__meta', '.ig-card__title', '.ig-card__summary',\n  '.ig-icon-button', '.ig-input', '.ig-filter-chip', '.ig-chip-list', '.ig-toolbar', '.ig-empty-state', '.ig-page-title'\n].forEach(token => { if (!designSystem.includes(token)) errors.push(\`Central design system is missing \${token}\`); });\n\nconst forbiddenProperties = /^(?:color|background(?:-color|-image)?|border(?:-color|-radius|-style|-width)?|box-shadow|text-shadow|font(?:-family|-size|-weight|-style)?|line-height|letter-spacing|text-transform|text-decoration|outline(?:-color|-style|-width)?|opacity|filter|backdrop-filter|object-fit|aspect-ratio|transition|animation)$/;\nfor (const file of walk('features').filter(file => file.endsWith('.css'))) {\n  const css = fs.readFileSync(file, 'utf8').replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');\n  if (/(?:#[0-9a-f]{3,8}\\b|rgba?\\(|hsla?\\()/i.test(css)) errors.push(\`Literal color is forbidden in feature CSS: \${file}\`);\n  for (const match of css.matchAll(/(?:^|[;{])\\s*([a-z-]+)\\s*:/gm)) {\n    if (forbiddenProperties.test(match[1])) errors.push(\`Component visual property \${match[1]} is forbidden in \${file}\`);\n  }\n}\n\nfor (const file of walk('features').filter(file => file.endsWith('.js'))) {\n  const source = fs.readFileSync(file, 'utf8');\n  for (const tag of source.matchAll(/<button\\b[^>]*>/g)) {\n    if (!/class=\\"[^\\"]*\\b(?:ig-button|ig-icon-button|ig-filter-chip)\\b/.test(tag[0])) errors.push(\`Feature button does not use a central component in \${file}: \${tag[0]}\`);\n  }\n  for (const tag of source.matchAll(/<input\\b[^>]*>/g)) {\n    if (!/class=\\"[^\\"]*\\big-input\\b/.test(tag[0])) errors.push(\`Feature input does not use ig-input in \${file}: \${tag[0]}\`);\n  }\n  for (const tag of source.matchAll(/<a\\b[^>]*class=\\"[^\\"]*ig-news-card[^\\"]*\\"[^>]*>/g)) {\n    if (!/\\big-card\\b/.test(tag[0])) errors.push(\`Feature card does not use ig-card in \${file}: \${tag[0]}\`);\n  }\n}\n\nif (errors.length) throw new Error(\`Central design-system validation failed:\\n\${errors.map(error => \`- \${error}\`).join('\\n')}\`);\nconsole.log('Central design-system component policy verified.');\n`);

let newsValidator = read('scripts/validate-news-module.mjs');
newsValidator = newsValidator.replace(
"    'features/news/styles/index.css'\n];",
"    'features/news/styles/index.css',\n  'scripts/validate-central-design-system.mjs'\n];"
);
newsValidator = newsValidator.replace(
"    'features/news/archive-page/index.js'\n  ];",
"    'features/news/archive-page/index.js',\n    'class=\"ig-icon-button ig-news__control\"',\n    'class=\"ig-toolbar ig-news-toolbar\"',\n    'class=\"ig-page-title\"',\n    'class=\"ig-empty-state\"'\n  ];"
);
newsValidator = newsValidator.replace(
"  const moduleScripts = [",
"  const designSystem = read('assets/design-system.css');\n  ['.ig-card--interactive', '.ig-icon-button', '.ig-input', '.ig-filter-chip', '.ig-empty-state'].forEach(token => {\n    if (!designSystem.includes(token)) errors.push(`Central design system is missing required component: ${token}`);\n  });\n\n  const moduleScripts = ["
);
newsValidator = newsValidator.replace(
"  const dataWrites = /(?:writeFile|appendFile|localStorage\\.setItem|sessionStorage\\.setItem)/;",
"  ['ig-card', 'ig-card__media', 'ig-card__body', 'ig-card__meta', 'ig-card__title', 'ig-chip', 'ig-input', 'ig-filter-chip', 'ig-empty-state'].forEach(token => {\n    if (!moduleScripts.includes(token)) errors.push(`News module is not consuming central component: ${token}`);\n  });\n\n  const dataWrites = /(?:writeFile|appendFile|localStorage\\.setItem|sessionStorage\\.setItem)/;"
);
write('scripts/validate-news-module.mjs', newsValidator);

let newsWorkflow = read('.github/workflows/news-module-check.yml');
if (!newsWorkflow.includes('validate-central-design-system.mjs')) {
  newsWorkflow = newsWorkflow.replace('      - name: Verify news module boundary\n        run: node scripts/validate-news-module.mjs', '      - name: Verify news module boundary\n        run: |\n          node scripts/validate-news-module.mjs\n          node scripts/validate-central-design-system.mjs');
  write('.github/workflows/news-module-check.yml', newsWorkflow);
}

let designWorkflow = read('.github/workflows/design-system-check.yml');
if (!designWorkflow.includes("      - 'features/**'")) {
  designWorkflow = designWorkflow.replaceAll("      - 'assets/**'", "      - 'assets/**'\n      - 'features/**'");
}
if (!designWorkflow.includes('validate-central-design-system.mjs')) {
  designWorkflow = designWorkflow.replace('      - run: node scripts/validate-game-v3.mjs', '      - run: |\n          node scripts/validate-game-v3.mjs\n          node scripts/validate-central-design-system.mjs');
}
write('.github/workflows/design-system-check.yml', designWorkflow);

console.log('News now consumes central components; feature CSS is composition-only.');
