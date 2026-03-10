# Demo: Use a real database

The demo can run against **in-browser SQLite** (sample data) or a **real database** (PostgreSQL or MySQL) via the API server. By default it is set to use the real database.

---

## Where to give database credentials

**Put your database credentials only in:**

### `demo/server/.env`

Create this file (copy from `demo/server/.env.example`):

```bash
cp server/.env.example server/.env
```

Edit **`demo/server/.env`** and set:

| Variable       | Example        | Description        |
|----------------|----------------|--------------------|
| `DB_HOST`      | `localhost`    | Database host      |
| `DB_PORT`      | `5432`         | Port (5432 Postgres, 3306 MySQL) |
| `DB_USER`      | `postgres`     | Database user      |
| `DB_PASSWORD`  | `yourpassword` | Database password  |
| `DB_NAME`      | `mydb`         | Database name      |
| `DB_TYPE`      | `postgres`     | `postgres` or `mysql` |

**Example for PostgreSQL:**

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=your_database_name
DB_TYPE=postgres
```

**Example for MySQL:**

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=your_database_name
DB_TYPE=mysql
```

Do **not** put these values in the frontend or in `demo/.env`. The frontend only talks to the API server; the server is the only place that uses DB credentials.

---

## Frontend config (API URL only)

Create **`demo/.env`** (copy from `demo/.env.example`):

```bash
cp .env.example .env
```

For the real-database demo you only need:

```env
VITE_API_BASE_URL=http://localhost:3001
VITE_USE_REMOTE_DB=true
```

No database username/password go here.

---

## How to run the demo with a real database

1. **Set credentials**  
   Create `demo/server/.env` and fill in `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TYPE` (and `DB_PORT` if needed).

2. **Start the API server** (it reads `server/.env` and connects to your DB):

   ```bash
   cd demo/server
   npm install
   npm start
   ```

   You should see: `SQL API running at http://localhost:3001`

3. **Point the frontend at the API**  
   Create `demo/.env` from `demo/.env.example` with:
   - `VITE_USE_REMOTE_DB=true`
   - `VITE_API_BASE_URL=http://localhost:3001`

4. **Start the demo app** (from repo root or `demo/`):

   ```bash
   cd demo
   pnpm install
   pnpm dev
   ```

5. Open **http://localhost:5173** and run SQL against your real database.

---

## Switching back to in-browser SQLite (no server)

In **`demo/.env`** set:

```env
VITE_USE_REMOTE_DB=false
```

Restart `pnpm dev`. The demo will use the built-in sample data and no API server.

---

## Summary

| What                 | Where to set it        | File / variables                          |
|----------------------|------------------------|-------------------------------------------|
| **Database credentials** | Backend only           | **`demo/server/.env`** → `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TYPE`, `DB_PORT` |
| **API URL + mode**   | Frontend (no secrets)  | **`demo/.env`** → `VITE_API_BASE_URL`, `VITE_USE_REMOTE_DB` |
