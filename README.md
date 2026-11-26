# AI Research Assistant

A full-stack academic research assistant that helps a user create research projects, search real academic papers (via OpenAlex), save and analyze them with AI, compare multiple papers, identify research gaps, keep notes, and generate a structured research draft — built strictly to a **React + Node.js/Express + PostgreSQL** stack with no unnecessary libraries.

This is a 4-member B.Tech CSE capstone project.

---

## 1. Final Architecture

```
React Frontend (Vite, plain CSS, no Router/Redux/Axios)
        |
        | HTTP/JSON (fetch, credentials: include)
        v
Express Backend (Node.js)
        |
        +------ PostgreSQL   (pg driver, parameterized SQL)
        |
        +------ OpenAlex API (native fetch, keyless)
        |
        +------ AI API       (native fetch, provider configurable via .env)
```

- The frontend never sees the AI API key or DB credentials — those live only in `server/.env`.
- Authentication uses an httpOnly, signed session cookie (HMAC-SHA256 via Node's `crypto`), not `localStorage`, so tokens are not exposed to client-side JS / XSS.
- Every SQL query is parameterized (`$1, $2, ...`); no string concatenation of user input is used anywhere.

## 2. Feature List

As of **Pass 5**, the frontend is a single conversational workspace (one
research chat = one persistent research project) rather than a
tab/dashboard-based UI — see `PROJECT_STATE.md` §1–2 for the full
architecture writeup. Feature list:

1. Register / Login / Logout / Current user (session-cookie based)
2. **Chat-first research workspace** — a "What's on your research agenda?"
   welcome screen kicks off a new persistent research chat; every
   subsequent search, AI analysis, gap-finding, planning, and draft
   generation appears and persists as a turn in that same conversation
3. Research Projects (= chats) — create / rename / delete / resume exactly
   where you left off, research question, description, notes, linked papers
4. Academic Paper Search — OpenAlex, inline in the conversation, every
   search preserved in the chat's history (not overwritten by the next one)
5. Paper Details — full metadata, abstract, DOI/URL, Save / Select /
   Deselect / Remove / Preview actions, all from inline cards
6. AI Research Intelligence — themes, findings, methodologies,
   similarities/differences/contradictions, every point labeled
   source-supported / AI interpretation / AI suggestion with `[n]` references
7. Research Gap Analysis — under-explored areas, methodological gaps,
   conflicting findings, missing contexts, suggested follow-up questions
8. Research Plan generation — builds directly on a project's identified gaps
9. Research Notes — create / edit / delete, optionally tied to a project
10. Research Draft/Literature-Review Generation — rendered as a card inside
    the conversation with Edit / Copy / Export / Regenerate actions
11. Reference integrity — the AI is contractually restricted (via prompt)
    to only cite papers it was given
12. Research Copilot — a project-grounded chat that is now simply *the*
    conversation, not a separate tab
13. Light / Dark / System theme, fully responsive (sidebar and research
    context panel become drawers on mobile)

## 3. Database Schema

See [`database/schema.sql`](database/schema.sql) for full DDL. Summary ER relationships:

```
users 1───* research_projects
users 1───* saved_papers *───1 papers
research_projects *───* papers   (via project_papers)
users 1───* analyses  (paper_id -> papers)
users 1───* comparisons (paper_ids INTEGER[])  -- also reused for research_intelligence/research_gap/research_plan
users 1───* notes  (optional project_id, optional paper_id)
users 1───* reports (project_id, paper_ids INTEGER[])
users 1───* sessions  (session/token store, supports logout/revocation)
research_projects 1───* copilot_messages   (the chat's conversation history)
research_projects 1───* project_searches   (the chat's literature-search history)
```

Key design notes:
- `papers.openalex_id` is `UNIQUE` — we upsert on it so the same paper is never duplicated locally.
- `saved_papers` and `project_papers` are join tables with `UNIQUE(user_id/project_id, paper_id)` to prevent duplicates, and `ON DELETE CASCADE` so removing a user/project cleans up cleanly.
- `analyses`, `comparisons`, `reports` store the AI's structured JSON output (`JSONB`) so past results can be reloaded without re-calling the AI.
- `copilot_messages` and `project_searches` together with `comparisons`/`reports` are merged at read-time (`GET /projects/:id/timeline`) into the single chronological conversation the chat UI renders — see `PROJECT_STATE.md` §2/§9 for how and why.

## 4. API List

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/dashboard

GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/timeline          the merged conversation for a research chat
POST   /api/projects/:id/papers            { paperId } or { openalexPaper }, optional { selected }
DELETE /api/projects/:id/papers/:paperId

GET    /api/papers/search?q=...&page=...&projectId=...   (projectId optional — logs the search into that chat)
GET    /api/papers/:id                     (numeric local id OR OpenAlex id, e.g. W2741809807)
GET    /api/papers/saved
POST   /api/papers/save                    { paperId } or { openalexPaper }
DELETE /api/papers/save/:id

POST   /api/ai/kickoff                     { topic, researchType? } — creates a chat + first AI turn
POST   /api/ai/analyze-paper               { paperId }
POST   /api/ai/compare-papers              { paperIds: [] }
POST   /api/ai/research-gap                { paperIds: [] }
POST   /api/ai/generate-draft              { projectId, paperIds: [] }
GET    /api/ai/draft/:projectId
POST   /api/ai/suggest-question            { topic, objective?, researchType? }
POST   /api/ai/analyze-sources             { projectId }
GET    /api/ai/analyze-sources/:projectId
POST   /api/ai/research-gaps               { projectId }
GET    /api/ai/research-gaps/:projectId
POST   /api/ai/research-plan               { projectId }
GET    /api/ai/research-plan/:projectId
POST   /api/ai/copilot                     { projectId, message }
GET    /api/ai/copilot/:projectId

GET    /api/notes?projectId=
POST   /api/notes
PUT    /api/notes/:id
DELETE /api/notes/:id
```

## 5. Project Folder Structure

```
ai-research-assistant/
├── client/                  React frontend (Vite, plain CSS)
│   ├── src/
│   │   ├── components/      ChatSidebar, Topbar, Composer, ConversationFeed,
│   │   │                    ResearchContextPanel, WelcomeScreen, DraftCard,
│   │   │                    PaperCard, PaperPreviewModal, EvidenceUI,
│   │   │                    ResearchIntelligencePanel, ResearchGapsPanel,
│   │   │                    ResearchPlanPanel, ProgressStages, ThemeToggle,
│   │   │                    Loading, ErrorBanner, EmptyState, SuccessMessage
│   │   ├── pages/            Login, Register, ChatWorkspace (the chat UI),
│   │   │                     Projects, PaperSearch, PaperDetail, Compare, Notes
│   │   ├── services/api.js  fetch wrapper (no axios)
│   │   ├── styles/base.css  all styling (no Tailwind/Bootstrap)
│   │   ├── App.jsx          state-based routing (no react-router)
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/                  Express backend
│   ├── controllers/         auth, project (incl. timeline), paper, ai (incl. kickoff), note, dashboard
│   ├── routes/               matching REST routers
│   ├── services/             openalex.js, aiService.js, prompts.js
│   ├── middleware/           auth.js, cookies.js, errorHandler.js
│   ├── db/pool.js            PostgreSQL connection (pg)
│   ├── db/init.js            idempotent schema initialization on backend startup
│   ├── utils/                 hash.js, token.js, validate.js, generateDemoHash.js
│   ├── app.js
│   ├── server.js
│   └── package.json
├── database/
│   ├── schema.sql
│   └── seed.sql
├── .env.example
└── README.md
```

## 6. Pass 8 Reliability Fixes

Pass 8 makes the local development path more resilient without changing the
chat-first UI. The backend verifies the additive PostgreSQL schema at startup,
so the `project_searches` table introduced by the persistent timeline cannot
be silently missing when an older local database is reused. AI operations that
expect structured JSON request JSON mode where supported, use defensive JSON
extraction, and the kickoff flow validates its expected `questions`/`tip`
shape with one controlled retry. The frontend also clears a stale persisted
project id when it does not belong to the currently authenticated user.

## 6. Dependency List (and why each is necessary)

**Backend (`server/package.json`):**
| Package | Why |
|---|---|
| `express` | Required backend framework per spec |
| `pg` | The one permitted PostgreSQL driver — no ORM |

No `jsonwebtoken`, `bcrypt`, `cookie-parser`, `cors`, or `dotenv` — all re-implemented with Node built-ins (`crypto`, manual cookie parsing/CORS headers, `process.loadEnvFile()` on Node 20.6+).

**Frontend (`client/package.json`):**
| Package | Why |
|---|---|
| `react`, `react-dom` | Required frontend framework per spec |
| `vite` (dev) | Build tool only — not a UI/state/routing library, does not violate the no-extra-library policy |
| `@vitejs/plugin-react` (dev) | Enables JSX compilation for Vite |

No axios, no react-router, no Redux/Zustand/React Query, no CSS framework.

---

## 7. Installation Instructions

### 7.1 Install Node.js
Install Node.js **v20.6 or newer** (needed for the built-in `process.loadEnvFile()`) from https://nodejs.org. Verify with:
```bash
node --version
```

### 7.2 Install PostgreSQL
Install PostgreSQL 14+ from https://www.postgresql.org/download/. On Windows/macOS use the installer; on Ubuntu:
```bash
sudo apt install postgresql postgresql-contrib
```

### 7.3 Create the database
```bash
psql -U postgres
CREATE DATABASE ai_research_assistant;
\q
```

### 7.4 Run the schema
```bash
psql -U postgres -d ai_research_assistant -f database/schema.sql
```

### 7.5 (Optional) Seed demo data
```bash
node server/utils/generateDemoHash.js
# copy the printed INSERT statement, run it via psql, then:
psql -U postgres -d ai_research_assistant -f database/seed.sql
```
Demo login: `demo@example.com` / `Demo@1234` (only if you ran the generator above).

### 7.6 Environment variables
```bash
cp .env.example server/.env
```
Edit `server/.env` and fill in your PostgreSQL credentials, a random `AUTH_TOKEN_SECRET` (see comment in the file for a one-liner to generate one), and your AI API key.

### 7.7 AI API setup
The app is provider-agnostic. Set in `server/.env`:
- `AI_API_URL` — the provider's chat/completion endpoint
- `AI_API_KEY` — your API key
- `AI_MODEL` — the model name
- `AI_API_VERSION` — required by some providers (Anthropic-style header)

The default `.env.example` values assume Anthropic's Messages API shape. Get a key at https://console.anthropic.com if using Claude.

### 7.8 OpenAlex setup
No API key required. Optionally set `OPENALEX_CONTACT_EMAIL` in `.env` — OpenAlex gives higher, more reliable rate limits ("polite pool") to requests that include a contact email.

### 7.9 Backend installation
```bash
cd server
npm install
```

### 7.10 Frontend installation
```bash
cd client
npm install
```

### 7.11 Running (development)
Two terminals:
```bash
# Terminal 1
cd server
npm run dev        # http://localhost:5000

# Terminal 2
cd client
npm run dev         # http://localhost:5173
```
Open http://localhost:5173.

### 7.12 Running (production build)
```bash
cd client
npm run build        # outputs client/dist
cd ../server
NODE_ENV=production npm start
```
Serve `client/dist` with any static host (or add `express.static` to `app.js` pointing at it) and point `CLIENT_ORIGIN` in `.env` at that deployed URL.

---

## 8. Testing Instructions / Manual Testing Checklist

**Authentication**
- [ ] Register with a new email → succeeds, logs in automatically
- [ ] Register with an already-used email → 409 error shown
- [ ] Register with a password < 8 chars → validation error, no request sent to DB
- [ ] Login with correct credentials → succeeds
- [ ] Login with wrong password → generic "Invalid email or password" (no user enumeration)
- [ ] Logout → session cookie cleared, protected pages redirect to login
- [ ] Refresh the page while logged in → session persists (GET /api/auth/me)

**Projects**
- [ ] Create a project with only a title → succeeds
- [ ] Create a project with title < 3 chars → validation error
- [ ] Edit a project → changes persist
- [ ] Delete a project → removed from list, cascade-deletes its project_papers/notes/reports
- [ ] Open a project you don't own by guessing an ID → 404 (authorization enforced server-side)

**Paper Search**
- [ ] Search a common topic (e.g. "machine learning") → results with title/authors/year/abstract
- [ ] Search nonsense text → "No results found" empty state, not an error
- [ ] Pagination Next/Previous → page number updates, new results load
- [ ] Turn off network / bad OPENALEX_BASE_URL → friendly error banner, not a crash

**Paper Saving**
- [ ] Save a paper from search results → button shows "Saved"
- [ ] Open Compare page → saved paper appears in the checklist
- [ ] Remove a saved paper → disappears from saved list

**AI Analysis**
- [ ] Analyze a paper with a real abstract → structured sections populate
- [ ] Analyze a paper with a thin/missing abstract → several fields correctly show "Not available in the provided source."
- [ ] Turn off AI_API_KEY → clear 500/502 error message, not a silent failure

**Paper Comparison / Research Gap**
- [ ] Select 2+ saved papers → Compare button enabled
- [ ] Select only 1 paper → Compare/Gap buttons stay disabled
- [ ] Run comparison → table + similarities/differences/gaps render
- [ ] Run research-gap analysis → disclaimer banner + themed lists render

**Report/Draft Generation**
- [ ] Generate a draft with 0 papers linked to project → button disabled
- [ ] Generate a draft with 1+ papers → all 7 sections + a References list render
- [ ] References list only contains the linked papers (no invented citations)

**Notes**
- [ ] Add a note (empty content) → blocked client + server side
- [ ] Add, edit, delete a note → all reflected immediately

**Error Handling / Authorization**
- [ ] Call any `/api/projects` route without a session cookie → 401
- [ ] Send a malformed project ID (e.g. `abc`) → 400, not a DB crash
- [ ] Try to add/remove a paper on a project belonging to another user → 404, not leaked

### Example API request/response

```
POST /api/papers/search?... 
GET /api/papers/search?q=generative+ai+education&page=1

200 OK
{
  "results": [
    {
      "openalexId": "https://openalex.org/W4386518490",
      "title": "Generative AI and the Future of Software Engineering Education",
      "authors": ["A. Author", "B. Author"],
      "abstract": "...",
      "publicationYear": 2024,
      "sourceName": "IEEE Transactions on Education",
      "doi": "https://doi.org/10.xxxx/xxxx",
      "paperUrl": "https://doi.org/10.xxxx/xxxx",
      "citedByCount": 12
    }
  ],
  "page": 1,
  "perPage": 20,
  "totalCount": 431,
  "totalPages": 22
}
```

```
POST /api/ai/analyze-paper
{ "paperId": 7 }

200 OK
{
  "analysisId": 3,
  "createdAt": "2026-08-29T10:00:00.000Z",
  "analysis": {
    "executiveSummary": "...",
    "researchProblem": "...",
    "researchObjectives": "...",
    "methodology": "Not available in the provided source.",
    "datasetOrSetup": "Not available in the provided source.",
    "mainFindings": "...",
    "contributions": "...",
    "limitations": "...",
    "futureWork": "...",
    "importantConcepts": ["generative AI", "software engineering education"]
  }
}
```

---

## 9. Demo Walkthrough

1. Register a new account (or use the demo user if seeded).
2. Land on the **"What's on your research agenda?"** welcome screen.
3. Type a topic, e.g. *"Impact of generative AI on software engineering
   education"*, and submit — this creates a research chat and the AI
   immediately suggests 2–3 candidate research questions in the same turn.
4. Click **"Use this question"** on one of the suggestions — the app sets
   it as the chat's research question and automatically searches the
   literature; results appear as paper cards right in the conversation.
5. **Select** 2–3 of the papers directly from their cards (or open
   **Preview** first, then select from the modal).
6. Use the **Analyze Sources** quick action (composer or right-hand panel)
   — a Research Intelligence card appears in the conversation with themes,
   findings, and `[n]`-referenced points labeled source-supported / AI
   interpretation / AI suggestion.
7. Use **Find Gaps**, then **Create Plan** — each appears as its own card
   further down the same conversation (Create Plan is disabled until gaps
   exist).
8. Use **Generate Draft** — a literature-review document card appears with
   Edit / Copy / Export / Regenerate actions, its References section tied
   only to the papers actually selected.
9. Refresh the page (or navigate away via the sidebar and back) — the
   entire conversation, every search, selection, analysis, gap, plan, and
   draft is exactly where you left it.
10. Start a **second** research chat via **"+ New Research"** in the
    sidebar and confirm its papers/analysis/conversation are completely
    separate from the first.

## 10. Five-Progress-Review Plan

| Review | % | Deliverables |
|---|---|---|
| Review 1 | 15% | Requirements, problem statement, architecture diagram, DB schema design, UI wireframes/prototype |
| Review 2 | 35% | React frontend shell + routing, Express backend + PostgreSQL connection, working auth (register/login/logout), basic dashboard |
| Review 3 | 55% | OpenAlex search integration, paper details page, save-paper flow, project↔paper linking |
| Review 4 | 75% | AI paper analysis, multi-paper comparison, research-gap analysis, notes |
| Review 5 | 100% | Draft generation, full error handling, complete testing pass, documentation, final live demo |

## 11. Four-Member Contribution Plan

- **Member 1 — Frontend & UI**: `client/src/pages`, `client/src/components`, `client/src/styles/base.css`, UX states (loading/empty/error), responsive layout.
- **Member 2 — Backend & REST APIs**: `server/controllers`, `server/routes`, `server/middleware`, `server/app.js`/`server.js`, error handling, security (auth middleware, CORS, validation).
- **Member 3 — PostgreSQL & Academic-Data Integration**: `database/schema.sql`, `database/seed.sql`, `server/db/pool.js`, `server/services/openalex.js`, query optimization, migrations.
- **Member 4 — AI Features, Testing & Documentation**: `server/services/aiService.js`, `server/services/prompts.js`, `server/controllers/aiController.js`, manual testing checklist execution, README/API docs, viva prep material.

All four members should be able to explain the full request lifecycle (React → Express → PostgreSQL/OpenAlex/AI → back to React) for the viva, regardless of their primary module.

## 12. Common Viva Questions & Answers

**Q: How is a user's password protected?**
A: We never store plaintext passwords. `server/utils/hash.js` uses Node's built-in `crypto.scryptSync` (a memory-hard KDF) with a random 16-byte salt per user; only the resulting hash+salt are stored. Login re-hashes the entered password with the stored salt and compares using `crypto.timingSafeEqual` to avoid timing attacks.

**Q: How does authentication work without a JWT library?**
A: `server/utils/token.js` hand-builds a JWT-shaped token (`header.payload.signature`, base64url) signed with HMAC-SHA256 using a server-only secret (`AUTH_TOKEN_SECRET`). It's delivered as an httpOnly cookie so client-side JS can't read it (mitigating XSS token theft). We also store a SHA-256 hash of every issued token in the `sessions` table, so logout / revocation works even though the token itself is stateless-verifiable.

**Q: Why PostgreSQL and not MongoDB?**
A: The domain is inherently relational — users have many projects, projects have many papers, papers can belong to many projects, analyses/comparisons/reports reference specific papers. Foreign keys and cascading deletes keep that consistent, which is harder to guarantee in a document store.

**Q: How do you prevent SQL injection?**
A: Every query uses parameterized placeholders (`$1, $2, ...`) via the `pg` driver — user input is never concatenated into SQL strings.

**Q: How do you prevent the AI from hallucinating fake papers/citations?**
A: Every AI prompt (`server/services/prompts.js`) explicitly restricts the model to the exact paper metadata/abstract we send it, forbids inventing titles/authors/DOIs, and requires the literal string `"Not available in the provided source."` for anything not present. The draft-generation prompt additionally forces the References array to echo back only the titles/authors/DOIs we supplied, in the same order, so it can't add new sources.

**Q: What happens if the AI API is down?**
A: `aiService.js` wraps the fetch call in a try/catch with a 10–60s timeout via `AbortSignal.timeout`; failures surface as a clear 502 error message to the frontend rather than crashing the server or hanging indefinitely.

**Q: What happens if OpenAlex returns no results, an error, or a malformed response?**
A: `services/openalex.js` explicitly handles all four cases named in the spec (no results, API error status, network timeout, malformed JSON) and returns clear messages instead of throwing raw errors up to the user.

**Q: How is authorization enforced (not just authentication)?**
A: Every project/paper/note query filters `WHERE ... AND user_id = $req.user.id`, so even a logged-in user cannot read/modify another user's data by guessing IDs — this returns a 404, not a 403, to avoid confirming the resource exists.

**Q: Why Vite instead of Create React App, and does that violate the no-extra-library rule?**
A: Vite is a build/dev tool, not a runtime UI, state, or routing library — it compiles JSX and serves the app in development, comparable to how CRA/webpack would be used, and isn't listed in the forbidden set.

**Q: How would you scale this to production?**
A: Add connection pooling limits tuned to expected load (already using `pg.Pool`), move the AI calls behind a queue/rate limiter for cost control, add caching for repeat OpenAlex searches, and serve the built frontend via a CDN/static host separate from the API.

## 13. Known Limitations

- Abstracts from OpenAlex are sometimes missing or short, which limits how much the AI can extract — this is intentional/expected and surfaced via "Not available in the provided source." rather than papered over.
- No password-reset / email-verification flow (out of scope for a capstone demo; documented as future work).
- The hand-rolled CORS/cookie/token logic is appropriate for this project's scope but is not a substitute for a battle-tested auth library in a real production system with more complex trust boundaries (multiple domains, refresh-token rotation, etc.).
- No automated test suite (unit/integration) — testing is manual, per the spec's checklist-based approach, appropriate for a classroom capstone timeline.
- AI analysis quality is bounded by abstract-level detail; full-text PDF parsing is not implemented.

## 14. Future Scope

- Full-text PDF ingestion (upload or fetch from an open-access link) for deeper AI analysis beyond the abstract.
- Citation graph visualization using OpenAlex's `referenced_works`/`related_works` fields.
- Export research drafts to `.docx`/PDF.
- Collaborative projects (multiple users per project, shared notes).
- Password reset via email, and optional 2FA.
- Caching layer for repeated OpenAlex queries to reduce external API calls.


## AI generation reliability (Pass 10 patch)

The backend now treats `finish_reason: length` as a failed/truncated generation,
never as a completed research result. Structured generation retries only
recoverable empty/truncated/invalid-JSON responses, increases the output budget
within `AI_MAX_OUTPUT_TOKENS`, rejects synthetically repaired truncated JSON,
and validates cached database values before reuse. Reasoning-only provider
responses are not treated as final answers. Authentication, credit, invalid
model, rate-limit, and provider errors retain distinct user-facing messages.

`AI_MAX_OUTPUT_TOKENS` is a configurable ceiling (default 6000); it must be
set at or below the selected model/provider's documented output limit.
`AI_RETRY_TOKEN_MULTIPLIER` controls the bounded increase on recovery attempts.
Existing per-operation token budgets remain task-specific. Project source
intelligence is processed in batches of six papers and merged with source
indices remapped to the original selected-source order.

### Updating an existing installation

1. Back up the project and its `server/.env` file.
2. Extract this ZIP to a temporary folder, then copy its updated `server` and
   `client` source contents into your existing project.
3. Restore your backed-up `server/.env` into the updated `server` folder. The
   delivered ZIP intentionally excludes `.env` so API keys and database
   passwords are not redistributed; do not overwrite your real file with the
   example configuration.
4. Add `AI_MAX_OUTPUT_TOKENS=6000` and `AI_RETRY_TOKEN_MULTIPLIER=1.6` if absent.
   Adjust the token ceiling to the configured model's actual output capacity.
5. From `server`, run `npm install`, then `npm start`.
6. From `client`, run `npm install`, then `npm run dev` (or your existing
   production build/deployment workflow).

The automated checks included with this patch use Node's built-in test runner:
`node --test server/tests/aiService.test.js`. A live provider test still
requires a valid API key, credits, and a currently available model.
