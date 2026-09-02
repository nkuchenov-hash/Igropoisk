# Игропоиск — каноническая архитектура системы

<!-- CANONICAL_PROJECT_DOCUMENT: IGROPOISK_SYSTEM_ARCHITECTURE -->

> **Назначение:** этот документ описывает, **как весь Игропоиск связан в одну систему**: какие есть модули и публичные страницы, кто владеет какими данными, как данные проходят от источника до публикации, какие зависимости разрешены и где проходят границы между UI, контентом, хранилищем, автоматикой и AI.
>
> **ПУТЬ развития** и порядок миграций находятся в [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md). Обязательные продуктовые инварианты находятся в [`../PROJECT_RULES.md`](../PROJECT_RULES.md). Правила изоляции модулей находятся в [`../features/MODULE_RULES.md`](../features/MODULE_RULES.md).

## 1. Иерархия архитектурных решений

У проекта есть четыре уровня документации, и они не должны конкурировать между собой:

1. **`docs/PROJECT_ROADMAP.md`** — куда проект идёт и в каком порядке.
2. **`docs/SYSTEM_ARCHITECTURE.md`** — как система устроена и как модули связаны.
3. **`PROJECT_RULES.md`** — обязательные продуктовые/публикационные/UI-инварианты.
4. **Модульные документы** — детали News, Releases, Game Registry, Game Page Assembly, Reviews, design system и других подсистем.

Если локальный документ предлагает связь модулей, которая противоречит этому файлу, сначала меняется этот архитектурный контракт отдельным осознанным PR.

---

# 2. Архитектура в одном рисунке

```text
                        ВНЕШНИЕ ИСТОЧНИКИ
       official / stores / databases / professional media
                              │
                              ▼
                    DISCOVERY / PARSERS
         News │ Releases │ Popular │ manual/editorial
              │          │         │
              └──────────┴────┬────┘
                              ▼
                    CANONICAL GAME REGISTRY
                  identity / ids / aliases / state
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
       GAME ENRICHMENT      NEWS/RELEASES    CONTENT LINKS
       metadata/media       canonical links   relations
              │
              ▼
     ┌─────────────────────────────────────────────┐
     │          GAME PAGE ASSEMBLY MODULE          │
     │ identity → facts → canonical source corpus  │
     │ → professional rating → media/content       │
     │ → page editorial → deterministic QC         │
     │ → sole publication finalizer                │
     └──────────────────────┬──────────────────────┘
                            ▼
                    CANONICAL PUBLIC DATA
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
          GAME PAGE      REVIEWS         OTHER FEEDS
          projection     optional         News/Top/etc.
              │          attachment           │
              └─────────────┬─────────────────┘
                            ▼
                       PUBLIC SITE
        Главная / Поиск / Игра / Новости / Календарь
              / Top 250 / Во что поиграть
```

**Главный принцип:** ни один публичный модуль не создаёт собственную параллельную идентичность игры. Игра существует канонически через Game Registry, а страницы и связи строятся вокруг постоянного `game_id`.

**Второй принцип:** собственный обзор Игропоиска — отдельная публикация. Он может подключаться к готовой странице игры, но не является частью механизма сборки и не является обязательным условием существования или публикации game page.

---

# 3. Текущая и целевая инфраструктура

## 3.1 Сейчас — переходная архитектура

На текущем этапе production ещё во многом статический:

```text
GitHub repository
   │
   ├─ code/config/contracts
   ├─ transitional generated data
   └─ workflows
         │
         ▼
GitHub Actions
   parse / research / materialize / validate / publish
         │
         ├──────────> Yandex Object Storage
         │             news/media/snapshots
         ▼
GitHub Pages
   public static site
```

Это **переходное состояние**, а не конечная архитектура. Поэтому критические модули должны быть самопроверяемыми и не зависеть от того, что набор файлов случайно совпал в одной ветке.

## 3.2 Цель

После этапов, описанных в roadmap:

```text
GitHub
 code / PR / CI / deploy
      │
      ▼
Production VPS
 web + Content API + PostgreSQL + workers + queue
      │
      ├────────> S3-compatible Object Storage
      │           media + backups + bounded exports
      │
      └────────> AI Gateway
                    ├─ deterministic/no-AI
                    ├─ local small model
                    └─ on-demand heavy model
```

GitHub перестаёт быть постоянным production worker/runtime. Object Storage перестаёт использоваться как псевдо-БД через бесконечные полные snapshots.

---

# 4. Канонические сущности

## 4.1 Game

`GameEntity` — центральная доменная сущность проекта. Канонический контракт подробно описан в [`game-registry-architecture.md`](./game-registry-architecture.md).

Ключевые свойства:

- постоянный `game_id`;
- canonical title + aliases;
- external IDs;
- release events;
- companies/platforms/classification;
- media metadata;
- relations/series;
- discovery events;
- workflow states;
- provenance;
- revisions/audit.

URL slug — представление, а не идентичность. Смена slug не создаёт новую игру.

## 4.2 Game Source Corpus

Для каждой игры существует **один канонический evidence/source corpus**, принадлежащий Game Page Assembly:

`data/game-sources/<slug>.json`

Он хранит:

- официальные источники и store/database evidence;
- прямые профессиональные рецензии;
- подтверждённые оценки и шкалы;
- provenance и дату проверки;
- роли источника для facts, description, rating, DNA, media и других потребителей.

Metacritic/OpenCritic и другие агрегаторы могут служить discovery index, но не заменяют прямой профессиональный материал в rating evidence.

Review subsystem, Rating presentation, DNA и другие потребители **не создают параллельный source registry**.

## 4.3 Page Editorial

`data/page-editorial/<slug>.json` — канонический редакционный слой **самой страницы**, а не обзор Игропоиска.

Он содержит краткое описание, интегрированное описание, campaign/structure и features, прошедшие semantic/content QC. AI-ответ сам по себе не является каноническим editorial: сначала он должен пройти валидацию и materialization.

## 4.4 NewsItem

Новость имеет собственный ID и хранит:

- source/provenance;
- publication time;
- title/body/summary;
- language/region;
- media references;
- canonical `game_id[]` для связанных игр;
- revision/publication state.

Новостной hashtag/тег игры — это UI-представление связи с `game_id`, а не свободная строка без Registry.

## 4.5 ReleaseEvent

Релиз — событие игры, а не отдельная «игра по названию».

Минимально:

- `game_id`;
- platform;
- region;
- date/date precision;
- release status;
- source/provenance.

Один GameEntity может иметь много ReleaseEvent.

## 4.6 Review

Обзор Игропоиска — самостоятельная editorial entity/publication, связанная с canonical `game_id`. Он читает уже существующий game source corpus и может иметь собственный lifecycle, текст, media-композицию и review-QC.

Он **не владеет** Game Page Assembly, source corpus страницы или правом перевести game page в `published`.

## 4.7 Professional Rating

Профессиональный агрегированный рейтинг игры рассчитывается из всех подтверждённых score-eligible прямых профессиональных рецензий в canonical source corpus. Один и тот же рассчитанный результат используется публичными представлениями игры.

Собственный обзор Игропоиска не создаёт альтернативную оценку той же игры и не является технической предпосылкой расчёта агрегата.

## 4.8 MediaAsset

Media — самостоятельная сущность/asset reference:

- kind: cover / hero / screenshot / art / video;
- canonical owner/link;
- source;
- checksum/content hash;
- dimensions/format;
- provenance;
- storage key or external canonical URL;
- revision/replacement state.

Одинаковый физический файл не должен размножаться из-за того, что на него ссылаются несколько сущностей.

---

# 5. Модули и ответственность

## 5.1 Game Registry — центральная identity layer

**Владеет:** идентичностью игр, aliases, external IDs, lifecycle identity state, relations/conflicts и canonical URL resolution.

**Получает кандидатов от:** News, Releases, Popular, parser/discovery, editorial/manual input.

**Не делает:** не пишет page editorial или обзор, не рассчитывает профессиональный агрегат, не рисует страницу и не парсит все источники сам.

Обязательный контракт:

```text
любой модуль обнаружил игру
       ↓
GameRegistryApi.registerCandidate(...)
       ↓
canonical game_id / needs_review
       ↓
дальнейшие действия только через game_id
```

Ни News, ни Releases, ни Popular не имеют права поддерживать параллельную canonical game database.

## 5.2 Game Page Assembly — фундаментальный модуль страницы игры

**Владеет:** превращением identified canonical GameEntity в полностью проверенную публичную game page.

Машиночитаемый состав модуля зафиксирован в:

`config/game-page-module.manifest.json`

Модульный архитектурный контракт:

[`GAME_PAGE_MODULE_STABLE.md`](./GAME_PAGE_MODULE_STABLE.md)

Единственная допустимая логическая цепочка:

```text
canonical game identity
 → factual structured enrichment
 → deterministic draft
 → independent source discovery
 → publication-hub discovery
 → canonical source corpus
 → professional rating evidence
 → media/content enrichment
 → page editorial candidate
 → canonical page editorial
 → source/content/media/page QC
 → sole publication finalizer
 → public catalog + game shell + runtime projection
```

Ключевые инварианты:

- `build-game-page-basic.mjs` создаёт только draft/revision state;
- `build-game-page.mjs` создаёт только editorial candidate и не публикует;
- `data/game-sources/<slug>.json` обязателен и принадлежит page module;
- `data/page-editorial/<slug>.json` обязателен для green publication;
- `finalize-game-page-publication.mjs` — единственный владелец перехода в `published/public_ready`;
- finalizer fail closed при red/incomplete source, content, media, page или canonical editorial gate;
- плохая новая ревизия не заменяет последнюю good public version;
- shared runtime общий для всех игр; game-specific presentation hardcode запрещён;
- собственный обзор Игропоиска не входит в эту цепочку и не блокирует её.

### 5.2.1 Source discovery

Page module сам собирает reusable evidence dossier. Обязательные generic стадии:

```text
discover-game-sources-web.mjs
 + discover-game-publication-hubs.mjs
 → collect-game-sources.mjs
 → data/game-sources/<slug>.json
```

Профессиональный source count и рейтинг строятся только на direct-review evidence. Список найденных внешних материалов доступен странице независимо от наличия собственного обзора Игропоиска.

### 5.2.2 Page editorial и бесплатный AI

Текущая переходная реализация page-editorial использует общий адаптер `scripts/lib/free-editorial-ai.mjs`, который маршрутизирует задачу в локальный Ollama/Qwen. Бизнес-логика builder не должна обращаться к paid OpenAI API и не имеет права публиковать ответ модели напрямую.

Текущая бесплатная модель: `qwen2.5:3b`. Это implementation detail адаптера текущего GitHub Actions runtime; целевая архитектура переносит такую маршрутизацию в AI Gateway.

Если бесплатный backend недоступен или ответ не проходит semantic QC, страница остаётся `needs_revision`.

### 5.2.3 Самоцелостность модуля

Page module нельзя считать «набором файлов, которые обычно лежат рядом». Его состав — исполняемый контракт.

`scripts/validate-game-page-module-integrity.mjs` проверяет manifest, наличие обязательных scripts/runtime/workflows/docs, draft-only builders, sole-finalizer contract, free-AI boundary и обязательные runtime layers.

Эта проверка должна выполняться в staging gate, game-page-quality, lifecycle и production deploy. Потеря одного обязательного файла должна блокироваться **до** запуска конкретной игры.

## 5.3 Reviews — отдельная editorial publication subsystem

**Владеет:** созданием, обновлением, quality control и публикацией собственного обзора Игропоиска.

Reviews получает canonical `game_id` и читает `data/game-sources/<slug>.json`. Он не выполняет повторный независимый поиск как новый source of truth и не владеет page publication gate.

```text
published/known canonical game
 + canonical game source corpus
 → review research/synthesis
 → review editorial QC
 → review publication
 → optional attachment to game page
```

Отсутствие собственного обзора не делает game page incomplete. Наличие обзора не даёт права обходить source/content/media/page QC страницы.

## 5.4 Ratings

**Владеет логикой расчёта/проекции:** единым профессиональным агрегатом из canonical source corpus.

Инварианты:

- rating evidence происходит из direct professional reviews страницы;
- все score-eligible подтверждённые источники участвуют согласно rating contract;
- legacy/случайные независимые оценки не являются public source of truth;
- одна игра показывает один и тот же профессиональный агрегат во всех блоках сайта;
- собственный обзор Игропоиска не создаёт вторую оценку;
- пользовательский рейтинг — отдельная сущность и скрыт до появления голосов.

## 5.5 Game DNA

**Владеет:** структурированным описанием игровых свойств для анализа и рекомендаций.

DNA использует canonical game facts и может использовать canonical source corpus как evidence. DNA не заменяет factual metadata и не может самостоятельно переписать identity/release facts.

Используется для similarity, рекомендаций, «Во что поиграть?» и объяснимых характеристик игры.

## 5.6 Similarity

**Владеет:** отношениями похожести между canonical `game_id`.

Входы могут включать Game DNA, genre/subgenre, mechanics, structure, tone и другие нормализованные признаки.

Similarity не создаёт игру. Если кандидат не существует в Registry, сначала происходит identity registration.

## 5.7 News

**Владеет:** сбором, нормализацией, дедупликацией, валидацией и публикацией новостей.

Публичные потребители читают News через `features/news/content-api/`, а не напрямую знают физическое расположение JSON/Object Storage. Детальный контракт: [`news-content-api.md`](./news-content-api.md).

Связь с играми:

```text
news parser
  ↓
extract/resolve mentioned games
  ↓
Game Registry
  ↓
canonical game_id links
  ↓
если полной game page ещё нет → enqueue Game Page Assembly
```

News не является частью page module. Он только trigger/consumer canonical game relation. Публичный game link не должен вести на фиктивный placeholder, выдаваемый за готовую страницу.

## 5.8 Releases / Calendar

**Владеет:** обнаружением и проверкой release events, chronological publication и calendar presentation.

Каждый release candidate резолвится через Registry в `game_id`. Если game page отсутствует, Releases может поставить работу в очередь Page Assembly, но не строит свою версию страницы.

## 5.9 Popular Now

**Владеет:** ранжированием текущего интереса по сигналам.

Popular не владеет factual profile игры. Его public card получает canonical URL/cover/title через Registry/public game data. Игра без готовой страницы создаёт trigger на Page Assembly, а не новый page implementation.

## 5.10 Home feeds

**Владеет:** композицией уже проверенных наборов для главной.

Home не становится source of truth. Он агрегирует Popular, Releases, News, Review of the Day и другие published feeds.

## 5.11 Search / Catalog

**Владеет:** поиском и фильтрацией по публичному canonical catalog.

Search не показывает internal draft/collecting records и не создаёт собственные titles/covers. Результат поиска ведёт на canonical published game route.

## 5.12 Top 250

**Владеет:** ранжированным публичным списком canonical games. Использует canonical rating/public data и не хранит альтернативный score той же игры.

## 5.13 «Во что поиграть?» / recommendations

**Владеет:** пользовательским подбором/ранжированием. Использует canonical games + DNA + similarity + public facts и не изменяет underlying GameEntity.

## 5.14 Media subsystem

**Владеет:** acquisition, validation, normalization, checksums, deduplication, storage references и media quality rules. Page Assembly вызывает media subsystem и требует green media gate до публикации.

## 5.15 Design system / page shell

**Владеет:** общими компонентами, typography, surfaces, buttons, cards, layout contract, header и responsive foundation.

Page Assembly использует единый shared game runtime. Отдельные игры не создают собственные mini design systems.

## 5.16 Admin

**Владеет:** операционным представлением states, conflicts, queues, validation failures и editorial controls. Admin не должен напрямую редактировать generated JSON как persistence mechanism.

## 5.17 AI Gateway / AI adapter boundary

**Владеет:** маршрутизацией AI-задач, а не бизнес-данными.

Текущий transitional page pipeline использует `scripts/lib/free-editorial-ai.mjs` как единый локальный adapter к Ollama/Qwen. Domain builders зависят от адаптера, а не от paid vendor API. В целевой серверной архитектуре этот adapter заменяется общим AI Gateway без изменения page-domain contract.

```text
module
  ↓ structured task
AI adapter / future AI Gateway
  ├─ deterministic implementation
  ├─ free/local small model
  └─ future on-demand model if product policy permits
  ↓ structured result
module validation/evidence gate
```

AI никогда не получает права публиковать непроверенные факты напрямую.

---

# 6. Публичные страницы и их источники данных

| Публичная зона | Основной владелец данных | Дополнительные данные | Запрещённая параллельная логика |
|---|---|---|---|
| `/` Главная | Home feeds | News, Popular, Releases, reviews | собственные game identities/scores |
| `/game/<slug>/` | Game Registry + Game Page Assembly | optional Review, DNA, Similarity, News | placeholder pages, independent source corpus |
| `/news/` | News Content API | canonical game links | прямой UI fetch внутренних storage files |
| `/calendar/` | Releases | Registry/public game data | отдельная база названий игр |
| Search | public game projection | Registry aliases/fields | public drafts, alias duplicates |
| Top 250 | ranking module | canonical professional rating/game data | собственная альтернативная оценка |
| «Во что поиграть?» | recommendation layer | DNA, similarity, public games | изменение canonical metadata |

Каждая публичная страница использует общий site shell/header/layout/design system.

---

# 7. Страница игры как интеграционный центр

Публичная game page — projection canonical page package и подключаемых внешних модулей:

```text
                     Game Registry
                          │
                          ▼
                 GAME PAGE ASSEMBLY
       facts / source corpus / rating / media
             / page editorial / page QC
                          │
                          ▼
                PUBLIC GAME PROJECTION
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
     optional Review     Game DNA        News
          │             Similarity       links
          └───────────────┬───────────────┘
                          ▼
                  GAME PAGE RUNTIME
```

Обязательное ядро публикации определяется Page Assembly, а собственный Review Игропоиска подключается как отдельный optional material. Если обязательный page gate не готов, нельзя публиковать фиктивный replacement.

---

# 8. Cross-module triggers

## 8.1 Новость обнаружила игру

```text
News candidate
 → identify mentioned title/external evidence
 → registerCandidate(Game Registry)
 → canonical game_id
 → attach game_id to NewsItem
 → if page not ready: enqueue Game Page Assembly
 → expose public game link only through valid publication contract
```

## 8.2 Release обнаружил игру

```text
Release candidate
 → Registry resolution
 → canonical game_id
 → ReleaseEvent
 → if relevant public page missing: enqueue Game Page Assembly
 → calendar/home projection
```

## 8.3 Popular обнаружил игру

```text
Popularity signals
 → Registry resolution
 → rank canonical game
 → ensure Page Assembly trigger if needed
 → public card uses canonical public game data
```

## 8.4 Game page published/updated

```text
Page finalizer green
 → refresh public catalog/search projection
 → update eligible Top/recommendation inputs
 → resolve News/Release links against public URL
 → invalidate affected caches/feeds
```

## 8.5 Новое professional review evidence

```text
new validated direct professional material
 → update canonical game source corpus
 → professional rating recomputation
 → game page/cards/Top use the same result
 → Reviews subsystem may independently refresh own article
```

## 8.6 Собственный обзор Игропоиска published/updated

```text
review publication green
 → attach/update review reference on canonical game page
 → page source/factual/publication state remains owned by Page Assembly
```

---

# 9. Data ownership rules

1. **Game identity:** только Game Registry.
2. **Game factual page package:** Game Page Assembly.
3. **Canonical external source corpus:** Game Page Assembly, `data/game-sources/<slug>.json`.
4. **Professional rating evidence/aggregate:** calculation over canonical page source corpus.
5. **Page editorial:** Game Page Assembly, `data/page-editorial/<slug>.json`.
6. **Own Игропоиск review article:** Reviews subsystem.
7. **Release facts/events:** Releases + Registry relation.
8. **News body/history:** News subsystem.
9. **Game DNA:** DNA subsystem.
10. **Similarity edges:** similarity subsystem.
11. **Binary media:** media/storage subsystem.
12. **Page layout/components:** central design system + shared game runtime.
13. **Public URL:** Registry/router contract; eligibility to materialize comes from Page Assembly finalizer.
14. **AI output:** никогда не source of truth сам по себе; только candidate/transformation до deterministic validation.

Если два модуля хранят один и тот же факт, один обязан быть canonical owner, второй — projection/cache/reference.

---

# 10. Storage architecture

## 10.1 Structured data

Целевой source of truth — PostgreSQL. Он хранит canonical entities, relations, revisions, provenance, workflow/job state, publication state и audit.

В текущей Git transition architecture JSON artifacts являются versioned projections/contracts. Для Page Assembly наиболее важны draft, source corpus, rating evidence, canonical page editorial, QC и public projection.

## 10.2 Binary/object data

S3-compatible storage хранит media, backups, bounded exports/snapshots и research attachments. Storage provider должен быть заменяем adapter-ом.

## 10.3 История

История сущностей ≠ полная копия всей системы каждый час. После DB cutover история хранится revisions/records, а JSON archives становятся export/recovery layer.

## 10.4 Media retention

Asset удаляется только когда reachability analysis доказывает, что на него не ссылается live/historical content, game/review/media entity или retained rollback/export.

---

# 11. Content API boundary

UI не должен знать, где физически лежит доменный контент.

Целевая форма:

```text
Frontend
   ↓ stable read contract
Content API / domain adapter
   ↓
PostgreSQL / cache / object storage metadata
```

Текущий static game runtime является переходной projection layer. Он не должен превращаться в отдельный source of truth.

---

# 12. Publication model

Любой public content проходит цепочку:

```text
collect
 → normalize
 → resolve canonical identities
 → validate evidence
 → materialize
 → domain quality gate
 → cross-module integrity gate
 → staging/preview
 → production
```

Для Game Page Assembly действует более строгий machine-enforced путь:

```text
draft
 → source corpus complete
 → canonical page editorial green
 → content QC green
 → media QC green
 → overall page QC green
 → sole finalizer
 → publication-state validation
 → shared-runtime smoke
```

Обязательные свойства:

- idempotence;
- fail closed;
- unrelated content не удаляется при partial failure;
- одна сломанная entity/job не блокирует независимую очередь;
- production остаётся на последней green-версии при неуспешной новой ревизии;
- rollback имеет понятную granularity;
- ни AI, ни builder не может сам сделать public write страницы.

---

# 13. Git / environments / deploy

`main` — production source, `staging` — integration/transitional content branch. Правила branch hygiene описаны в [`REPOSITORY_GOVERNANCE.md`](./REPOSITORY_GOVERNANCE.md).

Текущий controlled flow:

```text
feature/change
 → validation
 → staging
 → acceptance where required
 → surgical promotion to main
 → Pages deploy
 → production runtime smoke
```

Для Page Assembly `config/game-page-module.manifest.json` и `validate-game-page-module-integrity.mjs` обязаны проверяться и на staging, и перед production deployment. Ветка не может считаться корректным runtime environment, если обязательный состав модуля неполон.

После server migration контентные hourly обновления больше не требуют Git commit, но сам модульный контракт и fail-closed gates сохраняются.

---

# 14. Failure isolation

Сбой одного слоя не должен каскадно выключать весь сайт.

- News parser failure → старая green news публикация остаётся.
- Free Qwen/Ollama failure → новая page editorial revision остаётся red; последняя green page не заменяется.
- Source discovery incomplete → конкретная game page не финализируется.
- Media enrichment failure → game не публикуется без обязательного media gate, но другие игры продолжаются.
- Один bad release candidate → не останавливает весь Release pipeline.
- Object Storage write failure → текущая production версия остаётся читаемой.
- Потеря обязательного page-module script/workflow/runtime file → module-integrity gate блокирует lifecycle/deploy до обработки игры.
- GitHub outage после server migration → уже запущенный сайт продолжает обслуживать пользователей.

---

# 15. AI architecture

AI — вспомогательный вычислительный слой.

Разрешённые роли:

- entity matching assistance;
- classification/routing;
- extraction candidates;
- page editorial synthesis;
- review synthesis/polish;
- screenshot/media semantic selection;
- DNA assistance;
- similarity feature assistance.

Запрещённые роли:

- единственный источник factual claim;
- обход publish gate;
- самостоятельная смена canonical identity;
- прямой destructive/public write без validation/audit;
- обязательная browser/runtime-зависимость публичной страницы;
- paid API как обязательный Page Assembly dependency при действующей продуктовой политике free AI only.

Текущий Page Assembly использует бесплатный Qwen через локальный Ollama adapter. Целевой порядок внедрения общего AI Gateway находится в M7 roadmap.

---

# 16. Design architecture

Все публичные страницы имеют один site header, один layout width contract, одну центральную design system, общие typography/tokens/components и локальные модули только для composition.

Game Page Assembly использует единый `game/_shared` runtime. Нельзя исправлять конкретную игру добавлением скрытой параллельной реализации shared page runtime.

`features/` — граница функциональных UI-модулей. Strict modules регистрируются в `config/feature-modules.json` и подчиняются `features/MODULE_RULES.md`.

---

# 17. Архитектурные зависимости: разрешено / запрещено

## Разрешено

```text
News → Game Registry → Page Assembly trigger
Releases → Game Registry → Page Assembly trigger
Popular → Game Registry → Page Assembly trigger
Page Assembly → canonical source corpus / Rating / Media
Page Assembly → free AI adapter for page-editorial candidate
Reviews → canonical Game + canonical page source corpus
Game page runtime → optional published Review / DNA / Similarity / News
Home → published module feeds
Search → public Registry/page projection
AI adapter → free/local model provider
Modules → central Design System
Frontend → Content API
Content API → persistence adapters
```

## Запрещено

```text
News → собственная game database или свой page builder
Releases → собственная canonical game identity/page builder
Top 250 → собственный независимый game score
Reviews → второй независимый game source registry
Review article → обязательный technical gate публикации game page
Game page builder → catalog/page shell direct publish
Page AI builder → paid OpenAI dependency или direct public write
Any module → model/vendor call в обход общего AI adapter/gateway boundary
UI → прямые internal Object Storage manifests
AI → publish factual claim without evidence gate
Feature module → собственная design system
Scheduled job → случайные unrelated Git writes
```

---

# 18. Документы-спутники

Этот файл является верхним индексом, но не дублирует все implementation details.

- [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md) — последовательность развития и server migration.
- [`../PROJECT_RULES.md`](../PROJECT_RULES.md) — обязательный public/product contract.
- [`GAME_PAGE_MODULE_STABLE.md`](./GAME_PAGE_MODULE_STABLE.md) — каноническая архитектура Game Page Assembly; исполняемый состав фиксирует `config/game-page-module.manifest.json`.
- [`game-registry-architecture.md`](./game-registry-architecture.md) — Game Registry.
- [`news-pipeline.md`](./news-pipeline.md) — News pipeline.
- [`news-content-api.md`](./news-content-api.md) — News read boundary.
- [`news-shadow-runtime.md`](./news-shadow-runtime.md) — shadow DB/runtime transition.
- [`architecture/phase-b2-news-content-ledger.md`](./architecture/phase-b2-news-content-ledger.md) — PostgreSQL ledger foundation.
- [`home-feeds-pipeline.md`](./home-feeds-pipeline.md) — Popular/Releases home contract.
- [`release-parser-rules.md`](./release-parser-rules.md) — Release parser rules.
- [`release-calendar-editorial.md`](./release-calendar-editorial.md) — Calendar/editorial contract.
- [`design-system-governance.md`](./design-system-governance.md) — design governance.
- [`../features/MODULE_RULES.md`](../features/MODULE_RULES.md) — feature isolation.
- [`REPOSITORY_GOVERNANCE.md`](./REPOSITORY_GOVERNANCE.md) — Git/branch boundaries.

---

# 19. Architecture change protocol

Изменение считается **архитектурным**, если оно создаёт новый source of truth, меняет владельца доменной сущности, меняет связь между крупными модулями, вводит новый обязательный runtime/provider, меняет persistence/storage model, меняет public Content API contract, делает AI обязательным, переносит production runtime или создаёт новую top-level subsystem.

Для такого изменения требуется:

1. обновить этот файл;
2. при изменении порядка этапов обновить `PROJECT_ROADMAP.md`;
3. обновить соответствующий module doc;
4. обновить machine-readable manifest/guard, если модуль имеет исполняемый состав;
5. сохранить migration/rollback path;
6. пройти canonical architecture CI guard.

Обычный bugfix, CSS correction или добавление источника не требует редактировать этот документ, если system boundary не меняется.

---

# 20. Определение готовности фундаментального модуля

Для модулей, которые способны создавать public entities, зелёный unit test не равен архитектурной готовности.

Game Page Assembly считается полностью готовым только если одновременно:

1. manifest содержит полный обязательный состав;
2. module-integrity validator green на фактической integration/production ветке;
3. CI lifecycle и deploy сами вызывают этот validator;
4. builders физически draft-only;
5. source/content/media/editorial/page gates fail closed;
6. finalizer является единственным publish owner;
7. fresh-game acceptance проходит generic chain без game-specific code;
8. итоговая страница проходит реальный shared-runtime browser smoke;
9. production deploy/runtime остаётся green после promotion.

Fresh-game acceptance проверяет работоспособность механизма, но не становится частью business logic конкретной игры.

---

# 21. Непотеряемость архитектуры

Этот документ и `PROJECT_ROADMAP.md` являются **canonical protected project documents**.

Их постоянные пути:

```text
docs/SYSTEM_ARCHITECTURE.md
docs/PROJECT_ROADMAP.md
```

Они регистрируются в `config/canonical-project-docs.json`, видимы из корневого `README.md` и проверяются `scripts/validate-canonical-project-docs.mjs` внутри обязательного Staging and production gate.

Game Page Assembly дополнительно защищён своим module-level документом, machine manifest и `scripts/validate-game-page-module-integrity.mjs`.

Случайное удаление, переименование, превращение в пустую заглушку, потеря canonical marker, удаление обязательного page-module файла или разрыв CI wiring должны блокировать проверку до production.

Намеренное изменение этих документов и module manifest разрешено только как явный versioned Git change, который проходит review/gate и остаётся в истории репозитория.
