# Игропоиск — архитектура редакционного слоя страницы игры

**Статус:** CANONICAL v2  
**Зафиксировано:** 2026-09-07

## Главный принцип

**Одна готовая страница игры не смешивает тексты разных моделей.**

Для конкретной игры и конкретной source revision перед началом редакционной сборки назначается один `editorial_model_id`. Эта модель ведёт редакционную часть страницы до готового состояния.

Subtitle, Description, Features и Review остаются разными skills с разными правилами качества, но **skill не выбирает себе отдельную модель**.

Разные страницы игр могут собираться разными моделями.

Пример допустимой production-схемы:

```text
Mafia       → Model A → Subtitle + Description + Features + Review
Spore       → Model B → Subtitle + Description + Features + Review
Far Cry     → Model C → Subtitle + Description + Features + Review
Obscure Game→ Model D → Subtitle + Description + Features
```

Недопустимо:

```text
Mafia Subtitle    → Model A
Mafia Description → Model B
Mafia Features    → Model C
Mafia Review      → Model D
```

## Архитектура

```text
Game Registry / game_id
        │
        ▼
Existing Game Page source assembly
 scripts/collect-game-sources.mjs
        │
        ├─ data/game-sources/<slug>.json
        └─ full-text materialization
           → data/game-source-content/<slug>.json
        │
        ▼
Canonical Evidence Package + SHA-256
        │
        ▼
ASSIGN ONE editorial_model_id FOR THIS GAME BUILD
        │
        ▼
Single-model Game Editorial Job
        │
        ├─ Subtitle Skill    ─┐
        ├─ Description Skill ├─ same model_id
        ├─ Features Skill    ┘
        │
        ▼
Page Editorial Bundle
        │
        ▼
page-content QC / publish
        │
        ▼
Game Page
        │
        └──────────────► Review Module when required
                          │
                          └─ same editorial_model_id
```

## 0. Не создаём второй source pipeline

Канонический список источников уже собирает существующий Game Page pipeline:

- `scripts/collect-game-sources.mjs`;
- при необходимости он использует `scripts/discover-game-sources-web.mjs`;
- также использует `scripts/discover-game-publication-hubs.mjs`;
- итоговый registry сохраняется в `data/game-sources/<slug>.json`.

Subtitle/Description/Features skills и Review Skill не выполняют отдельный discovery. Они получают только результаты этого канонического слоя.

Отдельный обязательный этап — **full-text materialization**: для каждого принятого источника сохраняется весь реально доступный readable-текст в `data/game-source-content/<slug>.json` вместе с provenance/coverage. Это продолжение существующего source assembly, а не второй сборщик источников.

## 1. Canonical Evidence Package

Перед любой редакционной генерацией собирается один неизменяемый пакет доказательств конкретной ревизии игры.

Он содержит:

- canonical `game_id`, title, year and version markers;
- explicit excluded/remake/remaster/sequel identities;
- полный список источников и provenance;
- весь readable-текст, сохранённый full-text materializer;
- подтверждённые структурированные facts;
- доступные professional scores и publication metadata;
- media/source metadata;
- source revision / content hashes.

Пакет получает SHA-256.

Все модельные артефакты одной готовой страницы должны иметь одновременно:

- один `game_id`;
- один `evidence_hash`;
- один `editorial_model_id`.

## 2. Model affinity — модель назначается странице, а не skill

Перед началом редакционной сборки создаётся `Game Editorial Job`.

Минимальный контракт job:

```text
job_id
game_id
evidence_hash
editorial_model_id
status
attempt
```

После назначения `editorial_model_id` нельзя менять модель внутри этого job.

Эта же модель выполняет:

1. evidence reading / extraction;
2. Subtitle Skill;
3. Description Skill;
4. Features Skill;
5. исправления этих блоков после QC;
6. Review Skill, если для этой игры создаётся обзор.

Skills остаются отдельными контрактами, потому что у них разные форматы и критерии качества. Но они являются стадиями **одного single-model job**.

## 3. Полное покрытие корпуса

Запрещено обрезать корпус до первых N источников или первых N символов.

Если Evidence Package помещается в context window — назначенная модель получает его целиком.

Если не помещается:

1. корпус детерминированно разбивается на source-aware chunks;
2. назначенная этой странице модель проходит все chunks;
3. фиксируется coverage map;
4. эта же модель создаёт task-specific evidence notes;
5. эта же модель выполняет все редакционные skills страницы.

Нельзя использовать одну модель как summarizer, а затем другую как автора страницы.

## 4. Page Editorial Bundle

Subtitle, Description и Features собираются в единый bundle только если:

- `game_id` одинаков;
- `evidence_hash` одинаков;
- `editorial_model_id` одинаков;
- каждый skill прошёл собственный QC;
- отсутствует cross-version contamination;
- отсутствует source/process leakage.

Для новой страницы bundle является частью publish gate.

Для уже опубликованной страницы неудачная новая сборка не стирает старый рабочий bundle: остаётся последняя полностью утверждённая версия.

## 5. Что происходит, если назначенная модель не справилась

Сначала выполняются same-model retries и same-model corrections.

**Нельзя:**

- оставить Subtitle от Model A;
- после ошибки переключиться на Model B;
- закончить Description/Features Model B;
- опубликовать смешанный bundle.

Если Model A окончательно не способна закончить новый job:

1. весь незавершённый модельный результат этого job отклоняется;
2. создаётся новый job на том же Evidence Package;
3. новому job можно назначить Model B;
4. Model B пересобирает **все модельные блоки страницы с нуля**.

Таким образом модель можно поменять между попытками сборки страницы, но нельзя смешивать модели внутри одной готовой страницы.

## 6. Review Module остаётся отдельным модулем

Архитектурная независимость Review Module сохраняется:

- обзор не является частью Game Page Module;
- отсутствие обзора не блокирует публикацию страницы;
- Review имеет собственный workflow и publication gate;
- Game Page только подключает опубликованный Review.

Но для конкретной игры Review наследует `editorial_model_id` страницы.

Если обзор создаётся позже, его делает та же модель, которая владеет текущим Page Editorial Bundle этой игры.

Если эта модель не может пройти Review Skill, обзор остаётся pending. Если принято решение сменить модель ради обзора, нельзя просто написать обзор другой моделью поверх старой страницы: создаётся новая full-editorial revision, где новая модель пересобирает Subtitle + Description + Features и затем Review.

Это сохраняет правило **одна модель — одна редакционная версия страницы игры**.

## 7. Страницы с обзором и без обзора

Есть два допустимых типа назначения:

### Page-only assignment

Для игры, где обзор не требуется сейчас:

```text
Model X
→ Subtitle
→ Description
→ Features
→ publish page
```

### Full-editorial assignment

Для игры, где нужен обзор:

```text
Model Y
→ Subtitle
→ Description
→ Features
→ publish page without waiting for review if needed
→ Review Skill
→ Review QC
→ attach published review
```

Во втором случае модель та же самая на всех стадиях.

## 8. Разные модели для разных игр

Production не обязан использовать одну универсальную модель для всего Игропоиска.

Допустима утверждённая группа моделей, каждая из которых доказала способность собирать страницу целиком.

Orchestrator выбирает модель **один раз перед стартом конкретного Game Editorial Job** с учётом:

- качества модели по end-to-end benchmark;
- способности обработать Evidence Package нужного размера;
- необходимости Review;
- текущей доступности/квоты;
- стоимости и latency как вторичных факторов.

После выбора model affinity фиксируется до завершения или полного отказа от job.

## 9. Что генерируется AI, а что нет

**Детерминированно / source-driven:**

- game identity;
- source discovery/storage;
- full-text materialization;
- version filtering rules;
- structured factual fields;
- media metadata;
- ratings evidence;
- hashes/provenance;
- model assignment record;
- bundle consistency checks;
- page rendering.

**Одной назначенной моделью для конкретной страницы:**

- evidence extraction;
- Subtitle;
- Description;
- Features;
- Full Review, если он требуется.

Модель не вызывается в browser/request path. Пользователь получает уже материализованный проверенный контент.

## 10. Обновление источников

Новая source revision создаёт новый evidence hash и новую редакционную revision.

Для новой revision модель назначается заново. Она может совпадать с предыдущей или быть другой.

Но новая revision снова должна быть single-model целиком.

## 11. Итоговая production-цепочка

```text
identify game
→ existing collect-game-sources pipeline
→ materialize complete readable source texts
→ validate exact identity/version
→ freeze Evidence Package
→ choose ONE editorial_model_id for this game revision
→ same model: evidence pass
→ same model: Subtitle Skill
→ same model: Description Skill
→ same model: Features Skill
→ validate all three
→ atomically publish Page Editorial Bundle
→ render/publish Game Page
→ if Review required: same model → Review Skill → Review QC → publish/attach Review
```

Главная единица production — **готовая страница игры**, а не отдельный текстовый skill.
