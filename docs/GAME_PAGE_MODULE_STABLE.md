# Игропоиск — стабильный модуль создания страниц игр

**Статус:** STABLE MODULE CONTRACT  
**Версия контракта:** 2026-09-02.1  
**Машиночитаемый состав:** `config/game-page-module.manifest.json`

## 1. Граница модуля

Модуль страницы игры — единый переносимый механизм, который получает конкретную canonical game и доводит её от фактов и источников до полностью проверенной публичной страницы.

**Обзор игры не является частью модуля страницы игры.** Обзор Игропоиска — отдельная редакционная публикация. При этом поиск, проверка и хранение внешних профессиональных рецензий входят в модуль страницы, потому что они являются частью canonical evidence corpus игры и используются для рейтинга, фактов и вкладки «Источники».

News, Popular, Releases, Search и другие модули не входят в page module. Они могут только передать canonical `game_id`/кандидата в общий lifecycle страницы.

## 2. Единственная допустимая цепочка сборки

```text
Game Registry / canonical identity
  → parse factual structured data
  → deterministic draft
  → independent source discovery
  → publication-hub discovery
  → canonical source corpus
  → professional rating from confirmed direct reviews
  → media/content enrichment
  → free local Qwen editorial repair
  → canonical page editorial
  → content QC + media QC + source/rating QC + overall page QC
  → finalize-game-page-publication.mjs
  → catalog + public shell + runtime page
```

Ни один промежуточный этап не имеет права сам объявить страницу опубликованной.

## 3. Канонические артефакты

- identity: Game Registry / постоянный `game_id`;
- structured parser result: `data/parser-output/<slug>.json`;
- working draft: `data/drafts/<slug>.json`;
- полный evidence/source corpus: `data/game-sources/<slug>.json`;
- calculated rating evidence: `data/ratings/<slug>.json`;
- canonical editorial страницы: `data/page-editorial/<slug>.json`;
- page/content/media QC: `data/quality-control/*<slug>*.json`;
- public projection: `data/game-content/*`, `data/catalog-visible.json`, `game/<slug>/index.html`.

`data/game-sources/<slug>.json` — единственный source corpus страницы. Review/DNA/rating/media-подсистемы используют его повторно, а не создают конкурирующую базу источников.

## 4. Source contract

Обязательные generic source stages:

- `scripts/discover-game-sources-web.mjs` — независимый web discovery;
- `scripts/discover-game-publication-hubs.mjs` — дополнительный поиск по изданиям;
- `scripts/collect-game-sources.mjs` — формирует canonical corpus.

Metacritic/OpenCritic и подобные агрегаторы могут использоваться как discovery index, но не как подмена прямой профессиональной рецензии для рейтинга. В professional source count и rating допускаются только подтверждённые прямые материалы изданий.

Страница не проходит publication gate, если minimum professional/scored source contract не выполнен.

## 5. Editorial/AI contract

Page editorial — не обзор. Это краткое описание, интегрированное описание, campaign/structure и features самой страницы.

Для него используется бесплатный локальный backend `Ollama + qwen2.5:3b` через `scripts/lib/free-editorial-ai.mjs`. Paid OpenAI/API не является зависимостью page module.

AI получает только уже собранные данные и canonical source corpus. Его результат — candidate, а не source of truth. Он обязан пройти semantic/content QC и materialization в `data/page-editorial/<slug>.json`.

Если Ollama/Qwen недоступен или результат не проходит QC, страница остаётся `needs_revision`; плохой fallback не публикуется.

## 6. Publication ownership

`build-game-page-basic.mjs` — **draft-only**.  
`build-game-page.mjs` — **editorial-only**.  
`materialize-page-editorial.mjs` — создаёт canonical editorial только после допустимого качества.  
`finalize-game-page-publication.mjs` — **единственный владелец перехода в published/public_ready**.

Finalizer обязан fail closed, если хотя бы одно из условий не green:

- overall page QC;
- content QC;
- media QC;
- source discovery completeness;
- canonical page editorial.

При неудачной новой ревизии уже существующее хорошее публичное состояние не должно заменяться плохим.

## 7. Runtime contract

Все game pages используют общий runtime, а не отдельный код конкретной игры. Обязательные части runtime зафиксированы manifest, включая:

- `game-page-v3.js` / `game-page-v3-bootstrap.js`;
- `game-page-source-corpus.js`;
- `game-page-integrity.js`;
- `game-media-sanitize.js`;
- review/source/materialized/quality layers.

Game-specific presentation hardcode внутри shared runtime запрещён. Исключения конкретной игры допустимы только как явно проверяемые data overrides, если они являются данными, а не второй реализацией страницы.

## 8. Машинная защита архитектуры

`config/game-page-module.manifest.json` перечисляет обязательный состав модуля и его инварианты.

`scripts/validate-game-page-module-integrity.mjs` обязан выполняться в CI до page lifecycle/deploy. Он проверяет:

- наличие каждого обязательного файла;
- отсутствие legacy filenames/references;
- draft-only контракт builders;
- sole-finalizer publication contract;
- бесплатный Ollama/Qwen backend без paid OpenAI dependency;
- наличие source/content/media/editorial gates;
- обязательные runtime layers;
- целостность документации.

Из-за этого ситуация «workflow существует, но один обязательный файл модуля потерян в другой ветке» должна падать на module-integrity gate ещё до запуска конкретной игры.

## 9. Review subsystem boundary

Внешние профессиональные рецензии как evidence принадлежат source corpus страницы. **Собственный обзор Игропоиска остаётся отдельным модулем.**

Page module может показать опубликованный обзор, если он существует, но:

- не пишет его;
- не требует его для существования страницы;
- не создаёт параллельный review-source registry;
- не получает от review subsystem разрешение на публикацию самой game page.

## 10. Определение «100% ready»

Нельзя объявлять модуль готовым только потому, что отдельные unit/production checks зелёные. Статус 100% допускается только одновременно при выполнении четырёх условий:

1. `validate-game-page-module-integrity.mjs` green на фактической ветке запуска;
2. обычные page/runtime/deployment gates green;
3. fresh-game acceptance проходит всю generic цепочку от parse/source discovery до finalizer без game-specific кода;
4. опубликованная acceptance page действительно имеет `published + public_ready`, canonical sources/editorial, green content/media/page QC и рабочий shared runtime.

Текущая acceptance-игра для проверки полного контракта — **Spore**. Она не является исключением в коде и не должна получать специальные данные/ветки логики.

## 11. Freeze rule

Изменение любого файла из `config/game-page-module.manifest.json` считается изменением стабильного page module и должно проходить module-integrity gate.

Запрещено без явного изменения архитектурного контракта:

- публиковать из builder/AI step напрямую;
- обходить finalizer;
- ослаблять source/content/media/editorial QC для конкретной игры;
- возвращать generic placeholder как green editorial;
- вводить paid AI как обязательную зависимость;
- заводить второй механизм страниц;
- делать review article частью обязательного page publication gate;
- добавлять game-specific shared-runtime hardcode.

Этот документ — canonical module-level architecture contract. Общесистемные границы описаны в `docs/SYSTEM_ARCHITECTURE.md`; точный исполняемый состав этого модуля определён manifest и проверяется автоматически.
