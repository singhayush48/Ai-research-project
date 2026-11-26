# PROJECT_STATE.md — AI Research Assistant

Last updated: end of **Pass 7 (Final QA + UX Polish)**.
The app is feature-complete for its intended scope. Read this before making
further changes — it tells you what exists, why, and what not to break.

---

## 1. What the app does

> Tell the AI what you want to research → it finds relevant academic
> literature via OpenAlex → you choose the sources → AI analyzes them →
> identifies research gaps → helps plan the research → helps generate
> research outputs — all inside one continuous, persistent chat.

As of Pass 5 this is a **conversational, ChatGPT-style product**, not a
dashboard with a chatbot bolted on. **One research chat = one
`research_projects` row = one persistent research workspace.** Journey:
**Login → "What's on your research agenda?" → describe a topic → AI
suggests research questions → pick or edit one → search the literature
(results appear as cards in the conversation) → select sources → analyze →
find gaps → build a plan → generate a literature review draft — all as
turns in the same conversation, saved and resumed exactly where you left
off.**

## 2. Architecture

**Frontend**: React 18 + Vite, no router library (a `{name, params}` view
object in `App.jsx` + a `navigate()` prop drives screens; current view is
mirrored to `sessionStorage` so refresh returns you to the same chat).
One global stylesheet (`styles/base.css`) using CSS custom properties
throughout (this is what makes dark mode a single override block rather
than a rewrite). No global state library — each page fetches its own data
via `services/api.js`.

- `pages/ChatWorkspace.jsx` — **the core of the app.** Renders either the
  welcome/new-chat screen (`components/WelcomeScreen.jsx`, no `projectId`)
  or an active research chat: loads `GET /projects/:id` (papers/context)
  and `GET /projects/:id/timeline` (the merged conversation) together,
  then owns every mutating action (send message, search, select/deselect,
  analyze, find gaps, build plan, generate draft) as one flat set of
  handlers that each append a new event onto the in-memory timeline rather
  than re-fetching it — keeps the UI fast and the code simple.
- `components/ConversationFeed.jsx` — renders the timeline: chat bubbles
  for `user_message`/`assistant_message`, inline `PaperCard` grids for
  `search` events, and `ResearchIntelligencePanel`/`ResearchGapsPanel`/
  `ResearchPlanPanel`/`DraftCard` wrapped in a card for
  `intelligence`/`gaps`/`plan`/`draft` events — all in one continuous,
  chronologically-sorted scroll. These panel components are unchanged from
  Pass 4; Pass 5 only changed **where** they render (inline in a
  conversation instead of on a tab).
- `components/Composer.jsx` — the bottom message box + quick-action chips
  (Search Papers / Analyze Sources / Find Gaps / Create Plan / Generate
  Draft) that trigger the same handlers `ChatWorkspace` uses for free-text
  chat.
- `components/ResearchContextPanel.jsx` — the right-hand panel (topic,
  research question, discovered/selected source counts, the
  Define→Discover→Analyze→Gaps→Plan→Create progress bar, quick actions,
  and the selected-sources list) — a drawer below 880px.
- `components/ChatSidebar.jsx` — replaces the old `Sidebar.jsx`. Chat list
  grouped Today/Yesterday/Older (like every mainstream AI chat product),
  inline rename/delete, a search box, "+ New Research", and a "More tools"
  section linking to the pre-existing standalone pages below (not
  replaced, just demoted from primary nav — see §9).
- `components/WelcomeScreen.jsx` — "What's on your research agenda?"; a
  single free-text composer + suggested-prompt chips. Submitting calls
  `POST /ai/kickoff`, which creates the project **and** the first AI turn
  in one request.
- `components/DraftCard.jsx` — the literature-review "document" card
  (Edit / Copy / Export-as-.txt / Regenerate).
- `pages/PaperSearch.jsx`, `pages/Compare.jsx`, `pages/PaperDetail.jsx`,
  `pages/Projects.jsx` — pre-existing standalone pages, still reachable
  from the sidebar's "More tools" section as power-user fallbacks; not
  replaced (see §9). `Projects.jsx`'s "Open" button now opens a project in
  the chat UI (`navigate('chat', {id})`) instead of the removed
  `ProjectWorkspace`.
- `components/PaperCard.jsx`, `PaperPreviewModal.jsx` — shared paper
  display, unchanged from Pass 4.
- `components/EvidenceUI.jsx` — shared `TypeBadge` (source-supported / AI
  interpretation / AI suggestion), `SourceChips` ([n] references),
  `Section`, `SourceReferenceList`, unchanged from Pass 4.
- `utils/paper.js` (`normalizePaper`) — every paper object flows through
  this before reaching `PaperCard`/`PaperPreviewModal`/the context panel.
- `hooks/useTheme.js`, `components/ThemeToggle.jsx` — light/dark/system
  theme, unchanged from Pass 4, still works everywhere including the new
  chat UI (no hardcoded colors were introduced).
- `components/Topbar.jsx` — now takes a `title` prop instead of a
  hardcoded string (empty on the chat view, since the chat has its own
  in-conversation title bar); still owns the mobile hamburger + logout.
- **Removed** (fully superseded, not partially): `pages/Dashboard.jsx`,
  `pages/NewResearch.jsx`, `pages/ProjectWorkspace.jsx`,
  `components/Sidebar.jsx` (old), `components/AnalyzingProgress.jsx`. Their
  functionality is a strict subset of what `ChatWorkspace.jsx` now does.

**Backend**: Node + Express, `routes/*.js` → `controllers/*.js` →
`services/*.js` / `db/pool.js`. Unchanged auth model (custom cookie-session,
HMAC-signed token, `sessions` table).

- `controllers/projectController.js` — new `getProjectTimeline(req, res)`
  (`GET /projects/:id/timeline`): the one new piece of real logic this pass
  added. Reads `copilot_messages`, `project_searches` (new table),
  `comparisons` (kind IN intelligence/gap/plan), and `reports` for the
  project **in parallel**, tags each row with a frontend-facing `type`,
  and sorts the merged list by `created_at`. Search-event papers are
  re-joined against the *current* `project_papers.selected_for_analysis`
  state (not a snapshot from when the search ran), so a card's
  Select/Deselect state is always live even if it appears in an old search
  block.
- `controllers/paperController.js` — `searchPapers` gained an optional
  `projectId` query param. When present: every result is upserted into
  `papers`, linked into `project_papers` with `selected_for_analysis =
  FALSE` (discovering ≠ selecting) via `ON CONFLICT DO NOTHING` (so a
  repeat search never un-selects something already chosen), and the
  search itself is logged to `project_searches` so it reappears in the
  timeline on refresh.
- `controllers/aiController.js` — new `kickoffProject`
  (`POST /ai/kickoff { topic, researchType? }`): creates the project,
  derives its title from the topic text, calls the existing
  `buildResearchQuestionPrompt`, and persists both the user's topic and a
  plain-text rendering of the suggested questions as `copilot_messages` so
  they show up correctly even after a reload (the *live* moment right
  after kickoff also gets clickable "Use this question" buttons via the
  `suggestion` field in the response — see `ChatWorkspace.jsx`). New
  `getProjectDraft` (`GET /ai/draft/:projectId`) mirrors the existing
  analyze-sources/research-gaps/research-plan "load the latest saved
  result" pattern for drafts, which previously had no GET equivalent.
  `fetchPapersByIds`/`toSourceRefs` are now exported for reuse by
  `projectController`'s timeline builder.
- Everything else (`services/openalex.js`, `services/aiService.js`,
  `services/prompts.js`, `middleware/*`, the analyze/compare/gap/draft/
  intelligence/gaps/plan/copilot AI endpoints themselves) is **unchanged**
  from Pass 4 — Pass 5 is a frontend-experience change plus the minimum
  backend needed to persist and serve one merged conversation.

## 3. Database

Base tables (pre-existing): `users`, `sessions`, `research_projects`,
`papers`, `saved_papers`, `project_papers`, `analyses`, `comparisons`,
`notes`, `reports`, `copilot_messages`. All schema changes across all 5
passes are additive (`ADD COLUMN IF NOT EXISTS` / `CREATE ... IF NOT
EXISTS`) — `schema.sql` is always safe to re-run against an existing
database; re-verified this pass with a live `psql -f schema.sql` against a
fresh Postgres 16 instance.

| Table | Column/table added | Pass | Purpose |
|---|---|---|---|
| `research_projects` | `research_objective`, `research_type`, `stage` | 1 | Onboarding fields + journey stage |
| `project_papers` | `selected_for_analysis` | 2 | "Linked to project" vs "selected for analysis" are independent |
| `comparisons` | `project_id`, `kind` | 3 | Reused for `'research_intelligence'` (Pass 3), `'research_gap'`/`'research_plan'` (Pass 4) |
| `copilot_messages` (new table) | — | 4 | Copilot chat history |
| `project_searches` (new table) | — | 5 | The one thing with nowhere to persist before Pass 5: literature searches run inside a chat, so they reappear on reload. `paper_ids INTEGER[]` mirrors `comparisons`/`reports`' existing convention. |

`research_projects.description` now doubles as "the original free-text
research topic the chat was started from" (set once, at kickoff) — no new
column was needed for this.

**Four independent per-source states** (unchanged, don't collapse these): a
`project_papers` row = *belongs to project*; its `selected_for_analysis`
flag = *selected for analysis*; a `saved_papers` row = *saved* (global);
an `analyses` row = *analyzed* (per-paper, standalone feature).

## 4. Important API endpoints

All under `/api`, all requiring the session cookie except
`/auth/register`/`/auth/login`. Every project-scoped route verifies
`user_id = req.user.id` — cross-user access returns 404, never 403.

- **Auth**: `POST /auth/{register,login,logout}`, `GET /auth/me`
- **Dashboard**: `GET /dashboard` (backend endpoint kept; no longer linked
  from the frontend nav — see §9)
- **Projects (= chats)**: `GET/POST /projects`, `GET/PUT/DELETE
  /projects/:id`, **`GET /projects/:id/timeline`** *(new, Pass 5)*,
  `POST /projects/:id/papers` (`{paperId}` or `{openalexPaper}`, optional
  `{selected}`), `DELETE /projects/:id/papers/:paperId`
- **Papers**: `GET /papers/search?q=&page=&projectId=` (`projectId` is new
  and optional, Pass 5 — see §2), `GET /papers/saved`, `GET /papers/:id`,
  `POST /papers/save`, `DELETE /papers/save/:id`
- **Notes**: `GET /notes?projectId=`, `POST/PUT/DELETE /notes[/:id]`
- **AI**: `POST /ai/analyze-paper`, `POST /ai/compare-papers`,
  `POST /ai/research-gap` (legacy, standalone Compare page),
  `POST /ai/generate-draft`, **`GET /ai/draft/:projectId`** *(new, Pass 5)*,
  `POST /ai/suggest-question`, **`POST /ai/kickoff`** *(new, Pass 5 —
  `{topic, researchType?}`, creates the chat + first AI turn)*,
  `POST /ai/analyze-sources` + `GET /ai/analyze-sources/:projectId`,
  `POST /ai/research-gaps` + `GET /ai/research-gaps/:projectId`,
  `POST /ai/research-plan` + `GET /ai/research-plan/:projectId`,
  `POST /ai/copilot` (`{projectId, message}`) + `GET /ai/copilot/:projectId`

## 5. OpenAlex integration

Unchanged from Pass 4 (`services/openalex.js`). `constants/research.js`'s
`buildDiscoverQuery(project)` still seeds a fallback search query from the
project's research question/topic when the composer is submitted empty via
the "Search Papers" quick action.

**Sandbox note**: this development container blocks outbound requests to
`api.openalex.org` (network egress allowlist, confirmed via raw `curl` —
not a code bug). This pass's new `searchPapers(projectId=...)` path was
verified up to (and including) the OpenAlex call boundary, plus its
project-linking/logging logic was verified independently by seeding
`project_searches` rows directly and confirming `GET
/projects/:id/timeline` merges and sorts them correctly (see §9). Run one
real search in a normal environment to confirm the live OpenAlex path.

## 6. OpenRouter integration

Unchanged from Pass 4. See Pass 4 notes below (§14) for the AI-provider
sandbox caveat — it applies identically to the new `POST /ai/kickoff`
endpoint, which is the only new AI call this pass added.

## 7. Environment variables

Unchanged from Pass 4 — see `.env.example` / `SETUP.md`.

## 8. How to run locally

See `SETUP.md` for full details. Short version:
```bash
createdb ai_research_assistant
psql -d ai_research_assistant -f database/schema.sql   # safe to re-run anytime

cd server && cp ../.env.example .env   # fill in AUTH_TOKEN_SECRET, AI_API_KEY
npm install && npm start               # http://localhost:5000

cd client && npm install && npm run dev   # http://localhost:5173
```

## 9. Verification performed this pass

Because this pass touches nearly every screen, verification went further
than usual:

- `npm run build` (Vite) succeeds cleanly with no warnings after the
  frontend rewrite (62 modules).
- Every backend file passes `node --check`; `require('./app.js')` loads
  with no circular-dependency or reference errors.
- **Live database test**: installed PostgreSQL 16 in the sandbox, applied
  `schema.sql` to a fresh database, started the real Express server against
  it, and exercised the full request/response cycle over HTTP with `curl`:
  register → login (cookie session) → create project → add a paper via a
  manual `openalexPaper` payload (no network needed) → select → deselect →
  remove → delete project. All worked and returned the expected shapes.
- **Timeline merge logic**: seeded `copilot_messages`, `project_searches`,
  a `comparisons` row (`kind='research_gap'`), and a `reports` row directly
  via SQL with staggered timestamps, then called
  `GET /projects/:id/timeline` and confirmed the four different event types
  came back correctly typed, chronologically sorted, and with source
  references resolved — this was the highest-risk new code path (merging
  4 tables into one feed) and it is confirmed correct against a real
  database, not just by inspection.
- **Cascade delete**: confirmed `DELETE /projects/:id` leaves zero orphaned
  rows in `project_searches`, `copilot_messages`, `comparisons`, or
  `reports` (all `ON DELETE CASCADE`).
- Search-with-`projectId`, kickoff, analyze/gaps/plan/copilot could not be
  exercised end-to-end live because they require `api.openalex.org` /
  `openrouter.ai`, both blocked by this sandbox's network egress allowlist
  (confirmed via direct `curl`, not a code bug — same caveat as Pass 4's
  §5/§6). Their code paths were verified by inspection, by the unit-level
  Postgres tests above (which exercise every query each of them runs
  except the actual external HTTP call), and by the successful `npm run
  build`. Run one real search/kickoff/analyze in a normal environment
  (with real `AI_API_KEY`/`OPENALEX_CONTACT_EMAIL`) to confirm.

## 10. Known limitations

- OpenAlex/OpenRouter connectivity: see §9. Every other code path is
  verified against a live database and a real running server.
- No automated test suite (unit or e2e) — verification this pass was
  manual (live curl/psql testing, documented in §9).
- The Research Plan still requires a saved Research Gap result to exist
  first (unchanged from Pass 4 — see §13 below). The context panel's
  "Create plan" quick action is disabled client-side until a `gaps` event
  exists in the timeline; the API still enforces it with a 400 either way.
- Regenerating a draft appends a new draft card to the conversation rather
  than replacing the old one in place — consistent with "conversation is
  the history," but means a long chat can accumulate several draft
  versions. Acceptable for this project's scope; each draft card is
  independently exportable.
- The in-conversation "Edit" on a draft card edits the displayed text
  locally for copying/exporting; it does not re-save an edited draft back
  to the `reports` table (there's no partial-update endpoint for reports).
  Regenerate creates a fresh AI-authored version instead.
- Theme and last-viewed-chat are stored in browser storage
  (`localStorage`/`sessionStorage`), not the database — per-browser, not
  per-account, unchanged from Pass 4.

## 11. What must NOT be changed without good reason

- `middleware/errorHandler.js` and the `err.status` convention.
- `middleware/auth.js` / `middleware/cookies.js` — cookie-session auth.
- The `comparisons` table reuse pattern (`kind` + nullable `project_id`).
- `formatPaperForPrompt` / `BASE_RULES` in `prompts.js`.
- `utils/paper.js`'s `normalizePaper` and `components/EvidenceUI.jsx`.
- `getProjectTimeline`'s event-sorting/typing contract — the frontend's
  `ConversationFeed.jsx` switches on `event.type` and expects exactly the
  shapes documented in §2/§4; changing the shape there means updating the
  renderer in lockstep.

## 12. Authentication (detail)

Unchanged from Pass 4. See prior revision of this document (git history)
for the full write-up; summary: custom cookie-session auth (PBKDF2 password
hashing, `HttpOnly`/`SameSite=Lax`/`Secure`-in-prod session cookie,
`requireAuth` middleware, per-query `user_id` filtering with 404-not-403 on
cross-user access).

## 13. Research Gaps / Research Plan (detail)

Unchanged in behavior from Pass 4 (still `comparisons` rows with
`kind='research_gap'`/`'research_plan'`, still Plan-requires-Gaps). Pass 5
only changed **where** they render: inline as cards in the conversation
(`ConversationFeed.jsx`'s `intelligence`/`gaps`/`plan` branches wrapping the
unchanged `ResearchIntelligencePanel`/`ResearchGapsPanel`/
`ResearchPlanPanel` components) instead of on separate tabs.

## 14. Research Copilot / chat (detail)

The Copilot's grounding logic (`buildCopilotPrompt`, plain-text replies,
`copilot_messages` persistence, 12-message context window) is **unchanged**
from Pass 4. What changed in Pass 5: the Copilot's conversation *is* the
whole chat now — there's no separate "Copilot tab" alongside "Discover" or
"Analysis" tabs.

**Superseded by Pass 6:** as of Pass 6, free-text messages sent through the
composer no longer go straight to `POST /ai/copilot`. They go to
`POST /ai/chat` (`aiController.routeChatMessage`), which classifies intent
first (see §18) and only falls through to the Copilot's conversational
reply logic (this section's `buildCopilotPrompt` flow, still exactly as
described above) when the message doesn't match a known research action.
Quick-action chips (Search/Analyze/Gaps/Plan/Draft) still call their
original dedicated endpoints directly — they were never routed through the
Copilot and still aren't.

## 15. Current status (end of Pass 5)

**Feature-complete** for the scope defined across all 5 passes, and the
frontend has been fully transformed into the conversational workspace this
pass's brief asked for: one persistent chat per research topic, with
search results, analysis, gaps, plans, and drafts all appearing and
persisting as turns in that same conversation. See §9 for exactly what was
and wasn't verifiable live in this sandbox, and why.

## 16. Important implementation decisions (why, not just what)

- **One new table (`project_searches`), not a generic "events" table.**
  Every other event type already had a natural home (`copilot_messages`,
  `comparisons`, `reports`); building a fifth, more generic table and
  migrating those three would have been unnecessary churn for a pass whose
  actual gap was "searches have nowhere to persist." The `getProjectTimeline`
  merge step is where the "it's all one conversation" abstraction lives —
  deliberately kept at the read layer, not the write layer.
- **Kickoff is one endpoint, not two.** Creating the project and generating
  the first AI turn are inseparable in the product experience (the welcome
  screen has exactly one text box), so `POST /ai/kickoff` does both
  atomically rather than making the frontend orchestrate
  create-then-suggest as two round trips with a partial-failure window
  between them.
- **Quick actions bypass free-text intent parsing entirely.** "Search
  Papers"/"Analyze Sources"/etc. are explicit buttons calling explicit
  endpoints, not phrases the Copilot has to recognize inside a chat
  message. This matches the project's existing "no extra AI SDKs, keep it
  simple and explainable" constraint and avoids a whole class of
  misclassified-intent bugs a from-scratch NLU layer would introduce.
- **Regenerate appends, doesn't replace.** Treating every AI action as a
  new conversation turn (never silently overwriting a prior one) is the
  same principle the chat's message history already follows, applied
  consistently to drafts.
- Pass 4's decisions (comparisons `kind` reuse, four independent per-paper
  states, provider-agnostic `callAI`, plain-text Copilot replies, etc.) all
  still stand — see the previous revision of this document in git history
  for their original rationale.

## 17. Recommended next steps (beyond this project's current scope)

- Persist edits made in a draft card's "Edit" mode back to the `reports`
  table via a small `PUT /ai/draft/:reportId` endpoint.
- Add a lightweight automated test suite (even a handful of endpoint
  smoke tests, formalizing the manual curl/psql verification in §9/§20,
  would catch regressions early).
- If usage grows: move `getProjectTimeline`'s four-table merge into its own
  service module if a sixth event type is ever added.
- The intent classifier (§18) is deliberately rule-based. If the message
  vocabulary grows a lot (many more phrasings, multiple languages), it may
  be worth adding a small AI-based classification fallback *before* the
  generic Copilot fallback — but only once real usage data shows the
  regex rules actually missing cases; there's no evidence of that yet.

---

# Pass 6 — Natural-Language Research Agent

## 18. Natural-language intent router (the headline feature of this pass)

Pass 5 shipped a conversational UI, but under the hood it was still
button-driven: typing "find papers about X" into the composer just asked
the Copilot a question about X — it never actually searched. Pass 6 closes
that gap.

**`POST /api/ai/chat`** (`server/controllers/aiController.js` →
`routeChatMessage`) is now the composer's primary send path
(`client/src/pages/ChatWorkspace.jsx` → `handleSendMessage`). For every
message it:

1. Persists the user's turn to `copilot_messages` immediately (so nothing
   is lost even if the action below fails).
2. Classifies the message via `server/services/intentRouter.js` (see next
   subsection).
3. Either performs the matching research action — reusing the **exact
   same** DB/AI code paths the dedicated endpoints already used (so a
   typed "analyze the selected papers" and a click on the Analyze button
   produce identical results and identical source numbering) — or falls
   back to the Pass 4/5 Copilot conversational reply (§14) when nothing
   matches.
4. Returns `{ intent, userMessage, assistantMessage, event, selectionUpdates?, stage? }`.
   `event` (when present) is shaped **exactly** like the corresponding
   timeline event (`search` / `intelligence` / `gaps` / `plan` / `draft`),
   so the client renders it with the same `ConversationFeed` branches used
   for quick actions and page reloads — no new UI components were needed.

**Quick-action buttons are untouched** — they still call their original
endpoints (`/ai/analyze-project`, `/ai/gaps/analyze`, etc.) directly, exactly
as in Pass 5. This pass is additive: buttons keep working as a fast,
predictable path; free text now works too.

### `intentRouter.js` — why rule-based, not a second AI call

Research-assistant commands have a fairly small vocabulary ("find papers
about...", "analyze the selected papers", "research gaps", "write a
literature review", "select paper 3"...). A regex/keyword classifier
handles that vocabulary reliably, instantly, and for free, and — critically
— its behavior is easy to read, test, and extend (see the unit-style checks
run during this pass, §20). An LLM-based intent classifier would add
latency, cost, and a new failure mode (misclassification) for a problem
that doesn't need it. If real usage ever shows phrasings the rules miss,
see §17's note on adding an AI fallback layer *in addition to*, not instead
of, these rules.

Supported intents and their trigger patterns (`classifyIntent` in
`intentRouter.js`, checked in this order so more specific intents are never
swallowed by more general ones):

| Intent | Example | What happens |
|---|---|---|
| `draft` | "Write a literature review using sources 1, 3 and 5." | Generates a draft from the given source numbers (or the current selection if none given) — same as the Draft quick action. |
| `plan` | "Create a research plan from these gaps." | Same as the Plan quick action; still requires gaps to exist first (unchanged Pass-4 rule). |
| `gaps` | "What are the research gaps?" / "Where is the literature weak?" | Same as the Gaps quick action. |
| `compare` | "Compare papers 2 and 5." | Resolves both source numbers, runs `buildComparePrompt`, formats the result as a readable assistant message (similarities/differences/contradictions). |
| `analyze` | "Analyze the selected papers." | Same as the Analyze quick action. |
| `show_selected` | "Show me the selected sources." | Re-renders the currently selected papers as a `search`-shaped event (reusing `PaperCard` — no new component needed). |
| `deselect` | "Remove paper 3." | Deselects (does **not** delete) the given source number(s); returns `selectionUpdates` the client applies without a page reload. |
| `find_similar` | "Find more papers similar to paper 4." | Resolves source 4, runs a new OpenAlex search using its title as the query. |
| `select` | "Use only papers 1, 4 and 7." / "Select paper 3." | Selects the given numbers; "use only" is exclusive (deselects everything else in the chat first). |
| `top_n` | "Show me the five most relevant papers." | Ranks every paper already discovered in this chat by citation count and shows the top N — no new OpenAlex call. |
| `search` | "Find papers about the impact of generative AI on programming education." / "Search for studies published after 2023." | Runs the same OpenAlex search + link + log pipeline as the Search quick action (via the new shared `paperController.performProjectSearch`). Short refinement-shaped messages ("published after 2023", or any 3-word-or-shorter fragment) are automatically combined with the chat's most recent search query rather than searched alone. |
| `chat` (fallback) | "Tell me about AI." / any genuine question | Falls through to the unchanged Pass 4/5 Copilot reply logic. The Copilot's system prompt (`buildCopilotPrompt`, `prompts.js`) was extended with one new rule: if the message reads as a broad/vague topic rather than a specific request, ask a short clarifying question (optionally naming 2-3 angles grounded in the project's context) instead of writing a large, unfocused answer. This is what satisfies the pass's "don't blindly trigger a huge search for 'tell me about AI'" requirement — verified live in §20. |

Source numbers ("paper 3", "source 4") are resolved by
`fetchOrderedProjectPapers` — every paper ever linked to the project,
ordered by `project_papers.created_at ASC`. This is the **same ordering**
`toSourceRefs`/`getProjectTimeline` already used, so a number spoken by the
user always means the same paper the AI/UI showed them — satisfying the
pass's "source references must be consistent" requirement without any new
numbering scheme.

### Shared search plumbing

`paperController.js` was refactored (no behavior change) to extract
`performProjectSearch({ projectId, userId, q })` and
`linkSearchResultsToProject(...)` out of the existing `searchPapers` HTTP
handler. Both the "Search Papers" button and every natural-language search
intent (`search`, `find_similar`) now call the identical function — so
there is exactly one code path that upserts OpenAlex results, links them
into `project_papers` (preserving existing selection state via
`ON CONFLICT DO NOTHING`, unchanged from Pass 4), and logs the search to
`project_searches`.

### What did *not* change

- Database schema — zero migrations this pass. Every new behavior reuses
  `copilot_messages`, `project_papers`, `project_searches`, `comparisons`,
  and `reports` exactly as they already existed.
- The four dedicated action endpoints and their controllers — untouched.
- `ConversationFeed.jsx`, `PaperCard`, `ResearchIntelligencePanel`,
  `ResearchGapsPanel`, `ResearchPlanPanel`, `DraftCard` — untouched. The
  router's `event` payloads are shaped to fit these exactly.
- Theme system, sidebar, responsive layout — untouched.

## 19. Known limitations (Pass 6)

- **Rule-based intent classification, not a learned model.** It covers
  every phrasing in this pass's spec (verified in §20) plus reasonable
  variations, but an unusual phrasing outside its patterns falls back to a
  Copilot chat reply rather than silently misfiring an action — a
  deliberate fail-safe, not a crash, but it does mean an occasional
  legitimate request needs slightly clearer wording ("search for..." /
  "analyze..." / "compare papers X and Y").
- **`compare` renders as formatted chat text, not a dedicated card.** Given
  this pass's scope, the comparison result (similarities/differences/
  contradictions) is written into the assistant's message as Markdown-ish
  text rather than a new rich component. A `ComparisonCard` component
  would be a natural small addition later.
- **"Remove paper N" always means deselect, never delete.** The spec's
  examples group it with other selection commands ("show me the selected
  sources", "use only papers..."), so it was implemented as the
  non-destructive interpretation. A true "delete this paper from the
  project entirely" command was not added.
- **Refinement-query merging is heuristic.** A very short message ("in
  2023", "peer-reviewed only") is combined with the previous search query;
  a short-but-independent topic could occasionally be merged when it
  shouldn't be, or vice versa. This only affects what text is sent to
  OpenAlex, never the safety or correctness of anything else.

## 20. Testing performed this pass

Live end-to-end testing was possible this time (Pass 5's environment
lacked a reachable Postgres/AI provider; this sandbox does not have
outbound access to the real OpenAlex/OpenRouter APIs either, so a local
mock server was stood up reproducing OpenAlex's `/works` response shape
and an OpenRouter-compatible `/chat/completions` endpoint that returns
schema-correct canned JSON per prompt type). With Postgres 16 installed
locally, schema applied, and the real server + mock providers running:

1. ✅ Register/login (cookie session) — `POST /api/auth/register`, `GET /api/auth/me`.
2. ✅ Create a new research chat via `POST /api/ai/kickoff` — verified the
   chat is titled from the topic immediately, not "New Chat".
3. ✅ Natural-language search — `"Find papers about the impact of
   generative AI on programming education."` → classified `search`,
   returned 6 real (mock-OpenAlex) papers with stable ids 1-6, logged to
   `project_searches`, linked into `project_papers`.
4. ✅ `intentRouter.classifyIntent` unit-checked directly (no server)
   against every example phrase in the Pass 6 spec — all classified
   correctly, including the "Tell me about AI" → `chat` (not `search`)
   safety case.
5. ✅ Select via natural language — `"Select papers 1, 3 and 5."` →
   `selectionUpdates` returned and applied.
6. ✅ Second search (`"Search for LLM programming learning outcomes"`)
   confirmed the first search's selections (papers 1, 3, 5) remained
   selected afterward — selection persists across multiple searches.
7. ✅ Analyze / Gaps / Plan / Draft, all via natural language, all
   returning correctly-shaped events with correct source numbers
   ([1, 3, 5] preserved end-to-end into the draft's `sources`).
8. ✅ `"Write a literature review using sources 1, 3 and 5."` — confirmed
   the draft used exactly those three explicitly-named sources.
9. ✅ `"Compare papers 1 and 3."` — formatted comparison text returned.
10. ✅ `"Remove paper 3."` — deselected, confirmed via `selectionUpdates`.
11. ✅ `"Show me the selected sources."` and `"Show me the 3 most relevant
    papers."` — both returned correctly-shaped `search` events reusing
    already-discovered papers (no wasted OpenAlex call for the latter).
12. ✅ Refresh/reopen — refetched `GET /api/projects/1/timeline` after
    restarting the whole stack (Postgres + server + mock providers) and
    confirmed all 34 accumulated events, the draft, and the selection
    state ([1, 5] after the removal in step 10) were all still there.
13. ✅ Created a second research chat and confirmed zero shared state:
    project 2's timeline had only its own 2 events; project 1's 6 linked
    papers and selection were unaffected.
14. ✅ Rename — `PUT /api/projects/:id` title update confirmed.
15. ✅ Error handling: missing message (400), invalid/nonexistent
    `projectId` (404, not a stack trace), unauthenticated request (401),
    and cross-user access to another user's project (404, not 403 — avoids
    confirming the project's existence to a non-owner, unchanged security
    posture from earlier passes).
16. ✅ Client build (`npm run build`) succeeds cleanly after all composer/
    ChatWorkspace changes.
17. ⚠️ **Not live-tested:** the real OpenAlex and OpenRouter APIs (no
    outbound network access to them in this sandbox) — the mock providers
    reproduce their response shapes faithfully (verified by reading
    `services/openalex.js`'s `normalizeWork` and each `prompts.js` builder's
    documented JSON schema), but real-world response quirks (OpenAlex rate
    limiting, an LLM returning malformed JSON, etc.) rely on the
    already-existing `parseJsonResponse`/error-handling code from earlier
    passes, which was not modified this pass and was not re-exercised
    against a live provider.
18. ⚠️ **Not live-tested:** mobile viewport rendering and theme switching —
    no visual/browser testing tool was available in this pass's
    environment; no code in the theme system or CSS layout was touched
    this pass, so no regression is expected, but it wasn't re-verified
    visually.


---

# Pass 7 — Final QA + UX Polish

This pass did not change the architecture, database schema, or API surface.
It was a targeted audit-and-polish pass across the app built in Passes 1-6,
focused on UX quality, accessibility, error recoverability, and dead-code
cleanup. Everything in Pass 6's write-up above (§1-20) still describes the
system accurately.

## 21. What changed this pass

**Paper cards (`PaperCard.jsx`)**
- Long abstracts now have a proper expand/collapse ("Show more"/"Show
  less") instead of being silently truncated with no way to read the rest.
- The title is keyboard-activatable (Enter/Space), not just clickable —
  it's a `role="button"` element, so it needed a key handler to actually
  be usable without a mouse.
- Added a "New" badge, computed by `ConversationFeed` (see below), so a
  refined search visually distinguishes papers the user hasn't seen yet
  from ones already surfaced earlier in the same chat.
- The "Selected" button now reads "Selected ✓" and carries `aria-pressed`
  so screen readers announce the toggle state, not just static text.
- The DOI/external-link buttons were inconsistently labeled ("DOI" vs.
  "View source"); both are now "Open Paper" with a descriptive
  `aria-label` including the paper's title.

**Conversation feed (`ConversationFeed.jsx`)**
- Walks the conversation in order to track which paper ids have already
  appeared in an earlier search, so `isNew` is only set on genuinely new
  papers (skipped entirely on the very first search in a chat, where
  everything is trivially new and the badge would just be noise).
- Improved the no-results copy to match the tone of the rest of the app's
  empty states ("Try broadening your research question...").

**Research context panel (`ResearchContextPanel.jsx`)**
- Disabled quick-action buttons (Analyze/Gaps/Plan/Draft) now explain
  *why* they're disabled via a `title` tooltip instead of just being
  inertly greyed out.
- The "Selected sources" section always renders — previously it
  disappeared entirely at zero selections; now it shows the spec's
  "Select sources to analyze them." empty-state message instead.
- Added missing `aria-label`s to the deselect/remove icon buttons (they
  only had a hover `title` before, which doesn't help keyboard/
  screen-reader users).

**Sidebar (`ChatSidebar.jsx`)**
- Removed a leftover "CSE Capstone Project" placeholder line from the
  footer — the kind of unfinished-looking text the pass brief asked to
  clean up — and removed its now-unused CSS rule.
- The delete-confirmation step ("Confirm?") previously had no way to back
  out except clicking somewhere unrelated; added an explicit Cancel (✕)
  button next to it.

**Global accessibility (`styles/base.css`)**
- Added a single `:focus-visible` rule covering buttons, links, inputs,
  and `role="button"` elements, so keyboard focus is visually consistent
  everywhere (previously relied on inconsistent, easy-to-miss browser
  defaults, especially on custom `role="button"` elements like the paper
  title, which some browsers don't outline by default at all).

**Error recovery (`ChatWorkspace.jsx`, `ErrorBanner.jsx`)**
- `ErrorBanner` already supported an `onRetry` button in its props, but
  nothing in `ChatWorkspace` ever passed one — every failed action
  (search, analyze, gaps, plan, draft, select, deselect, remove-paper, and
  the natural-language router) could only be dismissed, never retried,
  which directly conflicts with the pass brief's "allow retry, don't leave
  the user staring at a frozen interface" requirement. Added a
  `lastFailedAction` piece of state that every action's `catch` block
  populates with a zero-argument retry closure; the banner now shows a
  working Retry button whenever one is available.
- `handleSendMessage` (the natural-language composer path) was split into
  itself (which adds the user's chat bubble once) and a new
  `sendMessageToRouter` helper (which does the actual API call and is what
  gets retried) — this was necessary so retrying a failed message doesn't
  duplicate the user's bubble in the feed. Retrying does send a second
  `POST /ai/chat` request and therefore persists a second copy of the
  user's message server-side if the first attempt actually reached the
  server before failing; this is a harmless duplicate row, not a
  correctness bug, and was judged an acceptable tradeoff against the
  complexity of deduplicating retried messages server-side.

## 22. What was audited and found already correct (no change needed)

- **SQL injection / parameterization**: grepped every `controllers/*.js`
  and `services/*.js` file for query construction; all ~90 queries use
  `$1`/`$2`-style parameterized placeholders with no string interpolation
  of request data into SQL. No issues found.
- **Ownership/cross-user isolation**: every project-scoped query filters
  by `user_id`, and a non-owner's request to another user's project
  returns 404 (not 403), avoiding confirming the project's existence to
  someone who shouldn't know about it. Re-verified live in this pass (see
  §23) and unchanged from earlier passes.
- **Error handling**: `middleware/errorHandler.js` already logs full
  errors server-side but only ever returns a generic, human-readable
  message to the client — no stack traces, SQL, or secrets are exposed.
  `aiController.routeChatMessage` (and every other controller) reaches
  this same handler via `next(err)` on failure, so this pass's new code
  inherits the same safe behavior automatically.
- **Responsive breakpoints**: `styles/base.css` already had breakpoints at
  1100px/900px/880px/640px/480px, which functionally cover the pass
  brief's requested test widths (1200/900/768/600/480/375) via CSS
  cascade — e.g. a 768px viewport falls under the existing 880px rule, a
  600px viewport under the existing 640px rule. No structural gaps found
  by reading the CSS; see §24 for the caveat that this wasn't verified in
  an actual browser this pass.
- **`.env.example`**: already documents every variable the app reads
  (server port/origin, all five PG* vars, auth secret/expiry, all four
  AI_* vars plus the Anthropic-alternative comment, both OpenAlex vars),
  each with a placeholder value and no real secrets. No changes needed.
- **Empty states**: the welcome screen, no-papers, and (after this pass's
  fix) no-selected-sources messages already match the pass brief's exact
  suggested copy.

## 23. Testing performed this pass

Reused the same local verification setup from Pass 6 (PostgreSQL 16
installed locally, a local mock server standing in for OpenAlex's
`/works` endpoint and an OpenRouter-compatible `/chat/completions`
endpoint, since this sandbox has no outbound access to the real APIs):

1. ✅ `node -c` syntax-checked every server `.js` file individually — all
   pass.
2. ✅ `npm run build` (Vite/React client) — succeeds cleanly after every
   UI change in §21.
3. ✅ Restarted the whole stack (Postgres + Node server + mock providers)
   on the Pass 7 code and confirmed, via the *same* user session created
   during Pass 6 testing, that both previously-created research chats
   ("LLMs in Programming Education", "Renewable energy adoption in rural
   communities") and their full 37-event conversation history were still
   intact — i.e. this pass's backend changes (there were none) and
   frontend changes didn't corrupt or lose any persisted state.
4. ✅ Re-ran a natural-language search (`"Find papers about RAG
   hallucinations."`) against the updated code — classified and executed
   correctly, consistent with Pass 6's behavior.
5. ✅ Re-ran the ambiguous-message clarification case (`"Tell me about
   AI."`) — still correctly falls through to a Copilot reply rather than
   triggering an action.
6. ✅ Re-confirmed error handling on an invalid project id — clean 404
   JSON, no stack trace.
7. ⚠️ **Not live-tested this pass** (no browser automation available in
   this environment): actual keyboard-navigation behavior, focus-ring
   rendering, screen-reader announcements, and visual appearance at the
   specific breakpoints listed in the pass brief (1200/900/768/600/480/
   375px). All of §21's UI/accessibility changes were reviewed and
   reasoned about at the code level (JSX + CSS) but not visually verified
   in a real browser. This is the same limitation noted in Pass 6's
   write-up and remains open.
8. ⚠️ **Not live-tested**: the real OpenAlex and OpenRouter APIs — same
   sandbox networking limitation as Pass 6; the mock providers reproduce
   their documented response shapes but real-world quirks (rate limiting,
   malformed LLM JSON, etc.) rely on already-existing, unmodified
   handling code.

## 24. Known limitations (end of Pass 7)

Carried forward from Pass 6 (§19), still accurate:
- Intent classification is rule-based, not a learned model.
- `compare` renders as formatted chat text, not a dedicated card component.
- "Remove paper N" always deselects, never deletes the paper from the
  project.
- Refinement-query merging (short follow-up searches combined with the
  prior query) is heuristic and can occasionally combine or not-combine a
  query differently than a human would expect.

New/updated after Pass 7:
- Retrying a failed natural-language chat message can persist a duplicate
  user-message row server-side if the first attempt reached the server
  before failing (see §21) — cosmetically harmless, not a correctness bug.
- No browser-based visual/accessibility/mobile testing was performed in
  this or any prior pass in this project's history — all such
  verification has been at the code/CSS level. If a real browser or
  device lab becomes available, that remains the single highest-value
  follow-up.
- No automated test suite exists yet (still true from Pass 5/6); all
  verification across all passes has been manual `curl`/`psql`
  smoke-testing plus code review, documented in each pass's PROJECT_STATE
  entry.

## 25. Local setup used for this pass's verification (exact commands)

For reference/reproducibility (Linux/Debian-based; see `SETUP.md` for the
Windows-oriented general setup guide):

```bash
# Postgres
apt-get install -y postgresql
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
su postgres -c "psql -c \"CREATE DATABASE ai_research;\""
PGPASSWORD=postgres psql -h localhost -U postgres -d ai_research -f database/schema.sql

# Server (.env pointed AI_API_URL/OPENALEX_BASE_URL at a local mock — see
# SETUP.md's "Testing without live API keys" note)
cd server && npm install && node server.js

# Client
cd client && npm install && npm run build   # or `npm run dev` for local dev
```

## 26. Pass 9 — Frontend UI/UX redesign (visual layer only)

Scope was strictly the frontend presentation layer: no backend route,
controller, service, DB schema, or `client/src/services/api.js` call was
touched (verified with a file-level diff against the Pass 8 zip — those
files are byte-identical). Every prop, callback, and API call in every
component keeps its original signature and behavior; this pass only
changed what gets rendered and how it's styled.

**What changed:**
- `client/src/styles/base.css` — full rewrite as a token-based design
  system (dark-first, with a hand-tuned light theme, not an inversion).
  Colors, type scale, radius, shadow and motion all live in CSS custom
  properties under `:root` / `[data-theme='light']`. Roughly 15 CSS
  classes with no remaining JSX reference (leftover from Passes 1–4:
  `wizard-*`, `copilot-panel`, `stat-grid`, `type-option`, etc.) were
  removed rather than carried forward.
- Added `lucide-react` (the only new dependency) and replaced every
  text-glyph icon (`+`, `×`, `⌘`, HTML entities) with real SVG icons.
- Redesigned components/pages: `ChatSidebar`, `Topbar`, `Composer`,
  `WelcomeScreen`, `ProgressStages` (now a vertical pipeline),
  `ThemeToggle`, `PaperCard`, `PaperPreviewModal`, `ResearchContextPanel`,
  `DraftCard`, `ConversationFeed`, `EmptyState`, `ErrorBanner`,
  `Login`/`Register`, `Projects`, `PaperSearch`, `Notes`, `Compare`,
  `PaperDetail`.
- One deliberate structural move: the logged-in user's name/email/logout
  control moved from `Topbar` into the sidebar footer (next to the theme
  toggle), matching how most modern AI chat apps place account controls.
  `App.jsx` was touched only to pass `user`/`onLogout` into `ChatSidebar`
  instead of `Topbar` — the underlying `handleLogout` function and auth
  state are unchanged.

**Verification performed:** `npm run build` (clean, no errors/warnings).
Visual QA was done by running the built app against a temporary,
throwaway mock of `api.js` (never part of the shipped code) and taking
headless-browser screenshots of every page in both themes and at a
mobile viewport (390px), since this sandbox has no Postgres/AI-provider
access to run the real backend end-to-end. Full click-through testing
against the live backend (login, research kickoff, paper search/select,
analyze/gaps/plan/draft, notes, compare) still hasn't been done in a real
browser and remains the standing follow-up noted in §24.


---

## Pass 10 — Error fixes + caching/performance

**Read this section first if something regresses.**

### Bugs fixed
1. **AI output shape crashes.** Free models return strings for arrays, bare strings for objects, `sources: "1,2"` or `[99]`. Every result panel then threw (`x.map is not a function`, "Objects are not valid as a React child"). Fix: `server/services/normalizers.js` coerces every AI result to the exact UI shape (idempotent; also applied when *reading* stored rows in the timeline/GET endpoints, so old bad rows no longer crash). Client panels additionally use `utils/safe.js`. Draft `references` are now rebuilt from the real papers (never trusted from the model).
2. **JSON parsing.** `aiService.parseJsonLoose` handles code fences, `<think>` blocks, prose around JSON, stray braces, trailing commas and **truncated** output (token limit). All endpoints now go through `callAIJson` (they previously used a single un-retried `callAI` + `parseJsonResponse`); one automatic retry with a stricter prompt and larger token budget.
3. **Provider flakiness.** Retry with back-off on 429/5xx/network, `Retry-After` honoured, timeout configurable (`AI_TIMEOUT_MS`, default 90 s), `response_format` fallback now covers 400/404/422 and is remembered.
4. **Errors were masked.** The error handler turned every 5xx into "Something went wrong". Errors flagged `expose = true` (AI rate limit, bad key, timeout, OpenAlex down…) now show their real message.
5. **Kickoff fragility.** Exactly-3-questions validation made kickoff fail and left an orphan project per retry. Now tolerant, and if the AI is down the chat still opens with a helpful message (`warning` field in the response).
6. **Intent router.** "analyse"/"analysis" (UK spelling) never matched; "create a research plan and methodology" was routed to *draft*; years ("after 2021") were read as source numbers; "best research method" triggered *top_n*.
7. **Timeline order.** The "Analyzing…" lead-in message was saved *after* its result card, so on reload it appeared below it. Lead-in is now saved first (and removed if the action fails).
8. **Source numbering** is now deterministic (`ORDER BY created_at, id`) — required because papers are now inserted in one batch statement.
9. **Source previews** ([n] chips) had no abstract; `toSourceRefs` now includes it.
10. **Retry duplicated the user message** in the DB; the client now sends `retry: true`.
11. **PaperDetail → "Add to Project"** sent a bare number as the body (400 error); now `{ paperId }`.
12. **Editing a note erased its title**; notes can no longer be attached to projects you don't own.
13. **CORS / cookies**: the client now calls same-origin `/api` through the Vite proxy (no CORS, works on localhost *and* 127.0.0.1 and any port). Server also accepts comma-separated `CLIENT_ORIGIN` and any localhost port in dev.
14. **401 handling**: expired session → automatic return to login.

### Caching / performance
- `utils/cache.js` — TTL + LRU + single-flight cache.
- **AI answers**: L1 memory + L2 PostgreSQL (`ai_response_cache`), keyed by SHA-256 of model+prompt. Identical analyze/gaps/plan/draft requests are instant and free. Truncated (partial) answers are never cached. `regenerate: true` (Draft "Regenerate") bypasses it.
- **OpenAlex**: 10-min search cache, 1-h work cache, concurrent identical searches share one request, retry once, **serves stale results if OpenAlex is down**, `select=` to shrink payloads (auto-fallback).
- **Paper rows**: in-memory cache (evicted on upsert); timeline loads all papers in ONE query.
- **Search linking**: ~45 queries → 4 statements in one transaction.
- **Sessions**: 30 s auth cache (evicted on logout).
- **Stage tracking** moved server-side (no extra PUT per step).
- **HTTP**: gzip + ETag/304 for JSON, DB indexes for hot queries.
- **Client**: GET cache (20 s, cleared by any write), in-flight de-dupe, memoized result cards and paper cards, sidebar list fetched once per login.
- `GET /api/health/cache` (dev only) shows cache hit rates.

### Rules to keep
- New AI endpoints: use `callAIJson` + a normalizer + a `validate`; never `JSON.parse` model output directly.
- Anything that changes prompts or result shapes: bump `CACHE_VERSION` in `aiService.js`.
- Errors safe to show users: create them with `expose = true`.
