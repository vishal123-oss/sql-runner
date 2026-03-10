# Demo database setup

**See [CREDENTIALS.md](./CREDENTIALS.md)** for where to put database credentials and how to run the demo with a real database (PostgreSQL or MySQL).

Quick summary:

- **Database credentials:** `demo/server/.env` only (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TYPE`).
- **Frontend:** `demo/.env` with `VITE_USE_REMOTE_DB=true` and `VITE_API_BASE_URL=http://localhost:3001`.
- **Run:** Start the server (`pnpm run server` or `cd server && npm start`), then start the app (`pnpm dev`).
