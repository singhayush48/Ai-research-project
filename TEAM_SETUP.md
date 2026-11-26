# Team Setup — shared cloud database (Supabase)

The project now uses **one central PostgreSQL database in the cloud** instead of a
PostgreSQL installed on each computer. Nobody needs to install PostgreSQL, run
`psql`, or create tables by hand — the tables are created automatically the first
time the server starts.

Every person still runs the app on their own computer, but all of them read and
write the same data.

---

## Part 1 — Owner (one time only): create the central database

### 1. Create a free Supabase project
1. Go to <https://supabase.com> → **Sign in** (GitHub login is easiest) → **New project**.
2. Pick a name (e.g. `ai-research`), choose a **region near you** (for India: *Mumbai / ap-south-1* if offered, otherwise Singapore).
3. Set a **Database Password**. **Use letters and numbers only** (no `@ : / # ?`) — special characters break the connection string. Save it somewhere.
4. Click **Create new project** and wait ~2 minutes.

### 2. Copy the connection string
1. In your project, click the **Connect** button at the top of the page.
2. Choose **Session pooler** (important — the "Direct connection" string is IPv6-only on the free plan and fails on many home/college networks).
3. Copy the string. It looks like:
   `postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your real password (remove the brackets).

### 3. Put it in the project
```bash
npm run setup          # installs everything, creates server/.env
```
Open `server/.env` and set:
```env
DATABASE_URL=postgresql://postgres.abcdefghij:YourPassword123@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
AI_API_KEY=your_openrouter_key
AUTH_TOKEN_SECRET=any_long_random_text
```
(Generate a secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)

### 4. Test and start
```bash
npm run db:check       # should print: OK Connected ... 
npm run dev            # creates all tables automatically, starts everything
```
Open <http://localhost:5173>. In Supabase → **Table Editor** you will now see all the tables.

### 5. (Optional) Move your existing local data to the cloud
Skip this if you are happy to start fresh. Otherwise, with your **old local PostgreSQL still running**, and after step 4 has created the tables:
```bash
pg_dump -h localhost -U postgres --data-only --inserts --no-owner ai_research_assistant > data.sql
psql "YOUR_DATABASE_URL_HERE" -f data.sql
```
(`pg_dump`/`psql` come with the PostgreSQL you already installed. On Windows they live in `C:\Program Files\PostgreSQL\<version>\bin`.) Then delete `data.sql` — it contains your data.

---

## Part 2 — Teammates: get running in 3 steps

1. **Install Node.js** (LTS version, one installer) from <https://nodejs.org>. Nothing else is needed — no PostgreSQL.
2. **Get the project** (`git clone https://github.com/singhayush48/Ai-research-project.git`, or unzip the zip) and, inside the project folder, run:
   ```bash
   npm run setup
   ```
3. **Add the secrets**: put the `server/.env` file the owner sent you into the `server/` folder (or open the newly created `server/.env` and paste in the `DATABASE_URL` and `AI_API_KEY` the owner gave you). Then:
   ```bash
   npm run db:check
   npm run dev
   ```
   Open <http://localhost:5173> and **register your own account**.

> Each teammate registers their own account; users only see their own projects, notes and saved papers.
> To start later, just run `npm run dev` again.

---

## Sharing secrets safely

`server/.env` holds your database password and AI key. **Never** commit it to GitHub or put it in a zip you post publicly.
Send it privately (WhatsApp/Telegram direct message, password manager, etc.). Anyone who has the `DATABASE_URL` has full access to the database, so share it only with people you trust.
If it ever leaks: Supabase → **Project Settings → Database → Reset database password**, and generate a new AI key.

---

## Things to know about the free plan
- **Pausing:** Supabase pauses free projects after 1 week of inactivity. If the app suddenly can't connect, open the Supabase dashboard and click **Resume project** (your data is kept). Just using the app regularly prevents this.
- **Size:** 500 MB per project — plenty for text/metadata.
- **Backups:** not included on the free plan. Export a copy now and then with `pg_dump` (command in step 5, without `--data-only` if you want everything).
- **Connections:** the app uses a small pool (5 connections per computer). If many people run it at once and you see "too many clients", lower `DB_POOL_MAX=3` in `server/.env`.

## Prefer a different provider?
The app uses standard PostgreSQL, so **any** Postgres host works — just paste its connection string into `DATABASE_URL`:
- **Neon** (<https://neon.com>) — free, 1 GB, sleeps when idle but wakes automatically (no manual resume). Copy the connection string from the project dashboard.
- Railway, Render, Aiven, etc. work the same way.

Firebase is *not* a drop-in option: it is a NoSQL database, so every query in the server would have to be rewritten.

---

## Troubleshooting (`npm run db:check` tells you which one)

| Message | Fix |
|---|---|
| `password authentication failed` | Wrong password in `DATABASE_URL`. Re-copy it, or reset the DB password in Supabase. |
| `getaddrinfo ENOTFOUND` / `ETIMEDOUT` | Use the **Session pooler** string, check your internet, check the project isn't paused. |
| `Tenant or user not found` | Username must be `postgres.<project-ref>` — copy the full string from the **Connect** button. |
| `Invalid URL` | Password has special characters. Reset it to letters + numbers only. |
| `self-signed certificate` | Add `DB_SSL=on` to `server/.env`. |
| `Node.js 18 or newer is required` | Install the LTS version from nodejs.org. |
| Port 5000 or 5173 already in use | Close the other program, or change `PORT` in `server/.env`. |
