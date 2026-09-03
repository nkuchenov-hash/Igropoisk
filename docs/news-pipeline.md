# Автономный новостной pipeline

## Статус

**READY / STABLE с 2026-09-03.** Полный freeze-контракт: `docs/NEWS_MODULE_STABLE.md`. Production-инварианты: `docs/news-production-contract.md`.

Дальнейшие изменения должны быть хирургическими и не менять orchestration/fail-open/storage/page-assembly boundaries без отдельной прямой задачи.

## Назначение

Pipeline автономно собирает новости, нормализует и дедуплицирует события, оценивает значимость каждого события, формирует русскую версию, связывает новости с играми и публикует атомарный snapshot в Yandex Object Storage.

Production-сайт читает опубликованные данные через `IgropoiskNewsContent`; pipeline не коммитит сгенерированную live-ленту в `main`.

## Поток данных

```text
источники
  ↓
сбор / нормализация
  ↓
дедупликация событий
  ↓
оценка значимости каждого события
  ↓
русская редакционная версия
  ↓
news-events + home selection
  ↓
resolve game identities / hashtags
  ├─ готовая page → canonical game URL
  └─ нет page → pending route + temporary page-assembly queue
  ↓
ПУБЛИКАЦИЯ НОВОСТЕЙ БЕЗ ОЖИДАНИЯ PAGE ASSEMBLY
  ↓
Object Storage snapshot + monthly archive
  ↓
live manifest
  ↓
IgropoiskNewsContent
  ↓
главная / раздел Новости
```

## Cadence

Канонический workflow `.github/workflows/news-pipeline.yml` запускается автоматически каждый час:

```text
23 * * * *
```

Schedule хранится в `main`; run checkout-ит актуальный `staging`. `cancel-in-progress: false`, поэтому новый запуск не отменяет уже выполняющийся production cycle.

## Главное правило: fail-open

Внутренняя ошибка не имеет права остановить всю здоровую ленту.

- Отбор происходит на уровне отдельного события.
- Событие может не пройти публикационный порог по значимости/популярности.
- Отказ отдельного source, image, hashtag, game page, queue, optional AI/refinement, diagnostics или cleanup не блокирует остальные события.
- Ошибки остаются видимыми в health/report.
- Pipeline продолжает следующие стадии после неблокирующего failure.

Регрессионная проверка: `scripts/test-news-fail-open-publication.mjs`.

## Значимость и объём

Нет фиксированного количества итоговых событий. Pipeline публикует естественное количество событий, прошедших порог.

Сигналы:

- независимые источники;
- авторитет источника;
- свежесть;
- скорость распространения;
- обсуждаемость;
- сильный официальный первоисточник.

Cross-source count имеет нелинейный вклад с убывающей отдачей. 4 независимых источника — сильный ориентир, но не обязательный blocker. Крупный официальный первоисточник может дать достаточный сигнал раньше вторичных публикаций.

`data/news-home-ru.json` сейчас содержит максимум 12 карточек только из-за UI presentation cap. Это не редакционная квота pipeline.

## Локализация

Основной EN→RU перевод выполняет локальная модель `Xenova/opus-mt-en-ru`. Runtime/model восстанавливаются из Actions cache; remote translation допустим как резерв.

Проблема отдельного текста не может остановить остальные материалы. Source/provenance сохраняется независимо от локализации.

## Игры, хэштеги и временная очередь

News не является page builder.

1. News resolve-ит упомянутую игру через Game Registry.
2. Хэштег подтверждённой игры остаётся видимым и кликабельным.
3. Если полноценная страница готова — ссылка ведёт на неё.
4. Если страницы ещё нет — ссылка ведёт на `game/pending/?slug=...&title=...`.
5. `game/pending/` — служебный route «Материал готовится», не canonical game page.
6. Для игры сохраняется `pageReady: false`, `assemblyRequired: true`.
7. Игра записывается во временную page-assembly queue в Object Storage.
8. Отдельный модуль страниц забирает queue и собирает полноценную страницу.
9. News publication продолжается сразу и ничего не ждёт.

Ошибка queue или hashtag audit является диагностикой и не блокирует live snapshot.

## История

Перед сбором pipeline гидратирует существующую live history из monthly archive. После обработки публикуются новый компактный snapshot и стабильные месячные архивы.

## Изображения

Изображение — временный ускоряющий кэш, а не gate.

- По возможности копируется в Yandex Object Storage.
- Публичная карточка использует cached first-party URL.
- Кэш хранится 7 дней.
- Ошибка media не блокирует текст.
- При ошибке/отсутствии используется фирменная заглушка.

## Атомарная публикация

Порядок зафиксирован:

1. collect/process/select;
2. prepare page requests;
3. best-effort enqueue missing games;
4. advisory hashtag audit;
5. **publish snapshot and switch live manifest**;
6. prune redundant snapshots;
7. expire old media cache;
8. сохранить diagnostic artifact.

Cleanup/GC запрещено возвращать перед live switch как обязательную зависимость.

Если Object Storage недоступен, сайт продолжает читать предыдущий успешный snapshot; новый run повторит попытку позже.

## Repository fallback

Repository JSON — аварийный fallback. Он не является основным production backend и его stale state не должен блокировать свежий сетевой сбор или unrelated Pages deploy.

## Health и диагностика

`data/news-pipeline-health.json` и `tmp/news-pipeline-report.json` фиксируют состояние источников, warnings, degraded stages и другие проблемы. `degraded` — допустимый рабочий статус и не означает остановку ленты.

## Regression checks

При изменении pipeline обязательны:

- `scripts/test-news-pipeline.mjs`;
- `scripts/test-news-fail-open-publication.mjs`;
- `scripts/test-news-fast-path-contract.mjs`;
- `scripts/test-game-page-assembly-queue.mjs`;
- content/storage/retention/media tests;
- game-context/linking tests;
- `scripts/validate-stable-news-module.mjs`;
- production news browser smoke;
- реальный autonomous production-run после critical pipeline change.

## Production baseline

На момент freeze автономный run `33735886496` успешно прошёл page-assembly handoff, независимую публикацию новостей, advisory hashtag audit, live snapshot switch и post-publication cleanup.

Live version: `20260903T090817Z-5e464685d904-33735886496`.

Production Pages commit `9077734ccdb650c42441e85f236c9decbfa994d5` задеплоен; news production smoke подтвердил Object Storage backend и рабочие card/game hashtag interactions.

## Правило изменений

Нельзя без отдельной задачи на архитектурное изменение:

- вводить global logical blocker всей ленты;
- запускать game page creation прямо из News;
- ждать page assembly перед публикацией;
- убирать pending route для missing game page;
- вводить фиксированную квоту новостей;
- переставлять cleanup перед publication;
- создавать второй production news pipeline;
- делать repository основной production storage.

Обычная дальнейшая работа — только отдельные изменения источников, ranking weights, dedupe, текстов, картинок, identity/linking и diagnostics.