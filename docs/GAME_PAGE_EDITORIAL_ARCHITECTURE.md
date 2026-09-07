# Игропоиск — архитектура редакционного слоя страницы игры

**Статус:** CANONICAL v3  
**Зафиксировано:** 2026-09-07

## Главный принцип

Игропоиск использует **два независимых модельных контура**:

1. **Page Editorial Job** — одна модель собирает Subtitle + Description + Features конкретной страницы.
2. **Review Editorial Job** — отдельно назначенная модель создаёт полный обзор этой игры.

Page Model и Review Model могут совпасть, но это не требуется и не предполагается заранее.

Разные страницы игр также могут собираться разными Page Models.

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
        ├──────────────────────────────────┐
        │                                  │
        ▼                                  ▼
PAGE EDITORIAL JOB                    REVIEW EDITORIAL JOB
assign one page_model_id              assign one review_model_id
        │                                  │
        ├─ Subtitle Skill                   ├─ evidence pass
        ├─ Description Skill               ├─ structure
        └─ Features Skill                  ├─ full review
        │                                  └─ Review QC
        ▼                                  │
Page Editorial Bundle                     ▼
        │                              Published Review
        ▼                                  │
Game Page  ◄───────────────────────────────┘
```

## 0. Один source pipeline

Оба контура используют один и тот же канонический evidence layer Game Page Module:

- `scripts/collect-game-sources.mjs`;
- `scripts/discover-game-sources-web.mjs` при необходимости;
- `scripts/discover-game-publication-hubs.mjs`;
- `data/game-sources/<slug>.json`;
- `data/game-source-content/<slug>.json`.

Ни Page skills, ни Review Skill не выполняют собственный независимый discovery.

Для каждого принятого источника сохраняется весь реально доступный readable-текст. Benchmark-only truncation до первых N источников или первых N символов запрещён.

## 1. Canonical Evidence Package

Перед модельной работой фиксируется неизменяемый Evidence Package конкретной версии игры. Он содержит:

- `game_id`, title, year и version markers;
- исключённые ремейки/ремастеры/сиквелы;
- полный список источников и provenance;
- весь сохранённый readable-текст;
- подтверждённые structured facts;
- professional scores/publication metadata;
- media/source metadata;
- hashes/coverage.

Пакет получает SHA-256. Page Test и Review Test для одной benchmark-игры должны использовать одну зафиксированную evidence revision.

## 2. Page Editorial Job: одна модель на страницу

Перед созданием трёх текстовых блоков страницы назначается один `page_model_id`.

Минимальный job contract:

```text
page_job_id
game_id
evidence_hash
page_model_id
status
attempt
```

Эта модель выполняет:

1. evidence reading/extraction для page-copy;
2. Subtitle Skill;
3. Description Skill;
4. Features Skill;
5. исправления этих трёх блоков после QC.

Нельзя сделать Subtitle одной моделью, Description второй, Features третьей.

Если назначенная модель окончательно не справилась, её незавершённый Page Editorial Job отклоняется целиком. Другая Page Model может начать новый job с нуля на том же Evidence Package.

Разные игры могут использовать разные Page Models.

## 3. Review Editorial Job: независимая модель

Review Module остаётся отдельным модулем и имеет собственное назначение модели.

Минимальный job contract:

```text
review_job_id
game_id
evidence_hash
review_model_id
status
attempt
```

Одна Review Model выполняет обзор end-to-end:

1. полное evidence coverage;
2. evidence extraction;
3. editorial angle/structure;
4. section writing;
5. synthesis/polish;
6. evergreen/anti-generic audit;
7. Review QC.

`review_model_id` **не обязан совпадать** с `page_model_id`.

Например, полностью допустимо:

```text
Mafia Page   → Model A → Subtitle + Description + Features
Mafia Review → Model D → Full Review

Spore Page   → Model B → Subtitle + Description + Features
Spore Review → Model D → Full Review
```

Обзор другой модели не требует пересобирать Page Editorial Bundle.

## 4. Review не блокирует страницу

Game Page publication и Review publication независимы.

После успешного Page Editorial Job страница может быть опубликована сразу. Если Review ещё не готов, страница остаётся полноценной без него.

Когда Review Editorial Job проходит свой publication gate, опубликованный обзор автоматически подключается к странице.

Неудача Review Model не делает Game Page pending и не стирает готовую страницу.

## 5. Полное покрытие корпуса

Если Evidence Package помещается в context window, назначенная модель получает его целиком.

Если не помещается, корпус детерминированно делится на source-aware chunks. Внутри конкретного job все chunks и финальный текст обрабатывает одна и та же назначенная этому job модель.

Запрещено использовать скрытую стороннюю модель как summarizer перед Page Model или Review Model.

## 6. Page Editorial Bundle

Subtitle, Description и Features публикуются как единый bundle только если:

- одинаков `game_id`;
- одинаков `evidence_hash`;
- одинаков `page_model_id`;
- все три skills прошли собственный QC;
- нет cross-version contamination;
- нет source/process leakage.

Для уже опубликованной страницы неудачная новая регенерация не стирает последний утверждённый bundle.

## 7. Независимые model benchmarks

Выбор моделей выполняется отдельно:

### Page Model Test

Проверяет, способна ли одна модель стабильно собрать **все три page-блока** одной игры. Это более лёгкая задача, поэтому квалификационный порог может пройти больше моделей.

### Review Model Test

Проверяет длинный журнальный обзор по отдельному Review Skill. Результаты Page Test не определяют победителя Review Test и наоборот.

Page Model pool и Review Model pool являются независимыми production-пулами.

## 8. Что делает AI

**Детерминированно / source-driven:** identity, source discovery/storage, full-text materialization, version filtering, facts, media, ratings, hashes/provenance, job records, validation и rendering.

**Page Model:** Subtitle + Description + Features одной страницы.

**Review Model:** полный Review отдельным job.

Никакая модель не вызывается в browser/request path.

## 9. Production-цепочка

```text
identify game
→ collect sources/facts/media
→ materialize all readable source text
→ validate exact identity/version
→ freeze Evidence Package

PAGE PATH:
→ choose one page_model_id
→ same model: Subtitle + Description + Features
→ Page QC
→ atomically publish Page Editorial Bundle
→ render/publish Game Page

REVIEW PATH, independently:
→ choose one review_model_id
→ same model: full Review workflow
→ Review QC
→ publish Review
→ attach Review to existing Game Page
```

Итоговое правило: **внутри одной страницы не смешиваем модели между Subtitle/Description/Features, но Page Model и Review Model выбираются независимо.**
