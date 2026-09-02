# Игропоиск — стабильный модуль создания страниц игр

**Статус:** STABLE MODULE CONTRACT  
**Версия контракта:** 2026-09-02.2  
**Машиночитаемый состав:** `config/game-page-module.manifest.json`

## 1. Граница модуля

Модуль страницы игры — единый переносимый механизм, который получает конкретную canonical game и доводит её от фактов и источников до полностью проверенной публичной страницы.

**Обзор игры не является частью модуля страницы игры.** Обзор Игропоиска — отдельная редакционная публикация. При этом поиск, проверка и хранение внешних профессиональных рецензий входят в модуль страницы, потому что они являются частью canonical evidence corpus игры и используются для рейтинга, фактов и вкладки «Источники».

News, Popular, Releases, Search, Top 250 и другие модули не входят в page module. Они не имеют права создавать страницу напрямую. Они могут только передать canonical `game_id`/кандидата в общий lifecycle страницы или использовать уже опубликованный canonical package.

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
  → canonical identity normalization
  → finalize-game-page-publication.mjs
  → catalog + public shell + runtime page
```

Ни один промежуточный этап и ни один внешний модуль не имеет права сам объявить страницу опубликованной.

## 3. Канонические артефакты

- identity: Game Registry / постоянный `game_id`;
- structured parser result: `data/parser-output/<slug>.json`;
- working revision draft: `data/drafts/<slug>.json`;
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

### Published package immutability

После finalizer набор `draft + page-editorial + source corpus + QC + catalog entry + game-content + public shell` считается **published canonical package** и не может редактироваться enrichment-скриптами на месте.

Любое новое media/relation/identity/catalog enrichment после публикации создаёт или ставит в очередь **новую revision**, которая снова обязана пройти всю цепочку QC и finalizer. Если revision не проходит, предыдущий published canonical package восстанавливается без изменений.

## 7. Контракт клиентов Page Assembly

Все внешние клиенты разделены manifest на четыре класса.

### Queue-only adapters

News, Top 250 и другие discovery/entry adapters могут:
- разрешить canonical identity;
- создать `needs_revision` draft;
- поставить page task в lifecycle queue.

Они не могут писать `public_ready:true`, создавать публичный shell или добавлять игру в `catalog-visible` как готовую страницу.

### Copy-only promoters

Staging/production promotion может только скопировать **уже finalized** canonical package. Перед копированием и после него выполняется `validate-game-page-publication-state.mjs`. Promoter не имеет права запускать builder и не имеет права синтезировать public state.

### Finalizer delegates

Совместимые entry points могут вызвать canonical finalizer, но не повторяют его логику у себя.

### Revision-safe mutators

Media/relations enrichment имеет право менять только незавершённый revision draft. Если обнаружен published package, он сохраняется неизменным, а enrichment переводится в новую page revision.

Точный список каждого класса находится в `config/game-page-module.manifest.json` и проверяется CI.

## 8. Runtime contract

Все game pages используют общий runtime, а не отдельный код конкретной игры. Обязательные части runtime зафиксированы manifest, включая:

- `game-page-v3.js` / `game-page-v3-bootstrap.js`;
- `game-page-source-corpus.js`;
- `game-page-integrity.js`;
- `game-media-sanitize.js`;
- review/source/materialized/quality layers.

Game-specific presentation hardcode внутри shared runtime запрещён. Bootstrap не имеет права загружать текст runtime, переписывать его строковыми `replace` и выполнять через `Function(...)`. Он только подключает общий runtime и generic data-driven hydration.

Игропоиск Review отображается на странице только при наличии реально опубликованного Review artifact/URL. Page editorial или calculated rating не могут использоваться для создания фиктивной карточки «Обзор Игропоиска».

Runtime должен быть устойчив к независимому удалению optional UI controls. В частности, rating binding обязан быть null-safe; optional rating controls не могут удаляться до завершения их hydration.

## 9. Машинная защита архитектуры

`config/game-page-module.manifest.json` перечисляет обязательный состав модуля, publication boundary, клиентские классы и инварианты.

`scripts/validate-game-page-module-integrity.mjs` обязан выполняться в CI до page lifecycle/deploy. Он проверяет:

- наличие каждого обязательного файла;
- отсутствие legacy filenames/references;
- draft-only контракт builders;
- sole-finalizer publication contract;
- immutable published package;
- queue-only/copy-only/delegate/revision-safe границы;
- отсутствие прямого `published/public_ready` writer вне finalizer;
- бесплатный Ollama/Qwen backend без paid OpenAI dependency;
- наличие source/content/media/editorial gates;
- отсутствие literal game-slug branching и runtime monkey-patching;
- отсутствие синтетического собственного обзора;
- null-safe runtime hydration;
- обязательные runtime layers;
- целостность документации.

Из-за этого ситуация «workflow существует, но один обязательный файл или publication boundary потерян в другой ветке» должна падать на module-integrity gate ещё до запуска конкретной игры.

## 10. Review subsystem boundary

Внешние профессиональные рецензии как evidence принадлежат source corpus страницы. **Собственный обзор Игропоиска остаётся отдельным модулем.**

Page module может показать опубликованный обзор, если он существует, но:

- не пишет его;
- не имитирует его из page editorial;
- не требует его для существования страницы;
- не создаёт параллельный review-source registry;
- не получает от review subsystem разрешение на публикацию самой game page.

## 11. Определение «100% ready»

Нельзя объявлять модуль готовым только потому, что отдельные unit/production checks зелёные. Статус 100% допускается только одновременно при выполнении условий:

1. `validate-game-page-module-integrity.mjs` green на фактической ветке;
2. все обязательные module/page/runtime/deployment gates green;
3. ни один writer/adaptor/mutator не способен обойти sole finalizer или изменить published canonical package на месте;
4. shared runtime не содержит game-specific presentation logic или runtime source rewriting;
5. production promotion принимает только уже finalized canonical package;
6. generic fresh-game acceptance после подтверждения готовности модуля проходит всю цепочку без game-specific кода.

Конкретная acceptance-игра не является частью архитектурного контракта и не должна фигурировать в shared runtime, manifest или специальных ветках логики.

## 12. Freeze rule

Изменение любого файла из `config/game-page-module.manifest.json` или любого publication-boundary adapter считается изменением стабильного page module и должно проходить module-integrity gate.

Запрещено без явного изменения архитектурного контракта:

- публиковать из builder/AI step напрямую;
- обходить finalizer;
- мутировать published canonical package enrichment-скриптом;
- давать News/Top/Popular/Releases отдельный механизм публичной страницы;
- ослаблять source/content/media/editorial QC для конкретной игры;
- возвращать generic placeholder как green editorial;
- вводить paid AI как обязательную зависимость;
- заводить второй механизм страниц;
- делать review article частью обязательного page publication gate;
- синтезировать Review из page editorial;
- добавлять game-specific shared-runtime hardcode;
- переписывать runtime source строковыми runtime patches.

Этот документ — canonical module-level architecture contract. Общесистемные границы описаны в `docs/SYSTEM_ARCHITECTURE.md`; точный исполняемый состав и publication boundary этого модуля определены manifest и проверяются автоматически.
