# Игропоиск Ratings API

Постоянное хранение пользовательских оценок для статического сайта.

## Архитектура

- Cloudflare Worker принимает `GET/POST /api/ratings/:game_slug`.
- D1 хранит одну текущую оценку на пару `game_slug + voter_hash`.
- `rating_events` хранит полную историю всех отправок и изменений.
- Исходный IP не сохраняется. Worker создаёт HMAC-SHA-256 идентификатор из IP и секретной соли.

Ограничение IP-модели: несколько людей за одним NAT или корпоративным адресом считаются одним голосующим. Это сознательное следование текущему требованию «один IP — один голос», а не полноценная защита от накруток.

## Развёртывание

```bash
cd backend/ratings-worker
npx wrangler d1 create igropoisk-ratings
# вставить database_id в wrangler.toml
npx wrangler d1 execute igropoisk-ratings --remote --file=./schema.sql
npx wrangler secret put IP_HASH_SECRET
npx wrangler deploy
```

После deploy указать адрес Worker в `config/runtime.json`:

```json
{
  "ratings_api_base": "https://igropoisk-ratings.<account>.workers.dev"
}
```

До этого момента клиентская страница не сохраняет оценки локально и показывает, что сервер не подключён.
