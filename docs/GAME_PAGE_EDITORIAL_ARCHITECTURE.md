# Игропоиск — архитектура редакционного слоя страницы игры

**Статус:** CANONICAL v1  
**Зафиксировано:** 2026-09-04

## Главный принцип

У игры существует один канонический identity/source layer и четыре независимые редакционные задачи:

1. Subtitle.
2. Description.
3. Features.
4. Full Review.

Первые три являются контентными блоками Game Page Module. Full Review принадлежит отдельному Review Module и только подключается к странице после собственной публикации.

## Архитектура

```text
Game Registry / game_id
        │
        ▼
Game Page source assembly
        │
        ├─ data/game-sources/<slug>.json
        └─ data/game-source-content/<slug>.json
        │
        ▼
Canonical Evidence Package + SHA-256
        │
        ├──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
 Subtitle Skill   Description Skill  Features Skill   Review Skill
 approved model   approved model     approved model   approved review model
        │              │              │              │
        ▼              ▼              ▼              ▼
 subtitle.json    description.json   features.json   article/review artifact
        │              │              │              │
        └──────────────┴──────┬───────┘              │
                              ▼                      │
                     Page Editorial Bundle           │
                              │                      │
                    page-content QC / publish         │
                              │                      │
                              ▼                      │
                         Game Page  ◄─────────────────┘
                                    optional linked review
```

## 1. Canonical Evidence Package

Перед любой редакционной генерацией собирается один неизменяемый пакет доказательств конкретной ревизии игры.

Он содержит:

- canonical `game_id`, title, year and version markers;
- explicit excluded/remake/remaster/sequel identities;
- полный список источников и provenance;
- весь readable-текст, сохранённый source collector;
- подтверждённые структурированные facts;
- доступные professional scores и publication metadata;
- media/source metadata, если они нужны конкретному skill;
- source revision / content hashes.

Пакет получает SHA-256. Каждый редакционный артефакт сохраняет этот hash.

Нельзя сравнивать модели или смешивать outputs, созданные из разных evidence hashes, как будто они относятся к одной ревизии.

## 2. Полное покрытие корпуса без benchmark-truncation

Запрещено обрезать benchmark до первых N источников или первых N символов каждого источника.

Если пакет помещается в context window — skill получает его целиком.

Если не помещается:

1. корпус детерминированно разбивается на source-aware chunks;
2. **та же модель, которая выполняет skill**, проходит все chunks и извлекает task-specific evidence;
3. фиксируется coverage map: какие source/chunk IDs реально обработаны;
4. финальный текст создаётся этой же моделью только после 100% coverage readable-корпуса;
5. другая модель не используется как скрытый summarizer/extractor.

Так мы не создаём общий AI-summary, ошибка которого автоматически заражает Subtitle, Description, Features и Review.

## 3. Три независимых page-skills

Subtitle, Description и Features запускаются параллельно после freeze evidence package.

Каждый skill имеет:

- собственный prompt/contract version;
- собственную approved model;
- собственный QC;
- собственные retries той же моделью;
- output с `game_id`, `evidence_hash`, `model_id`, `skill_version` и timestamp.

Один комбинированный prompt `сделай subtitle + description + features` не является production-архитектурой.

## 4. Page Editorial Bundle

Три принятых артефакта собираются в один page editorial bundle только если:

- у них один `game_id`;
- у них один `evidence_hash`;
- каждый прошёл свой skill-QC;
- отсутствует cross-version contamination;
- отсутствует source/process leakage.

Для **новой** страницы bundle является частью editorial publish gate: публично не выпускается случайный полуготовый набор, где один блок старый, второй новый, третий отсутствует.

Для **уже опубликованной** страницы неудачная регенерация не стирает рабочий текст: продолжает использоваться последняя полностью утверждённая версия bundle до успешной новой ревизии.

## 5. Review Module — отдельная ветка

Review Skill получает тот же canonical evidence package, но живёт независимо.

Правила:

- обзор не блокирует страницу игры;
- review-model не обязан совпадать ни с одной page-model;
- один review assignment выполняется одной моделью end-to-end;
- та же модель делает evidence pass, structure, sections и final polish;
- cross-model fallback запрещён;
- опубликованный review хранит `game_id` и `evidence_hash`;
- Game Page показывает review только после собственного review publication gate.

Если обзор не готов, сама страница остаётся полноценной и показывает внешние источники из Game Page Module.

## 6. Что генерируется AI, а что нет

AI не должен владеть identity или фактами.

**Детерминированно / source-driven:**

- game identity;
- source discovery/storage;
- version filtering rules;
- structured factual fields;
- media metadata;
- ratings evidence;
- hashes/provenance;
- bundle consistency checks;
- page rendering.

**Моделью:**

- Subtitle;
- Description;
- Features;
- Full Review.

Модель не вызывается в browser/request path. Пользователь всегда получает уже материализованный проверенный контент.

## 7. Failure policy

- Technical failure → retry той же approved model.
- Никакой тихой подмены другой моделью.
- Hard factual/QC failure → output отклоняется и передаётся на same-model regeneration.
- Review failure не влияет на Game Page publication.
- Page editorial regeneration failure не ломает уже опубликованную страницу: остаётся previous approved bundle.

## 8. Обновление источников

Новая source revision создаёт новый evidence hash.

После этого page-skills могут пересобраться параллельно. Публикация новой текстовой ревизии происходит атомарно после прохождения всех трёх page-skills.

Review не обязан автоматически переписываться при каждом добавленном источнике. Review regeneration — отдельное редакционное событие; существующий опубликованный обзор остаётся валидной публикацией с собственным evidence hash, пока нет причины его заменить.

## 9. Итоговая production-цепочка

```text
identify game
→ collect facts + all sources + source texts + media
→ validate exact identity/version
→ freeze Evidence Package
→ [Subtitle || Description || Features] in parallel
→ validate each skill
→ atomically publish Page Editorial Bundle
→ render/publish Game Page

in parallel / later:
Evidence Package
→ Review Skill
→ review QC
→ publish Review
→ Game Page automatically links published Review
```

Эта схема сохраняет скорость страницы, не делает review техническим блокером и позволяет выбирать лучшую модель отдельно для каждой редакционной задачи.
