# Phase B2: реляционный журнал новостного контента

## Цель

Добавить PostgreSQL как проверяемый структурированный слой новостей, не переключая production и не изменяя интерфейс сайта.

Phase B1 остаётся каноническим production-контуром:

```text
news pipeline -> immutable Object Storage snapshot -> current manifest -> public site
```

Phase B2 добавляет параллельную теневую запись:

```text
validated snapshot -> PostgreSQL ledger -> read-only Content API -> consistency checks
```

До отдельного подтверждённого переключения сайт продолжает читать Object Storage. Ошибка PostgreSQL не влияет на главную, архив, страницы игр, календарь, релизы, обзоры или авторизацию.

## Сущности

Первый migration создаёт:

- `news_events` — каноническое состояние новостного события;
- `sources` и `news_event_sources` — источники и подтверждения;
- `media_assets` — ссылки и метаданные изображений;
- `content_revisions` — неизменяемая история содержимого;
- `publications` — опубликованные версии канала;
- `parser_runs` и `parser_errors` — операционная история;
- `automation_rules` — будущие версионируемые правила автоматизации.

Каждое изменение новости создаёт новую ревизию только при изменении content hash. Повторный импорт того же snapshot не создаёт дубликаты.

## Граница безопасности

В этой фазе разрешены изменения только в:

```text
services/content-api/
schemas/news.schema.json
docs/architecture/phase-b2-news-content-ledger.md
.github/workflows/news-content-ledger-check.yml
```

Запрещено менять:

```text
index.html
features/news/
features/games/
calendar/
review/
assets/design-system.css
workers и существующие parser workflows
.github/workflows/pages.yml
```

Новый API работает только на чтение и принимает только `GET`/`HEAD`. Pipeline пока не получает доступ к базе production. Импорт запускается в CI на тестовой PostgreSQL и в дальнейшем может быть включён как shadow-write отдельным секретом.

## Проверки

Workflow поднимает временный PostgreSQL, применяет migration, импортирует тестовый и реальный repository snapshot, проверяет:

- валидность обязательных полей;
- идемпотентность импорта;
- историю ревизий;
- связи событий, источников и изображений;
- текущую publication;
- read-only API;
- отсутствие изменений за пределами разрешённой границы;
- отсутствие модификации файлов рабочим процессом.

## Следующее переключение

Только после стабильного shadow-периода выполняется отдельная фаза:

1. pipeline пишет validated snapshot одновременно в Object Storage и PostgreSQL;
2. сравниваются counts, ids и content hashes;
3. staging читает серверный Content API с Object Storage fallback;
4. production переключается после подтверждения;
5. Object Storage остаётся версионированным аварийным snapshot и механизмом отката.
