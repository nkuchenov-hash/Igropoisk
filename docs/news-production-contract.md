# Production contract: новостной модуль

Этот документ фиксирует обязательные production-инварианты новостей Игропоиска. Эталон текущего стабильного состояния — `docs/NEWS_MODULE_STABLE.md`.

Любое изменение считается регрессией, если оно нарушает хотя бы один из контрактов ниже.

## 1. Автономность

- Канонический workflow: `.github/workflows/news-pipeline.yml`.
- Расписание: каждый час, cron `23 * * * *`.
- Schedule хранится в `main`; production-run использует актуальный `staging`.
- Новостной pipeline не коммитит generated news обратно в GitHub.
- Основная публикация выполняется атомарно в Yandex Object Storage через snapshot + live manifest.
- `cancel-in-progress: false`: активный production-run не отменяется следующим запуском.

## 2. Главный fail-open инвариант

**Никакая внутренняя логическая проверка не имеет права остановить весь здоровый новостной блок.**

Отбор выполняется на уровне отдельного события. Событие может не попасть в публичную выборку, если оно не прошло порог значимости/популярности.

Не блокируют всю ленту:

- ошибка отдельного источника;
- 403/404/429/500 одного endpoint;
- недоступность части official feeds;
- отсутствие/ошибка изображения;
- ошибка хэштега или game-link diagnostics;
- отсутствие готовой страницы игры;
- ошибка записи в page-assembly queue;
- housekeeping/GC;
- optional semantic/AI refinement;
- диагностическая quality/health проверка.

Такие проблемы отражаются в reports/health как warning/degraded и исправляются отдельно.

Если Object Storage физически недоступен, новый snapshot может не переключиться, но live-сайт продолжает использовать последний успешный snapshot. Это operational failure публикации, а не разрешение остановить/обнулить новостной блок.

## 3. Значимость и объём

Количество итоговых новостей не фиксируется.

Основные сигналы значимости:

- число независимых источников;
- авторитетность источников;
- свежесть;
- скорость одновременного распространения;
- обсуждаемость;
- сильный официальный первоисточник.

Cross-source count используется нелинейно с убывающей отдачей. Четыре независимых источника — сильный ориентир широкой значимости, но не обязательный механический минимум.

Крупное официальное объявление может пройти порог до появления нескольких вторичных публикаций.

`12` элементов `data/news-home-ru.json` — текущий UI cap главной, а не редакционная квота pipeline.

## 4. Русская версия

- Русский публичный текст формируется pipeline.
- Основной EN→RU перевод выполняет локальная модель OPUS-MT (`Xenova/opus-mt-en-ru`).
- Удалённые переводчики допустимы как аварийный резерв.
- Ошибки локализации/редактуры конкретного материала не должны останавливать остальные события.
- Source/provenance сохраняется независимо от локализованного текста.

## 5. Игры, хэштеги и page assembly

News и Game Page — разные модули.

- Новость резолвит игру через Game Registry.
- Хэштег подтверждённой игры остаётся кликабельным.
- При готовой странице он ведёт на canonical game URL.
- При отсутствии готовой страницы он ведёт на `game/pending/?slug=...&title=...`.
- `game/pending/` — служебный route «Материал готовится», а не canonical game page и не GameEntity.
- Для игры без готовой страницы сохраняются `pageReady: false` и `assemblyRequired: true`.
- Игра передаётся во временную page-assembly queue в Object Storage.
- Обычный модуль сборки страниц забирает очередь независимо.
- News workflow не запускает fast page builder и не ждёт page assembly.
- Ошибка очереди не блокирует новости.

Отдельный identity regression rule: `Ultimate` само по себе не является признаком `edition`; явная форма `Ultimate Edition` может быть edition.

## 6. Изображения

- Изображение — необязательный ускоряющий кэш.
- По возможности media копируется в Object Storage.
- При ошибке используется фирменная заглушка.
- Media error не блокирует текст новости.
- Media GC выполняется после live publication.

## 7. История, storage и fallback

- Текущий feed публикуется компактным snapshot в Yandex Object Storage.
- Полная история сохраняется через monthly archives.
- Новый run сначала гидратирует существующую live-историю.
- Repository JSON — аварийный fallback, не основной production backend.
- Stale repository fallback не блокирует свежий сетевой сбор или unrelated Pages deploy.

Порядок зафиксирован:

1. collect/process/select;
2. enqueue missing games независимо;
3. publish snapshot + switch live manifest;
4. prune old snapshots/media после публикации.

## 8. Обязательные regression checks

При изменении новостного pipeline должны проходить как минимум:

- `scripts/test-news-pipeline.mjs`;
- `scripts/test-news-fail-open-publication.mjs`;
- `scripts/test-news-fast-path-contract.mjs`;
- `scripts/test-news-pipeline-health.mjs`;
- `scripts/test-news-content-api.mjs`;
- `scripts/test-news-storage-content-api.mjs`;
- storage/retention/media tests;
- game context/linking tests;
- page-assembly queue test;
- hashtag audit как диагностика;
- `scripts/validate-stable-news-module.mjs`;
- production news browser smoke;
- реальный автономный production-run после изменения critical pipeline behavior.

Документация сама по себе не является достаточной защитой: freeze-инварианты должны проверяться CI.

## 9. Production acceptance baseline — 2026-09-03

Автономный run `33735886496` завершился `success` и подтвердил:

- fail-open collection/processing;
- передачу недостающих игр во временное page-assembly storage;
- независимое продолжение news publication;
- неблокирующий hashtag audit;
- успешную публикацию snapshot;
- cleanup только после publication.

Live content version: `20260903T090817Z-5e464685d904-33735886496`.

Production commit `9077734ccdb650c42441e85f236c9decbfa994d5` успешно развернут GitHub Pages. Production news smoke подтвердил `homeStatus=ready`, `archiveStatus=ready`, `contentBackend=object-storage`, отсутствие fallback reason и рабочие card/game-hashtag interactions.

Падение отдельного game-page smoke (Arx/DOOM и т. п.) не является failure новостного модуля, если deploy и news production smoke прошли.

## 10. Freeze / surgical-change rule

Текущий модуль считается READY / STABLE.

Без отдельной прямой задачи на изменение архитектуры запрещено:

- менять orchestration целиком;
- вводить глобальный logical publication blocker;
- возвращать прямое создание game pages из News;
- делать missing game page блокером;
- убирать pending-route semantics;
- вводить фиксированный объём news output;
- перемещать cleanup перед live switch;
- делать repository data основным production backend;
- заводить второй параллельный news pipeline.

Обычные следующие изменения должны быть хирургическими: один источник, одно правило дедупликации, один вес значимости, одна ошибка текста/изображения/linking или одна диагностическая проверка.