# Игропоиск — стабильный модуль создания страниц игр

**Статус:** STABLE MODULE CONTRACT  
**Версия контракта:** 2026-09-03.2  
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
  → professional rating from currently confirmed direct reviews
  → media/content enrichment
  → zero-host editorial provider router
  → canonical page editorial
  → content QC + media QC + source validity QC + overall page QC
  → canonical identity normalization
  → finalize-game-page-publication.mjs
  → catalog + public shell + runtime page
```

Ни один промежуточный этап и ни один внешний модуль не имеет права сам объявить страницу опубликованной.

## 3. Канонические артефакты

- identity: Game Registry / постоянный `game_id`;
- structured parser result: `data/parser-output/<slug>.json`;
- working revision draft: `data/drafts/<slug>.json`;
- evidence/source corpus: `data/game-sources/<slug>.json`;
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

**Количество найденных профессиональных обзоров не блокирует публикацию страницы игры.** `discovery.complete` означает, что текущий проход discovery фактически выполнен и canonical corpus собран; оно не означает, что достигнута произвольная квота источников. Все корректно найденные на текущий момент источники и оценки публикуются на странице.

Минимумы professional/scored sources сохраняются как отдельный `coverage_passed` для оценки полноты корпуса, собственного обзора Игропоиска и последующего enrichment. Если coverage ниже целевого, поиск источников должен продолжаться и может создать новую revision страницы с расширенным corpus/рейтингом, но уже опубликованная корректная страница не блокируется и не снимается с публикации.

## 5. Editorial/AI contract

Page editorial — не обзор. Это краткое описание, интегрированное описание, campaign/structure и features самой страницы.

Для него используется `scripts/lib/free-editorial-ai.mjs` как **zero-host editorial provider router**. При наличии соответствующих credentials provider order по умолчанию такой:

1. OpenRouter → `moonshotai/kimi-k2.6:free`;
2. GigaChat → `GigaChat-3-Ultra`, с `GigaChat-2-Max` как fallback;
3. Gemini → `gemini-2.5-pro`;
4. Groq → `qwen/qwen3.8-27b`;
5. только если ни одного zero-host provider не настроено — локальный `Ollama + qwen2.5:3b` как аварийный fallback.

Для page module **не требуется собственный GPU-сервер** и **не требуется paid AI API**. Внешний provider может работать на free/freemium/provider plan; выбор тарифа не меняет publication contract. Credentials хранятся только в GitHub Secrets и не попадают в canonical artifacts.

AI получает только уже собранные проверенные данные и текущий canonical source corpus. Его результат — candidate, а не source of truth. Он обязан пройти semantic/content QC и materialization в `data/page-editorial/<slug>.json`.

Если все настроенные providers недоступны или результат не проходит QC, страница остаётся `needs_revision`; плохой fallback не публикуется. Router может переключиться на следующий provider при технической ошибке, но не имеет права ослаблять content/QC gates.

## 6. Publication ownership

`build-game-page-basic.mjs` — **draft-only**.  
`build-game-page.mjs` — **editorial-only**.  
`materialize-page-editorial.mjs` — создаёт canonical editorial только после допустимого качества.  
`finalize-game-page-publication.mjs` — **единственный владелец перехода в published/public_ready**.

Finalizer обязан fail closed, если хотя бы одно из условий не green:

- overall page QC;
- content QC;
- media QC;
- текущий source discovery проход не завершён технически / corpus не сформирован;
- canonical page editorial.

**Coverage quota источников не является publication gate страницы.**

### Published package immutability

После finalizer набор `draft + page-editorial + source corpus + QC + catalog entry + game-content + public shell` считается **published canonical package** и не может редактироваться enrichment-скриптами на месте.

Любое новое media/relation/identity/catalog/source enrichment после публикации создаёт или ставит в очередь **новую revision**, которая снова обязана пройти применимые QC и finalizer. Если revision не проходит, предыдущий published canonical package восстанавливается без изменений.

## 7. Контракт клиентов Page Assembly

Все внешние клиенты разделены manifest на пять классов.

### Queue-only adapters

News, Top 250 и другие discovery/entry adapters могут:
- разрешить canonical identity;
- создать `needs_revision` draft;
- поставить page task в lifecycle queue.

Они не могут писать `public_ready:true`, создавать публичный shell или добавлять игру в `catalog-visible` как готовую страницу.

### Copy-only promoters

Staging/production promotion может только скопировать **уже finalized** canonical package. Перед копированием и после него выполняется `validate-game-page-publication-state.mjs`. Promoter не имеет права запускать builder и не имеет права синтезировать public state.

### Rollback-only orchestrators

Lifecycle orchestrator может физически восстановить байты последнего published canonical package после неудачной revision. Он не имеет права синтезировать новое `published/public_ready` состояние. Успешная публикация всё равно проходит только через canonical finalizer.

### Finalizer delegates

Совместимые entry points могут вызвать canonical finalizer, но не повторяют его логику у себя.

### Revision-safe mutators

Media/relations/source enrichment имеет право менять только незавершённый revision draft/corpus. Если обнаружен published package, он сохраняется неизменным, а enrichment переводится в новую page revision.

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
- queue-only/copy-only/rollback-only/delegate/revision-safe границы;
- фактические write targets public artifacts, а не простые упоминания путей;
- отсутствие прямого `published/public_ready` writer вне finalizer;
- zero-host provider router, отсутствие обязательной paid AI dependency и сохранность локального Ollama/Qwen fallback;
- наличие source/content/media/editorial gates;
- отсутствие literal game-slug branching и runtime monkey-patching;
- отсутствие синтетического собственного обзора;
- null-safe runtime hydration;
- обязательные runtime layers;
- целостность документации.

Из-за этого ситуация «workflow существует, но один обязательный файл или publication boundary потерян в другой ветке» должна падать на module-integrity gate ещё до запуска конкретной игры.

## 10. Review subsystem boundary

Внешние профессиональные рецензии как evidence принадлежат source corpus страницы. **Собственный обзор Игропоиска остаётся отдельным модулем.**

Page module показывает все подтверждённые внешние источники, найденные на текущий момент, и может показать опубликованный обзор Игропоиска, если он существует. При этом он:

- не пишет собственный обзор Игропоиска;
- не имитирует его из page editorial;
- не требует готовности собственного обзора для существования страницы;
- не требует достижения review coverage quota для публикации страницы;
- не создаёт параллельный review-source registry;
- не получает от review subsystem разрешение на публикацию самой game page.

## 11. Определение «100% ready»

Нельзя объявлять модуль готовым только потому, что отдельные unit checks зелёные. **Сертификация самого Page Assembly выполняется независимо от создания новой acceptance-игры.** Это позволяет сначала доказать готовность инструмента, а уже затем применять его к новой игре.

Статус 100% ready допускается только одновременно при выполнении условий:

1. `validate-game-page-module-integrity.mjs` green на фактической integration-ветке и не содержит unclassified public writers;
2. все обязательные module/page/runtime/staging gates green;
3. builders, adapters, mutators, promoters и rollback физически не способны обойти sole finalizer или изменить published canonical package на месте;
4. shared runtime не содержит game-specific presentation logic, runtime source rewriting или synthetic Review;
5. zero-host editorial provider router корректно выбирает настроенный provider, возвращает структурированный JSON, не требует собственного GPU-сервера и при отсутствии credentials сохраняет локальный Ollama/Qwen fallback;
6. существующие finalized game pages проходят generic publication-state validation и реальный shared-runtime browser smoke;
7. модуль безопасно проходит staging merge/promotion и production deployment/runtime gates.

**Fresh-game acceptance выполняется только после этой сертификации.** Он является проверкой применения уже готового инструмента к новой игре, а не способом объявить сам инструмент готовым. Конкретная acceptance-игра не является частью архитектурного контракта и не должна фигурировать в shared runtime, manifest или специальных ветках логики.

## 12. Freeze rule

Изменение любого файла из `config/game-page-module.manifest.json` или любого publication-boundary adapter считается изменением стабильного page module и должно проходить module-integrity gate.

Запрещено без явного изменения архитектурного контракта:

- публиковать из builder/AI step напрямую;
- обходить finalizer;
- мутировать published canonical package enrichment-скриптом;
- давать News/Top/Popular/Releases отдельный механизм публичной страницы;
- ослаблять source validity/content/media/editorial QC для конкретной игры;
- превращать arbitrary source-count quota в блокер публикации страницы;
- возвращать generic placeholder как green editorial;
- вводить paid AI как обязательную зависимость;
- заводить второй механизм страниц;
- делать review article частью обязательного page publication gate;
- синтезировать Review из page editorial;
- добавлять game-specific shared-runtime hardcode;
- переписывать runtime source строковыми runtime patches.

Этот документ — canonical module-level architecture contract. Общесистемные границы описаны в `docs/SYSTEM_ARCHITECTURE.md`; точный исполняемый состав и publication boundary этого модуля определены manifest и проверяются автоматически.
