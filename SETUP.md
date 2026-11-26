# SETUP.md — AI Research Assistant

Complete instructions for running this project locally. No real API keys
are included anywhere in this file or in the repository — you provide
your own.

---

## 1. Requirements

- **Node.js** 18 or later (check with `node -v`)
- **PostgreSQL** 14 or later (check with `psql --version`)
- **npm** (comes with Node)
- An **OpenRouter** account and API key ([openrouter.ai](https://openrouter.ai)) —
  or an Anthropic API key if you prefer to use Claude directly instead
  (see §5)

---

## 2. PostgreSQL setup

Make sure PostgreSQL is installed and running.

**macOS (Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql
sudo service postgresql start
```

**Windows:**
1. Download and run the [official installer](https://www.postgresql.org/download/windows/)
   (this also installs `psql`, `createdb`, and pgAdmin). Note the password
   you set for the `postgres` user during install.
2. The installer registers PostgreSQL as a Windows service that starts
   automatically. If it's ever stopped, start it from an **elevated**
   PowerShell:
   ```powershell
   net start postgresql-x64-16
   ```
   (the exact service name depends on the installed version — check
   **Services** (`services.msc`) if unsure, or run `Get-Service *postgres*`
   in PowerShell).
3. Add PostgreSQL's `bin` folder to your `PATH` if `psql` isn't recognized
   (the installer offers to do this — if you skipped it, it's typically
   `C:\Program Files\PostgreSQL\16\bin`).

Confirm you can connect (same command on every OS, from **Command
Prompt**, **PowerShell**, or a bash terminal):
```bash
psql -U postgres -c "SELECT version();"
```
If `psql` asks for a password you don't know, or the `postgres` user
doesn't exist, see Troubleshooting (§10).

---

## 3. Database setup

Create the application database once using the PostgreSQL `postgres` user:

```bash
createdb -U postgres ai_research_assistant
```

**Windows (PowerShell or Command Prompt):**
```powershell
createdb -U postgres ai_research_assistant
```

If the database already exists, do not delete or recreate it. The backend now
automatically runs `database/schema.sql` when it starts, so missing additive
tables/columns (including `project_searches`) are created/verified without
wiping existing data. You can also apply the schema manually with:

```powershell
psql -U postgres -d ai_research_assistant -f database\schema.sql
```

**Important on Windows:** always specify `-U postgres` unless you intentionally
configured another PostgreSQL role. Otherwise `psql`/`createdb` may try to
authenticate as your Windows username (for example `PC-LENOVO`).

The schema is additive and idempotent: it uses `CREATE ... IF NOT EXISTS` and
`ADD COLUMN IF NOT EXISTS`, so applying it to an existing database does not
delete existing application data.

Optional demo user: `server/utils/generateDemoHash.js` prints a ready-to-run
`INSERT` statement for a demo account (email `demo@example.com`, password
`Demo@1234`):
```bash
cd server && node utils/generateDemoHash.js
# copy the printed INSERT statement and run it with psql, e.g.:
# psql -d ai_research_assistant -c "INSERT INTO users ..."
```

---

## 4. `.env` configuration

Copy the example file into the `server/` folder (the client has no `.env`
of its own — it never needs API keys):
```bash
cp .env.example server/.env
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example server\.env
```
**Windows (Command Prompt):**
```cmd
copy .env.example server\.env
```

Open `server/.env` and fill in at least:

| Variable | What to put |
|---|---|
| `AUTH_TOKEN_SECRET` | A long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (works identically on Windows/macOS/Linux) |
| `PGUSER` / `PGPASSWORD` | Your local PostgreSQL credentials (defaults to `postgres`/`postgres`) |
| `AI_API_KEY` | Your OpenRouter API key (see §5) |
| `OPENALEX_CONTACT_EMAIL` | Your email (optional but recommended — see §6) |

**Never commit `server/.env`.** It's already covered by the root
`.gitignore`; double-check `git status` doesn't show it before pushing.

---

## 5. OpenRouter API key setup

1. Create an account at [openrouter.ai](https://openrouter.ai).
2. Go to **Keys** in your OpenRouter dashboard and create a new API key.
3. Pick a model you have access to (OpenRouter lists free and paid
   models — `openrouter/free`-style routing or a specific model like
   `meta-llama/llama-3.1-8b-instruct:free` both work, since the backend
   sends standard OpenAI-compatible chat messages).
4. In `server/.env`:
   ```
   AI_PROVIDER=openrouter
   AI_API_URL=https://openrouter.ai/api/v1/chat/completions
   AI_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
   AI_MODEL=openrouter/free
   ```

**To use Anthropic's Claude API instead** (the codebase supports both —
see `server/services/aiService.js`):
```
AI_PROVIDER=anthropic
AI_API_URL=https://api.anthropic.com/v1/messages
AI_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
AI_MODEL=claude-sonnet-4-5
AI_API_VERSION=2023-06-01
```

The key is read only by the backend (`server/services/aiService.js`) and
is never sent to the browser, logged, or included in any API response.

---

## 6. OpenAlex configuration

OpenAlex is free and requires **no API key**. The only relevant setting:
```
OPENALEX_BASE_URL=https://api.openalex.org
OPENALEX_CONTACT_EMAIL=your_email@example.com
```
Providing your email puts requests in OpenAlex's "polite pool" for higher
rate limits — recommended, not required. Leave `OPENALEX_BASE_URL` as-is
unless OpenAlex changes their API domain.

---

## 7. Backend installation

```bash
cd server
npm install
```
(identical on Windows/macOS/Linux)

---

## 8. Frontend installation

```bash
cd client
npm install
```
(identical on Windows/macOS/Linux)

---

## 9. Commands to run the application

Run these in **two separate terminals** (both need to stay running).
Commands are identical on Windows (PowerShell or Command Prompt),
macOS, and Linux — this is a Node/npm project, not OS-specific.

**Terminal 1 — backend:**
```bash
cd server
npm start
# or, for auto-restart on file changes during development:
npm run dev
```
The API listens on `http://localhost:5000` by default (or whatever
`PORT` you set in `.env`).

**Terminal 2 — frontend:**
```bash
cd client
npm run dev
```
Open `http://localhost:5173` in your browser.

Register a new account, then use **"+ New Research"** in the sidebar to
begin: describe a topic on the welcome screen → pick or edit an
AI-suggested research question → search the literature → select sources →
Analyze → Find Gaps → Create Plan → Generate Draft — all as turns in one
continuous, persistent research chat.

To build the frontend for production:
```bash
cd client
npm run build   # outputs to client/dist/
```

### Testing without live API keys

If you don't have an OpenRouter key yet (or want to verify the app runs
before paying for API usage), you can point the backend at a local mock
server instead of the real APIs, purely to confirm everything wires up
end-to-end:

```
AI_API_URL=http://localhost:4001/chat/completions
OPENALEX_BASE_URL=http://localhost:4001
```

...and run any small local HTTP server on port 4001 that responds to
`GET /works` in OpenAlex's shape and `POST /chat/completions` in
OpenRouter's shape. This is exactly how this pass's own verification was
done in a sandboxed environment with no outbound internet access — see
`PROJECT_STATE.md` §23/§25 for what was and wasn't verifiable that way.
**This is a development/testing convenience only — for real use, point
both URLs back at the real APIs** (`https://openrouter.ai/api/v1/chat/completions`
and `https://api.openalex.org`, the defaults in `.env.example`).

---

## 10. Troubleshooting

> **Pass 6/7 note:** no new environment variables or setup steps were
> introduced in Pass 6 or Pass 7. The natural-language chat router
> (`POST /api/ai/chat`) reuses the same `AI_API_URL`/`AI_API_KEY`/`AI_MODEL`
> and `OPENALEX_BASE_URL` configuration described above — if search,
> analyze, gaps, plan, or draft already worked via the quick-action
> buttons, typing the equivalent request in the chat box will work too,
> with no additional configuration. Pass 7 was UI polish and QA only.

**`psql: error: connection to server ... failed` / `role "postgres" does not exist`**

*macOS/Linux:*
```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb ai_research_assistant
```

*Windows:* the `postgres` role is created by the installer with the
password you set during installation — there's no `sudo -u postgres`
equivalent needed. If you forgot that password, you can reset it: open
**pgAdmin** → right-click the `postgres` login role → **Properties** →
**Definition** tab → set a new password, or edit
`C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf`, temporarily set
the local connection method to `trust`, restart the service, connect
without a password and run `ALTER USER postgres PASSWORD '...'`, then
revert `pg_hba.conf` and restart the service again.

Then update `PGUSER`/`PGPASSWORD` in `server/.env` to match.

**Windows: `'psql' is not recognized as an internal or external command`**
PostgreSQL's `bin` directory isn't on your `PATH`. Either add
`C:\Program Files\PostgreSQL\<version>\bin` to your `PATH` environment
variable (System Properties → Environment Variables) and open a new
terminal, or run `psql`/`createdb` using their full path each time.

**Windows: PostgreSQL service won't start / "port 5432 already in use"**
Another process (often a previous PostgreSQL install, or Docker Desktop
exposing a Postgres container) is already using port 5432. Check with
`netstat -ano | findstr :5432` in PowerShell, stop the conflicting
process, or change `PGPORT` in `server/.env` and in PostgreSQL's own
`postgresql.conf` to a free port.

**Backend starts but every API call returns "Authentication required."**
Make sure your browser is sending cookies — this happens if `CLIENT_ORIGIN`
in `server/.env` doesn't exactly match the URL you're opening the frontend
from (including port), since the CORS/cookie setup only trusts one
configured origin.

**"AI provider is not configured" / every AI feature fails**
`AI_API_URL`, `AI_API_KEY`, and `AI_MODEL` must all be set in
`server/.env`. Restart the backend after editing `.env` (Node only reads
it at startup — on Windows, close the terminal running `npm start`/`npm
run dev` and start it again rather than assuming a save is enough).

**AI features return "Something went wrong on the server" with no detail**
This is intentional — the app never shows raw provider errors or stack
traces to the client (see `server/middleware/errorHandler.js`). Check the
**backend terminal's log output** for the real error (invalid key, rate
limit, model not found, etc.) — it's logged server-side only.

**OpenAlex search returns no results / errors**
- Confirm you have normal internet access to `api.openalex.org` (some
  locked-down networks, corporate firewalls, or sandboxes block it).
- Very short or very generic queries can return zero results — try
  rephrasing the research question.

**Schema errors when re-running `schema.sql`**
Notices like `relation "..." already exists, skipping` are expected and
harmless — that's the idempotent design working as intended. An actual
`ERROR` (not `NOTICE`) means something else is wrong; check you're
pointed at the correct database with `\c ai_research_assistant` in `psql`.

**Port already in use**
Change `PORT` in `server/.env` (backend) or run `npm run dev -- --port 5174`
in `client/` (frontend), and update `CLIENT_ORIGIN` accordingly. On
Windows, find what's using a port with
`netstat -ano | findstr :5000` and match the PID in Task Manager.

**Copilot / Analysis / Gaps / Plan tabs show an empty state instead of a button**
Each stage has a prerequisite by design: Analysis needs selected sources
(Discover or Sources tab), Gaps needs at least one selected source with an
abstract, and Research Plan needs a saved Gaps result first. Follow the
in-app empty-state instructions in order.


## Pass 10 notes (caching + troubleshooting)

- The frontend now talks to `/api` and the Vite dev server proxies it to the backend (default port 5000; set `VITE_API_PORT` if yours differs). You no longer need to care about CORS or `localhost` vs `127.0.0.1`.
- The schema gained one table (`ai_response_cache`) and some indexes. They are created automatically on server start (idempotent) — no manual migration.
- "AI provider is rate-limiting" with a free OpenRouter model: wait a few seconds and press Retry. Identical requests are cached, so a retried-then-successful analysis is instant next time.
- To force a fresh AI answer use the Regenerate button, or set `AI_CACHE=off` in `server/.env`.
