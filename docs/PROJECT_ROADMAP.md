# Игропоиск — канонический ПУТЬ проекта

> **Назначение:** это единственная верхнеуровневая карта развития Игропоиска. Она отвечает не на вопрос «какой PR делать сегодня», а на вопрос **«что строим, в каком порядке, что пока не трогаем и по каким признакам переходим к следующему этапу»**.
>
> Архитектурные документы отдельных модулей (`news-*`, Game Registry, design system и т. п.) описывают детали реализации. Если локальный план противоречит этому ПУТИ, решение сначала сверяется здесь.

<!-- LIFE_OS_SYNC
project: igropoisk
roadmap_version: 2026-08-19
canonical_path: docs/PROJECT_ROADMAP.md
current_stage: M1_PRODUCT_COMPLETION
next_major_stage: M2_CONTENT_BOOTSTRAP
infrastructure_migration_stage: M4_SERVER_BASELINE
ai_runtime_stage: M7_AI_RUNTIME
source_issue: 562
-->

## 0. Главное правило порядка работ

**Сначала довести продукт и максимально наполнить его основным материалом. Только потом выполнять полный перенос production-runtime на собственный сервер.**

До серверной миграции разрешено делать инфраструктурные изменения только если они:

1. устраняют реальную поломку;
2. останавливают неконтролируемый рост данных или расходов;
3. создают совместимый переходный слой, который потом будет использован на сервере;
4. не заставляют переписывать уже работающий продукт раньше времени.

Следствие: сегодняшнее переполнение Object Storage — повод исправить модель хранения, **но не повод срочно переносить весь Игропоиск с GitHub Pages**.

---

# Целевая архитектура в одном рисунке

```text
                         ПОЛЬЗОВАТЕЛЬ
                              │
                              ▼
                    igropoisk.ru / HTTPS
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                   ОСНОВНОЙ VPS / SERVER                    │
│                                                              │
│  Web / frontend     Content API      background workers      │
│                            │                 │                 │
│                            └────────┬────────┘                 │
│                                     ▼                          │
│                                PostgreSQL                      │
│                          данные + история                      │
│                                     │                          │
│                           AI Gateway / jobs                    │
│                                     │                          │
│                       Ollama small model (optional)            │
└─────────────────────────────┬────────────────────────────────┘
                              │ ссылки на файлы
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  S3-COMPATIBLE OBJECT STORAGE               │
│  уникальные изображения / обложки / screenshots / backups   │
└──────────────────────────────────────────────────────────────┘

GitHub = код + PR + CI/tests + deploy.
GitHub не является production-базой, постоянным worker-runtime или обязательной
зависимостью для открытия сайта.

Тяжёлый AI/GPU = отдельный ресурс по требованию, а не сервер 24/7.
```

## Что хранится где в конечной схеме

### PostgreSQL — память Игропоиска

Здесь должны жить структурированные данные и их история:

- Game Registry и идентичности игр;
- новости, источники и связи с играми;
- релизы и их статусы;
- обзоры, оценки и source-traced evidence;
- Game DNA и similarity data;
- публикации и revisions;
- состояния jobs, ошибки и операционная история.

История хранится как записи/ревизии изменившихся сущностей. **Нельзя хранить историю путём почасового копирования всего состояния сайта.**

### Object Storage — склад тяжёлых файлов

Здесь живут:

- изображения новостей;
- обложки;
- screenshots и art;
- другие большие media assets;
- резервные копии PostgreSQL;
- ограниченное количество аварийных exports/snapshots.

Правило: **один уникальный файл — одна физическая копия**, content-addressed по hash там, где это возможно.

### GitHub — разработка

GitHub хранит:

- исходный код;
- конфигурацию и schema;
- PR/историю разработки;
- тесты и CI;
- deployment definitions.

В финальной production-архитектуре сайт не должен зависеть от доступности GitHub при обычном пользовательском запросе.

---

# M0 — Контроль хранения до серверной миграции

**Статус: IN PROGRESS.**

Это переходная работа, которую нужно закончить сейчас, потому что старый storage pattern уже остановил публикацию News через `BucketMaxSizeExceeded`.

## M0.1 News: перестать копировать весь архив каждый час

Переходная схема до PostgreSQL-primary:

```text
news/live/...
    только актуальное live-окно

news/archive/YYYY/MM.json
    один логический архив на месяц

news/media/<content-hash>.<ext>
    одна физическая копия каждого уникального изображения

rollback snapshots
    ровно 3 последние технические версии
```

Требования:

- текущая migration должна уметь один раз прочитать старый `schemaVersion: 1`;
- построить месячные архивы без потери уже опубликованных новостей;
- переключить `current.json` на новую schema;
- дальнейшие hourly runs не должны снова копировать весь накопленный архив;
- frontend читает архив только через существующий Content API boundary, а не напрямую знает URL storage;
- старые новости остаются доступны пользователю;
- внутренние parser/audit файлы не попадают в публичное постоянное хранилище, если браузеру они не нужны.

## M0.2 Retention

Пока действует Object Storage-primary:

- live version — всегда сохраняется;
- rollback — максимум 3;
- незавершённые/непубличные snapshot attempts — удаляются автоматически;
- закрытые месячные архивы не дублируются каждый час;
- CI artifacts имеют короткий срок жизни и не превращаются в permanent storage.

Увеличение bucket limit **не является способом исправления утечки хранения**.

## M0.3 Media normalization

Перед постоянным сохранением изображения:

1. проверить формат и фактическое содержимое;
2. убрать неоправданно огромные исходники;
3. нормализовать web-размер (ориентир 1280–1600 px по длинной стороне, если большее разрешение не нужно продукту);
4. отдавать WebP/AVIF/JPEG с разумным качеством;
5. хранить hash и размер;
6. не загружать повторно идентичный asset.

Цель — типичная web-картинка в сотнях KB, а не многомегабайтный оригинал без причины.

## M0.4 Media GC

Нужен reachability-based garbage collector:

```text
media object
   │
   ├─ используется live news?       → KEEP
   ├─ используется archive news?    → KEEP
   ├─ используется game/review?     → KEEP
   ├─ нужен rollback/export?        → KEEP
   └─ нигде не referenced          → quarantine → DELETE
```

GC не имеет права удалять asset только из-за возраста. Историческая новость должна продолжать открываться с изображением.

## M0.5 Storage budget и наблюдаемость

Ввести автоматический inventory report по namespace:

- total bytes;
- object count;
- media bytes;
- archive bytes;
- snapshot bytes;
- прирост за сутки/неделю;
- крупнейшие объекты;
- orphan candidates.

Пороговые сигналы: 70% / 85% / 95% текущего quota. Рост должен объясняться новым уникальным контентом, а не техническими дублями.

**Текущий 1 GB cap не повышать автоматически.** Когда уникальный полезный контент реально перестанет помещаться, это будет отдельное осознанное решение: оплатить небольшой реальный объём или перенести S3 provider. Не маскировать архитектурную утечку увеличением quota.

## M0 DONE когда

- hourly News больше не копирует полный архив;
- migration старой истории проверена end-to-end;
- существует только 3 rollback snapshot;
- старая новость и свежая новость одновременно открываются;
- storage growth report показывает контролируемый прирост;
- повторные runs с одинаковым контентом почти не увеличивают bucket;
- есть безопасный media GC contract;
- публикация News больше не зависит от свободного места, съедаемого техническими дублями.

---

# M1 — Достроить рабочий продукт

**Статус: ACTIVE / CURRENT PRIORITY.**

Это главный этап сейчас. Полная инфраструктурная миграция запрещена, пока M1 не закончен.

## Что должно стать завершённым продуктом

- главная;
- поиск игр и фильтрация;
- страницы игр;
- Game Registry и canonical links;
- News;
- Releases / календарь;
- Popular Now;
- Reviews и единая review-derived оценка;
- Game DNA;
- Similar Games;
- Top-250;
- единая design system / responsive layout;
- корректные cover/media assets;
- автоматическое создание отсутствующей страницы игры из системных триггеров;
- production gates и smoke checks.

## Принцип M1

Не строить инфраструктуру ради инфраструктуры. Любая техническая работа должна либо исправлять реальный дефект продукта, либо устранять архитектурный риск, который уже мешает продолжать разработку.

## M1 DONE когда

1. пользователь может пройти основные сценарии сайта без «страница готовится», broken links и пустых обязательных блоков;
2. News/Popular/Releases ведут к canonical game pages;
3. создание/обогащение страницы игры стабильно;
4. опубликованный review/score имеет единый source-grounded contract;
5. основные desktop/mobile экраны доведены;
6. production не требует ручного ремонта после обычного автоматического обновления;
7. оставшиеся задачи — расширение наполнения, а не базовая починка продукта.

---

# M2 — Максимальное первоначальное наполнение Игропоиска

**Статус: AFTER M1; отдельные безопасные части могут выполняться параллельно уже сейчас.**

Цель — до покупки постоянной infrastructure capacity создать максимально сильную стартовую базу контента.

## Что наполняем

Для ключевых и заметных игр:

- canonical page;
- identity/release/company data;
- cover + качественная media gallery;
- professional review evidence;
- единая оценка;
- обзор Игропоиска;
- Game DNA;
- similarity links;
- franchise/series relation;
- связанные News/Releases там, где они существуют.

## AI на этапе M2

Для bootstrap допустимо использовать более сильные внешние LLM/ChatGPT и текущую временную инфраструктуру, если итог проходит deterministic source/quality gates.

Критическое правило: **LLM не является источником фактов.** Источник — зарегистрированная профессиональная/официальная evidence. Модель может анализировать, структурировать и улучшать редакционный текст.

Default commercial review уже обязан уметь публиковаться без LLM. AI full-review — улучшение, а не prerequisite существования страницы.

## Как выбирать объём

Приоритет наполнения:

1. игры, уже видимые на главной/Popular/Releases/News/Top;
2. крупные серии и исторически важные игры;
3. игры с высоким текущим поисковым/новостным интересом;
4. каталог по убыванию полезности для пользователя.

## M2 DONE когда

- все игры, которые активно выводятся публичными модулями, имеют полноценные страницы;
- собрана большая стартовая база обзоров, ratings, DNA и media;
- новая ежедневная нагрузка становится намного меньше bootstrap-нагрузки;
- дальнейшая работа в основном состоит из новых релизов, новостей и точечных обновлений, а не массового заполнения пустого каталога.

---

# M3 — Pre-migration architecture freeze и аудит расходов

**Статус: AFTER M2.**

До покупки VPS зафиксировать реальную, а не теоретическую нагрузку.

## Измерить

За репрезентативный период:

- requests/day и peak requests;
- News/Releases jobs/day;
- сколько новых/обновлённых игр в месяц;
- размер PostgreSQL-equivalent dataset;
- media GB и реальный прирост в месяц;
- CPU/RAM текущих deterministic workers;
- сколько тяжёлых AI jobs требуется в месяц;
- сколько времени занимают 8B/20–30B/VL модели на подходящей GPU.

## Storage provider boundary

К этому этапу код не должен быть привязан к Yandex-specific URLs вне одного storage adapter.

Приложение должно видеть:

```text
S3-compatible storage interface
```

а provider может быть:

- Yandex Object Storage;
- Selectel;
- Timeweb или другой совместимый S3;
- другой provider, выбранный по цене/доступности.

**Не переносить Yandex просто ради переноса.** Сначала сравнить стоимость, трафик, доступность из РФ и простоту эксплуатации.

## M3 DONE когда

- известен реальный месячный storage growth;
- известна реальная CPU/RAM нагрузка;
- известна реальная AI/GPU нагрузка;
- есть backup/restore plan;
- storage provider заменяем через adapter;
- можно выбрать VPS по цифрам, а не наугад.

---

# M4 — Поднять базовый production VPS

**Это тот самый поздний milestone из PATH issue #562.**

Покупать/арендовать сервер только после M1–M3.

## Стартовый класс, а не жёсткая покупка заранее

Текущий ориентир для первого VPS без GPU:

- 4–8 vCPU;
- 8–16 GB RAM;
- 100–200 GB NVMe;
- нормальная сеть и backup path;
- Linux.

Финальная конфигурация выбирается после M3 load measurements.

**Постоянный GPU на этом сервере не требуется.**

## Минимальный набор сервисов

На первом VPS держать только необходимое:

```text
reverse proxy / TLS
web/frontend
Content API/backend
PostgreSQL
background workers
job queue
monitoring/health
optional small Ollama service
```

Чтобы не плодить сервисы, очередь на первом этапе предпочтительно строить поверх PostgreSQL/существующего job state, если нагрузка это позволяет. Redis/отдельный broker добавлять только при доказанной необходимости.

Все сервисы должны подниматься воспроизводимо (например, containers/Compose или эквивалент), а не вручную «как получилось».

## M4 DONE когда

- staging-копия сайта работает на VPS;
- TLS/domain route проверены;
- API и DB проходят health/readiness;
- restart VPS не приводит к ручному восстановлению системы;
- production runtime не нуждается в GitHub Pages для обслуживания запроса.

---

# M5 — PostgreSQL становится источником истины

Не переписывать БД с нуля: **переиспользовать уже построенный News PostgreSQL shadow ledger и Content API boundary.**

Текущая архитектура уже предусматривает:

```text
validated content
      ↓
PostgreSQL ledger
      ↓
read-only Content API
```

## Переход без big-bang

Для каждого модуля:

1. импортировать текущее canonical состояние;
2. dual-write/синхронизировать новый validated результат;
3. сравнивать counts, ids и hashes;
4. staging читает DB через API, старый источник — fallback;
5. провести soak period;
6. переключить production read;
7. оставить проверенный export/backup для rollback;
8. только после этого убрать старую постоянную запись в Git/JSON.

Начать с News, потому что shadow schema уже существует. Затем переносить Game Registry/content/reviews/releases по отдельным проверяемым boundaries.

## История после cutover

PostgreSQL хранит сущности и revisions. Object Storage больше не играет роль «базы новостей через тысячи immutable полных snapshots».

Monthly JSON archives после DB cutover могут остаться как дешёвые exports/disaster-recovery artifacts, но не должны быть главным mutable source of truth.

## Backup policy

Минимальная целевая схема после server cutover:

- ежедневный сжатый DB backup;
- retention: 7 daily + 4 weekly + несколько monthly;
- backups вне диска самого VPS;
- периодический реальный restore drill;
- backup считается существующим только после проверки восстановления.

## M5 DONE когда

- production читает canonical structured data из PostgreSQL/API;
- история revisions не требует полных snapshots;
- restore на чистую БД доказан;
- Object Storage остаётся media + backups + bounded exports;
- потеря одного VPS не означает потерю контента.

---

# M6 — Перенести постоянную автоматику с GitHub Actions на server workers

GitHub Actions после этого этапа остаётся CI/deploy-инструментом, а не компьютером Игропоиска.

## На workers перенести

- News schedule;
- Releases schedule;
- Game creation/enrichment queue;
- review/rating materialization;
- Game DNA/similarity jobs;
- media normalization/GC;
- storage inventory;
- maintenance/backup jobs.

## Принцип очереди

Каждая работа должна быть:

- idempotent;
- retryable;
- bounded по времени;
- видна в admin/health;
- иметь статус и последнюю ошибку;
- не блокировать сайт при падении worker.

## GitHub после M6

```text
GitHub
  code
  PR
  tests
  build
  deploy
        ↓
VPS
  production runtime 24/7
```

Никакой пользовательский запрос и никакой обычный hourly content update не должны требовать нового Git commit.

## M6 DONE когда

- recurring production jobs работают без GitHub Actions;
- GitHub outage не выключает уже запущенный сайт и его фоновые jobs;
- deploy всё ещё проходит через проверенный CI;
- jobs наблюдаемы и перезапускаемы на сервере.

---

# M7 — Постоянная AI-архитектура

Этот раздел закрепляет существующую PATH-цель #562 и уточняет её с учётом коммерческого Fallout 2 acceptance.

## Главный принцип

**Игропоиск не должен зависеть от LLM для базовой работоспособности.**

Уже доказанный default path:

```text
professional evidence
      ↓
deterministic grounded review
      ↓
quality gates
      ↓
publish
```

работает без Ollama/GitHub Models/внешней LLM.

AI добавляет качество и автоматизацию там, где это экономически оправдано.

## AI Gateway

Модули не должны напрямую знать, где запущена конкретная модель.

```text
News ───────┐
Releases ───┤
Reviews ────┤
Game DNA ───┼──> AI Gateway ──> deterministic/no-AI
Media ──────┤                 ├> local Ollama small
Registry ───┘                 └> on-demand strong GPU model
```

Gateway отвечает за:

- тип задачи;
- разрешённые providers/models;
- timeouts/retries;
- structured input/output schema;
- provenance;
- cost/runtime accounting;
- fallback;
- запрет модели самостоятельно публиковать непроверенный факт.

## Tier A — дешёвый локальный AI

Класс модели: Qwen ~1.7B–4B или лучший доказанный аналог на момент внедрения.

Задачи:

- classification;
- game/entity matching assistance;
- content routing;
- normalization;
- dedupe candidates;
- extraction candidates.

Модель может работать на CPU и не обязана быть запущена, если deterministic code решает задачу лучше.

## Tier B — сильный text AI по требованию

Класс: примерно 20–30B+ local/open model или другой лучший вариант после собственного benchmark.

Использование:

- optional full editorial review upgrade;
- сложный synthesis;
- language/editorial polish;
- дополнительный evidence-aware analysis.

Ориентир нагрузки после bootstrap — десятки новых крупных обзоров в месяц, поэтому **не держать дорогую GPU 24/7**.

## Tier C — vision/VL по требованию

Использование:

- понять содержание screenshot;
- подобрать screenshot под конкретный абзац/тезис;
- классифицировать UI/gameplay/cutscene/art;
- проверить релевантность media.

Для массового поиска media сначала использовать дешёвые embeddings/image-text retrieval, а сильную VLM — только на коротком списке кандидатов.

## On-demand GPU

```text
накопилась очередь тяжёлых jobs
      ↓
GPU instance START
      ↓
model loaded
      ↓
обработать bounded batch
      ↓
сохранить validated result
      ↓
GPU instance STOP
```

Переходить на постоянную GPU только если измеренная месячная utilisation делает on-demand дороже/хуже.

## Собственный Igropoisk AI Benchmark

Перед выбором основной сильной модели тестировать на реальных данных Игропоиска:

- новости/entity matching;
- 10–20 наборов источников обзоров;
- разные жанры игр;
- русский editorial style;
- factual grounding;
- screenshots/media selection;
- latency;
- RAM/VRAM;
- стоимость одного finished job.

Выбирается не «модель с лучшим интернет-бенчмарком», а лучшая модель для наших задач.

## M7 DONE когда

- существует единый AI Gateway;
- ни один critical publish path не зависит от AI availability;
- small tasks не расходуют дорогую GPU;
- heavy text/vision tasks запускаются on-demand;
- результат AI проходит deterministic evidence/quality gates;
- модель можно заменить без переписывания News/Reviews/Game Registry.

---

# M8 — Production hardening и полноценный запуск с собственного сервера

## Обязательные вещи

- production domain и HTTPS;
- health/readiness endpoints;
- uptime monitoring;
- error reporting;
- DB metrics;
- queue depth/failed jobs;
- storage growth alerts;
- backup success + restore drills;
- deploy rollback;
- secret management;
- firewall: DB/Ollama/internal services не доступны публичному интернету;
- rate limits для публичного API;
- cache headers/CDN strategy для media;
- security updates без ручного хаоса.

## Доступность из РФ

Production-serving не должен зависеть от GitHub Pages/GitHub CDN. При выборе VPS, DNS и Object Storage отдельно проверяется доступность из обычных российских сетей без VPN.

## Cost guardrail

Раз в месяц формируется простой отчёт:

```text
VPS          X ₽
Object Store X ₽ / Y GB
traffic      X ₽
GPU          X ₽ / Z hours
other        X ₽
TOTAL        X ₽
```

Если расход растёт быстрее реального использования продукта — это incident для расследования, а не повод автоматически поднять лимит.

## M8 DONE когда

- сайт работает с собственного production server;
- GitHub Pages больше не production hosting;
- backup/restore и deploy/rollback проверены;
- monitoring показывает состояние всех critical services;
- расход инфраструктуры объясним и контролируем.

---

# M9 — Масштабирование только после реальной нагрузки

Не делать заранее.

Добавлять отдельные DB servers, Redis, CDN, replicas, permanent GPU, Kubernetes и т. п. только когда конкретная метрика показывает необходимость.

Примеры trigger:

- VPS CPU/RAM устойчиво упирается в ресурс;
- DB latency становится проблемой;
- media egress требует CDN;
- очередь jobs не успевает в требуемое окно;
- on-demand GPU utilisation стала настолько высокой, что фиксированный сервер дешевле;
- требуется fault tolerance выше одного VPS.

До этого простая архитектура предпочтительнее сложной.

---

# Что НЕ делать сейчас

До завершения M1/M2:

- не покупать RTX 5090/48 GB GPU server «на будущее»;
- не переносить весь сайт в панике из-за одного переполненного bucket;
- не повышать storage quota вместо устранения duplication leak;
- не строить Kubernetes/microservices;
- не переносить Object Storage только потому, что сейчас используется Yandex;
- не делать LLM обязательной для публикации игры;
- не хранить каждую часовую версию полного исторического JSON;
- не смешивать DB, media и backup в один единственный диск VPS без внешней копии;
- не запускать параллельную вторую архитектуру, если уже существует Content API/PostgreSQL shadow foundation, которую можно довести.

---

# Простая карта переходов

```text
СЕЙЧАС
│
├─ M0  остановить storage waste / monthly News archive
│
├─ M1  достроить сам сайт                         ← ГЛАВНЫЙ ФОКУС
│
├─ M2  максимально наполнить каталог материалами
│
├─ M3  измерить реальную нагрузку и freeze data architecture
│
├─ M4  выбрать и поднять обычный VPS БЕЗ GPU
│
├─ M5  PostgreSQL/API → production source of truth
│
├─ M6  recurring workers → с GitHub Actions на VPS
│
├─ M7  AI Gateway + small local AI + on-demand heavy GPU
│
├─ M8  hardening / domain / monitoring / backup / launch
│
└─ M9  масштабировать только по реальным метрикам
```

---

# LIFE OS sync contract

Для последующей синхронизации с LIFE OS использовать стабильные milestone IDs, а не названия PR:

| ID | Цель | Зависит от | Состояние на 2026-08-19 |
|---|---|---|---|
| `M0_STORAGE_CONTROL` | Контролируемое хранение News/media до переезда | — | IN PROGRESS |
| `M1_PRODUCT_COMPLETION` | Довести рабочую версию сайта | M0 только в части blockers | ACTIVE |
| `M2_CONTENT_BOOTSTRAP` | Максимально наполнить основным контентом | стабильные инструменты M1 | PARTIAL / NEXT |
| `M3_PREMIGRATION_AUDIT` | Измерить нагрузку и зафиксировать data architecture | M1, M2 | PLANNED |
| `M4_SERVER_BASELINE` | Поднять обычный production VPS | M3 | PLANNED |
| `M5_DATABASE_CUTOVER` | PostgreSQL/API source of truth | M4 | PLANNED |
| `M6_WORKER_CUTOVER` | Перенести recurring jobs с Actions | M5 | PLANNED |
| `M7_AI_RUNTIME` | AI Gateway + local/on-demand models | M4–M6 | PLANNED |
| `M8_PRODUCTION_HARDENING` | Полноценный server production | M5–M7 | PLANNED |
| `M9_SCALE_BY_METRICS` | Масштабирование по реальной нагрузке | M8 | LATER |

### Правило синхронизации

LIFE OS должен импортировать/ссылаться на эти milestone IDs и их состояние. Детальные GitHub issues/PR являются задачами внутри milestone, но не заменяют сам ПУТЬ.

---

# Связанные существующие основы

Этот roadmap **не отменяет** уже построенную архитектуру, а собирает её в правильный порядок:

- `docs/news-content-api.md` — frontend уже отделён от физического backend хранения;
- `docs/architecture/phase-b2-news-content-ledger.md` — PostgreSQL ledger/revisions foundation уже существует;
- `docs/news-shadow-runtime.md` — база для безопасного shadow/cutover;
- `docs/game-registry-architecture.md` — canonical identity foundation;
- GitHub issue #562 — исходная поздняя PATH-цель server + Ollama/AI architecture.

## Правило обновления roadmap

Если появляется крупное архитектурное решение уровня «переехать на другой runtime», «изменить source of truth», «ввести обязательный AI», «заменить storage model» или «масштабировать инфраструктуру», сначала обновляется этот файл и только затем создаются implementation issues.

Мелкие UI/bugfix/content задачи roadmap не засоряют.
