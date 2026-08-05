# Phase B1: автономное хранилище новостей

## Цель

Новостной контент публикуется без коммита в `main` или `staging` и без запуска GitHub Pages. Интерфейс новостей, страницы игр, релизы, популярное и центральная дизайн-система не меняются.

## Контур

```text
источники
  -> news pipeline в GitHub Actions
  -> локальная нормализация и проверки
  -> неизменяемый snapshot в Yandex Object Storage
  -> контрольное чтение
  -> замена news/manifests/current.json
  -> сайт читает новый snapshot
```

Бакет: `igropoisk-content`.

Публичная точка входа:

```text
https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json
```

## Структура

```text
news/
  manifests/
    current.json
  snapshots/
    <version>/
      manifest.json
      data/
        news.json
        publisher-news.json
        youtube-signals.json
        news-events.json
        news-home-ru.json
        news-pipeline-health.json
  media/
    <sha256>.<extension>
```

JSON snapshots и media objects неизменяемые. Новая версия не перезаписывает старую. Текущей становится версия, на которую указывает `news/manifests/current.json`.

## Атомарная публикация

1. Pipeline собирает данные во временном рабочем каталоге GitHub Actions.
2. Существующие проверки подтверждают минимальный объём, даты, источники, изображения и health snapshot.
3. Изображения загружаются по SHA-256; одинаковые файлы не дублируются.
4. Все JSON-файлы загружаются в новый versioned snapshot.
5. Загруженные объекты проверяются повторным чтением или HEAD-запросом.
6. Snapshot manifest загружается последним внутри версии.
7. Только после этого заменяется `current.json`.

При ошибке до шага 7 посетители продолжают читать предыдущую версию.

## Права

- Публичный сайт имеет только анонимное чтение объектов.
- CORS разрешает `GET` и `HEAD` только с `https://nkuchenov-hash.github.io`.
- GitHub Actions получает ключ сервисного аккаунта через repository secrets.
- Сервисный аккаунт имеет `storage.editor` только на бакет `igropoisk-content`.
- Ключи никогда не попадают в браузер, исходный код, artifacts или логи.

## Fallback

`features/news/content-api/index.js` сначала проверяет внешний manifest. Он принимает только:

- origin `https://storage.yandexcloud.net`;
- bucket path `/igropoisk-content/`;
- channel `news`;
- snapshot URLs внутри объявленной версии.

Если manifest или хотя бы один обязательный источник недоступен, весь внешний snapshot отклоняется и Content API читает последний рабочий repository snapshot. Смешивание половины внешней версии с половиной repository snapshot запрещено.

## Границы

News pipeline:

- не имеет `contents: write`;
- не выполняет `git push`;
- не изменяет HTML, CSS, шаблоны или дизайн-систему;
- не запускает Pages;
- не считается staging writer;
- публикует только объекты под `news/`.

Остальные автоматические writers продолжают работать только через `staging` и полный staging gate.

## Откат

Код откатывается обычным revert/rollback без удаления контента. Контент откатывается заменой `current.json` на manifest предыдущего snapshot. Старые версии сохраняются независимо от кода.

## Медиа игр

Обложки и скриншоты игр в Phase B1 не переносятся. Для них будет отдельный media-контур и отдельный лимит. `igropoisk-content` сейчас обслуживает только новости, их служебные JSON и используемые новостями изображения.
