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
4. **Модульные документы** — детали News, Releases, Game Registry, review pipeline, design system и других подсистем.

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
     │           GAME CONTENT PIPELINE             │
     │ identity → research → rating → review       │
     │        → media → DNA → similarity           │
     │        → validation → publish               │
     └──────────────────────┬──────────────────────┘
                            ▼
                    CANONICAL PUBLIC DATA
                            │
             ┌──────────────┴──────────────┐
             ▼                             ▼
       CONTENT API / adapters        OBJECT STORAGE
       structured reads              heavy media/files
             │                             │
             └──────────────┬──────────────┘
                            ▼
                       PUBLIC SITE
        Главная / Поиск / Игра / Новости / Календарь
              / Top 250 / Во что поиграть
```

**Главный принцип:** ни один публичный модуль не создаёт собственную параллельную идентичность игры. Игра существует канонически через Game Registry, а страницы и связи строятся вокруг постоянного `game_id`.

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
   parse / materialize / validate / publish
         │
         ├──────────> Yandex Object Storage
         │             news/media/snapshots
         ▼
GitHub Pages
   public static site
```

Это **переходное состояние**, а не конечная архитектура.

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
                    └─ on-demand heavy GPU model
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

## 4.2 NewsItem

Новость имеет собственный ID и хранит:

- source/provenance;
- publication time;
- title/body/summary;
- language/region;
- media references;
- canonical `game_id[]` для связанных игр;
- revision/publication state.

Новостной hashtag/тег игры — это UI-представление связи с `game_id`, а не свободная строка без Registry.

## 4.3 ReleaseEvent

Релиз — событие игры, а не отдельная «игра по названию».

Минимально:

- `game_id`;
- platform;
- region;
- date/date precision;
- release status;
- source/provenance.

Один GameEntity может иметь много ReleaseEvent.

## 4.4 Review / Rating

Обзор Игропоиска и рейтинг относятся к canonical game и имеют source-traced evidence.

**На публичной странице не существует отдельной произвольной оценки игры.** Рейтинг Игропоиска формируется по review/rating contract и используется всеми публичными представлениями одной игры.

## 4.5 MediaAsset

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

**Владеет:** идентичностью игр, aliases, external IDs, lifecycle, relations, conflicts, canonical URL resolution.

**Получает кандидатов от:** News, Releases, Popular, parser/discovery, editorial/manual input.

**Не делает:** не пишет обзор, не рассчитывает рейтинг, не рисует страницу и не парсит все источники сам.

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

## 5.2 Game creation / enrichment pipeline

**Владеет:** превращением identified GameEntity в полностью пригодный к публикации game content package.

Логические стадии:

```text
identified game
 → factual enrichment
 → source dossier
 → rating evidence
 → grounded review
 → media enrichment
 → Game DNA
 → similarity
 → quality validation
 → render/materialize
 → publish gate
```

Стадии должны оставаться отдельными и повторяемыми. Падение одной игры не блокирует обработку остальных.

## 5.3 Reviews

**Владеет:** professional evidence, review synthesis, editorial quality contract.

Default коммерческий путь не зависит от LLM:

```text
professional sourced evidence
 → deterministic grounded review
 → deterministic quality gates
 → publishable review
```

AI full-upgrade — опциональное улучшение, а не обязательное условие существования игры.

## 5.4 Ratings

**Владеет:** единым рейтингом Игропоиска.

Инварианты:

- rating связан с review evidence;
- legacy/случайные независимые оценки не являются публичным source of truth;
- одна игра показывает один и тот же рейтинг во всех блоках сайта;
- пользовательский рейтинг — отдельная сущность и скрыт до появления голосов.

## 5.5 Game DNA

**Владеет:** структурированным описанием игровых свойств для анализа и рекомендаций.

DNA не заменяет factual game metadata и не может самостоятельно переписать identity/release facts.

Используется для:

- similarity;
- рекомендаций;
- «Во что поиграть?»;
- объяснимых характеристик игры.

## 5.6 Similarity

**Владеет:** отношениями похожести между canonical `game_id`.

Входы могут включать Game DNA, genre/subgenre, mechanics, structure, tone и другие нормализованные признаки.

Similarity не создаёт игру. Если кандидат ссылки не существует в Registry, сначала происходит identity registration.

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
если полной game page ещё нет → enqueue game creation
```

Публичный game link не должен вести на placeholder. До прохождения game publish gate кандидат остаётся внутренним.

## 5.8 Releases / Calendar

**Владеет:** обнаружением и проверкой release events, chronological publication и calendar presentation.

Каждый release candidate должен резолвиться через Registry в `game_id`.

Календарь — представление ReleaseEvent, а не отдельная база игр.

## 5.9 Popular Now

**Владеет:** ранжированием текущего интереса по сигналам.

Popular не владеет factual profile игры. Его public card получает canonical URL/cover/title через Registry/public game data.

Если Popular обнаруживает игру без готовой страницы, это trigger на создание/обогащение, а не разрешение показать пустую страницу.

## 5.10 Home feeds

**Владеет:** композицией уже проверенных наборов для главной.

Home не должен становиться новым source of truth. Он агрегирует:

- Popular;
- Releases;
- News;
- Review of the Day / editorial slots;
- другие публичные feeds.

Публикационный контракт Popular/Releases описан в [`home-feeds-pipeline.md`](./home-feeds-pipeline.md).

## 5.11 Search / Catalog

**Владеет:** поиском и фильтрацией по публичному canonical catalog.

Search не показывает internal draft/collecting records и не создаёт собственные titles/covers. Результат поиска всегда должен вести на canonical published game route.

Поиск использует Registry/public projection, а не набор разрозненных aliases как независимые карточки.

## 5.12 Top 250

**Владеет:** ранжированным публичным списком уже существующих canonical games.

Top 250 не хранит отдельную game identity и не может иметь свой собственный score для той же игры. Он использует canonical rating/public data.

## 5.13 «Во что поиграть?» / recommendations

**Владеет:** пользовательским подбором/ранжированием по критериям.

Использует canonical games + DNA + similarity + публичные facts. Не изменяет underlying GameEntity.

## 5.14 Media subsystem

**Владеет:** acquisition, validation, normalization, checksums, deduplication, storage references и media quality gates.

Другие модули запрашивают media, но не должны каждый реализовывать собственное долговременное binary storage.

## 5.15 Design system / page shell

**Владеет:** общими компонентами, typography, surfaces, buttons, cards, layout contract, header и responsive foundation.

Модули владеют композицией своего контента, но не создают собственные мини-дизайн-системы. Детальные правила — `PROJECT_RULES.md`, `DESIGN_SYSTEM.md`, `features/MODULE_RULES.md`.

## 5.16 Admin

**Владеет:** операционным представлением состояний, conflicts, queues, validation failures и editorial controls.

Admin не должен напрямую редактировать generated JSON как способ persistence. Целевой write-path — Content API/PostgreSQL с audit trail.

## 5.17 AI Gateway

**Владеет:** маршрутизацией AI-задач, а не бизнес-данными.

Ни один domain module не должен жёстко зависеть от `qwen3:*`, Ollama URL или конкретного vendor API.

```text
module
  ↓ structured task
AI Gateway
  ├─ deterministic implementation
  ├─ small local model
  └─ strong on-demand model
  ↓ structured result
module validation/evidence gate
```

AI не получает права публиковать непроверенные факты напрямую.

---

# 6. Публичные страницы и их источники данных

| Публичная зона | Основной владелец данных | Дополнительные данные | Запрещённая параллельная логика |
|---|---|---|---|
| `/` Главная | Home feeds | News, Popular, Releases, reviews | собственные game identities/scores |
| `/game/<slug>/` | Game Registry + game content | Review, Rating, DNA, Media, News | placeholder pages, independent score |
| `/news/` | News Content API | canonical game links | прямой UI fetch внутренних storage files |
| `/calendar/` | Releases | Registry/public game data | отдельная база названий игр |
| Search | public game projection | Registry aliases/fields | public drafts, alias duplicates |
| Top 250 | ranking module | canonical rating/game data | собственная альтернативная оценка |
| «Во что поиграть?» | recommendation layer | DNA, similarity, public games | изменение canonical metadata |

Каждая публичная страница использует общий site shell/header/layout/design system.

---

# 7. Страница игры как интеграционный центр

Публичная game page не является самостоятельным источником данных. Это projection нескольких canonical подсистем:

```text
                    Game Registry
                         │
       ┌─────────────────┼───────────────────┐
       ▼                 ▼                   ▼
 factual fields       Review/Rating         Media
       │                 │                   │
       ├─────────────────┼───────────────────┤
       ▼                 ▼                   ▼
   Game DNA          Similarity             News
       └─────────────────┬───────────────────┘
                         ▼
                  GAME PAGE RENDERER
                         ▼
                     publish gate
```

Если обязательный блок не готов, нельзя публиковать фиктивный replacement. `PROJECT_RULES.md` определяет минимальный publish gate.

---

# 8. Cross-module triggers

## 8.1 Новость обнаружила игру

```text
News candidate
 → identify mentioned title/external evidence
 → registerCandidate(Game Registry)
 → canonical game_id
 → attach game_id to NewsItem
 → if game not ready/published: enqueue creation/enrichment
 → publish News only with valid public linking behavior
```

## 8.2 Release обнаружил игру

```text
Release candidate
 → Registry resolution
 → canonical game_id
 → ReleaseEvent
 → if relevant public game missing: enqueue game pipeline
 → calendar/home projection
```

## 8.3 Popular обнаружил игру

```text
Popularity signals
 → Registry resolution
 → rank canonical game
 → ensure page creation trigger if needed
 → public card only when link/cover/public contract valid
```

## 8.4 Game published/updated

```text
Game publish
 → refresh public catalog/search projection
 → update eligible Top/recommendation inputs
 → resolve News/Release links against public URL
 → invalidate affected caches/feeds
```

## 8.5 Review/rating changed

```text
new validated professional evidence
 → review/rating recomputation
 → canonical score update
 → game page + cards + Top use same result
```

---

# 9. Data ownership rules

1. **Game identity:** только Game Registry.
2. **Release facts/events:** Releases + Registry relation.
3. **News body/history:** News subsystem.
4. **Canonical review/rating:** review/rating subsystem.
5. **Game DNA:** DNA subsystem.
6. **Similarity edges:** similarity subsystem.
7. **Binary media:** media/storage subsystem.
8. **Page layout/components:** central design system + page composition.
9. **Public URL:** Registry/router contract.
10. **AI output:** никогда не source of truth сам по себе; только candidate/transformation до deterministic validation.

Если два модуля хранят один и тот же факт, один обязан быть canonical owner, второй — projection/cache/reference.

---

# 10. Storage architecture

## 10.1 Structured data

Целевой source of truth — PostgreSQL.

Хранит:

- canonical entities;
- relations;
- revisions;
- provenance;
- workflow/job state;
- publication state;
- audit.

## 10.2 Binary/object data

S3-compatible storage хранит:

- media;
- backups;
- bounded exports/snapshots;
- research attachments, если нужны.

Storage provider должен быть заменяем adapter-ом. Yandex Object Storage — текущая реализация части этого слоя, а не архитектурная зависимость бренда Яндекс.

## 10.3 История

История сущностей ≠ полная копия всей системы каждый час.

До DB cutover News использует bounded live + monthly archive transition model. После DB cutover история хранится revisions/records, а JSON archives становятся export/recovery layer.

## 10.4 Media retention

Asset удаляется только когда reachability analysis доказывает, что на него не ссылается:

- live content;
- historical content;
- game/review/media entity;
- retained rollback/export.

Возраст сам по себе не является причиной удаления исторически используемого media.

---

# 11. Content API boundary

UI не должен знать, где физически лежит доменный контент.

Текущий News уже реализует эту идею через `features/news/content-api/`.

Целевая форма для всего проекта:

```text
Frontend
   ↓ stable read contract
Content API / domain adapter
   ↓
PostgreSQL / cache / object storage metadata
```

Это позволяет заменить Git JSON → PostgreSQL или Yandex → другой S3 без переписывания страниц.

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

## Обязательные свойства

- idempotence;
- fail closed;
- unrelated content не удаляется при partial failure;
- одна сломанная entity/job не блокирует независимую очередь;
- production остаётся на последней green-версии при неуспешной новой публикации;
- rollback должен иметь понятную granularity.

---

# 13. Git / environments / deploy

## Сейчас

`main` — production source, `staging` — integration/transitional content branch. Правила branch hygiene описаны в [`REPOSITORY_GOVERNANCE.md`](./REPOSITORY_GOVERNANCE.md).

Текущий controlled flow:

```text
feature/change
 → validation
 → staging or surgical production PR
 → main
 → Pages deploy
```

## После server migration

```text
feature/change
 → PR
 → CI/tests
 → deploy artifact/image
 → server staging
 → production rollout
```

Контентное hourly обновление больше не требует Git commit.

---

# 14. Failure isolation

Сбой одного слоя не должен каскадно выключать весь сайт.

- News parser failure → старая green news публикация остаётся.
- Ollama/GPU failure → базовый deterministic publish path продолжает работать.
- Media enrichment failure → game не публикуется без обязательной media, но другие игры продолжаются.
- Один bad release candidate → не останавливает весь Release pipeline.
- Object Storage write failure → текущая production версия остаётся читаемой.
- GitHub outage после server migration → уже запущенный сайт продолжает обслуживать пользователей.

---

# 15. AI architecture

AI — вспомогательный вычислительный слой.

## Разрешённые роли

- entity matching assistance;
- classification/routing;
- extraction candidates;
- editorial synthesis;
- review polish;
- screenshot/media semantic selection;
- DNA assistance;
- similarity feature assistance.

## Запрещённые роли

- единственный источник factual claim;
- обход publish gate;
- самостоятельная смена canonical identity;
- прямое destructive write без validation/audit;
- обязательная runtime-зависимость публичной страницы.

Подробный порядок внедрения AI Gateway находится в M7 roadmap.

---

# 16. Design architecture

Все публичные страницы имеют:

- один site header;
- один layout width contract;
- одну центральную design system;
- общие typography/tokens/components;
- локальные модули только для composition.

`features/` — граница функциональных UI-модулей. Strict modules регистрируются в `config/feature-modules.json` и подчиняются `features/MODULE_RULES.md`.

Новый функциональный модуль сначала получает:

```text
features/<module>/module.json
features/<module>/RULES.md
registration in config/feature-modules.json
```

и только затем получает runtime/UI code.

---

# 17. Архитектурные зависимости: разрешено / запрещено

## Разрешено

```text
News → Game Registry
Releases → Game Registry
Popular → Game Registry
Game page → Review/Rating/Media/DNA/Similarity
Home → published module feeds
Search → public Registry projection
AI Gateway → model providers
Modules → central Design System
Frontend → Content API
Content API → persistence adapters
```

## Запрещено

```text
News → собственная game database
Releases → собственная canonical game identity
Top 250 → собственный независимый game score
Game page → hardcoded news JSON backend
UI → прямые internal Object Storage manifests
Any module → direct Ollama-specific dependency
AI → publish factual claim without evidence gate
Feature module → собственная design system
Scheduled job → случайные unrelated Git writes
```

---

# 18. Документы-спутники

Этот файл является верхним индексом, но не дублирует все implementation details.

- [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md) — последовательность развития и server migration.
- [`../PROJECT_RULES.md`](../PROJECT_RULES.md) — обязательный public/product contract.
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

Изменение считается **архитектурным**, если оно:

- создаёт новый source of truth;
- меняет владельца доменной сущности;
- меняет связь между двумя крупными модулями;
- вводит новый обязательный runtime/provider;
- меняет persistence/storage model;
- меняет public Content API contract;
- делает AI обязательным;
- переносит production runtime;
- создаёт новую top-level product subsystem.

Для такого изменения требуется:

1. обновить этот файл;
2. при изменении порядка этапов обновить `PROJECT_ROADMAP.md`;
3. обновить соответствующий module doc;
4. сохранить migration/rollback path;
5. пройти canonical architecture CI guard.

Обычный bugfix, CSS correction или добавление источника не требует редактировать этот документ, если system boundary не меняется.

---

# 20. Непотеряемость архитектуры

Этот документ и `PROJECT_ROADMAP.md` являются **canonical protected project documents**.

Их постоянные пути:

```text
docs/SYSTEM_ARCHITECTURE.md
docs/PROJECT_ROADMAP.md
```

Они регистрируются в `config/canonical-project-docs.json`, видимы из корневого `README.md` и проверяются `scripts/validate-canonical-project-docs.mjs` внутри обязательного Staging and production gate.

Случайное удаление, переименование, превращение в пустую заглушку, потеря canonical marker или удаление ссылки из README должно блокировать CI.

Намеренное изменение этих документов разрешено — но только как явный versioned Git change, который проходит review/gate и остаётся в истории репозитория.
