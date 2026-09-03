# News Content API

**Stable module contract:** `docs/NEWS_MODULE_STABLE.md`.

## Назначение

`features/news/content-api/index.js` — единственная точка чтения новостного контента для сайта. Главная, архив новостей и общий слой представления не знают, где физически хранятся новости.

Production backend — Yandex Object Storage через live manifest/snapshot. Repository copies соответствующих JSON существуют только как аварийный fallback и не являются основным production storage.

Основные логические datasets:

- `data/news-events.json`;
- `data/news.json`;
- `data/publisher-news.json`;
- `data/news-home-ru.json`.

## Публичный контракт версии 1

Глобальный объект: `window.IgropoiskNewsContent`.

### `getAll({ lang, force })`

Возвращает нормализованный, проверенный и дедуплицированный список новостей. Частичная недоступность одного источника не выключает остальные источники.

### `getHome({ lang, region, globalLimit, regionalLimit, force })`

Возвращает подборку для главной. Текущий presentation cap — 12 карточек. Это UI-ограничение главной, а не редакционная квота pipeline и не ограничение общего корпуса/архива.

### `health()`

Возвращает последнее известное состояние backend-источников: `idle`, `ready`, `degraded` или `error`, время проверки и количество принятых записей по каждому источнику.

`degraded` является допустимым рабочим состоянием и не означает, что лента должна исчезнуть или что здоровые новости нельзя показывать.

### `invalidate()`

Очищает внутренний runtime-кэш. Метод не изменяет файлы и не запускает парсеры.

## Инварианты

- API работает только на чтение.
- UI не выполняет прямой `fetch` repository news JSON как основной production path.
- Object Storage live snapshot — primary backend.
- Repository data — emergency fallback.
- Stale repository fallback не блокирует получение более свежего Object Storage snapshot.
- Нормализация и дедупликация не дублируются в карточках или страницах.
- Публичный контракт версионируется отдельно от backend.
- Возвращаемые наборы и нормализованные записи не должны изменяться потребителями.
- Частичная backend/source degradation сохраняет доступные новости.
- Если новый snapshot физически недоступен, API продолжает использовать последний пригодный live/fallback набор вместо обнуления блока.

## Игровые ссылки

Content API сохраняет подготовленные pipeline game-link данные.

- Готовая game page → canonical game URL.
- Нет готовой game page → служебный `game/pending/?slug=...&title=...`.
- Pending route не является game page и не меняет `pageReady=false / assemblyRequired=true` semantics.
- Content API не запускает page builder и не ждёт page assembly.

## Замена backend

Для будущего перехода на базу данных или внешний сервис меняется реализация внутри `content-api/`. Методы версии 1 и форма нормализованной записи сохраняются. Главная, архив, карточки, фильтры и дизайн-система при такой замене не меняются.

Изменение публичной формы данных или названий методов требует:

1. новой версии контракта;
2. отдельного адаптера совместимости;
3. контрактных тестов;
4. отдельной миграции потребителей;
5. успешного browser smoke test до production.

Такая замена backend является архитектурным изменением стабильного news module и не должна выполняться заодно с локальной хирургической правкой.