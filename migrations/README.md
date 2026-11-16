# D1 migrations

Numbered SQL files (`0001_name.sql`, …) for the `astir-db` D1 database. Create one with `npx wrangler d1 migrations create astir-db <name>`.

- Local: `npm run db:migrate:local`
- Production: `npm run db:migrate:remote`

Migrations run in order and are never edited after they've been applied to production. Add a new one instead.
