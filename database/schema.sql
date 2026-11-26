-- ============================================================
-- AI Research Assistant - PostgreSQL Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    password_salt   TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS research_projects (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(255) NOT NULL,
    research_question TEXT,
    description       TEXT,
    notes             TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON research_projects(user_id);

CREATE TABLE IF NOT EXISTS papers (
    id              SERIAL PRIMARY KEY,
    openalex_id     VARCHAR(255) UNIQUE,
    title           TEXT NOT NULL,
    authors         TEXT,
    abstract        TEXT,
    publication_year INTEGER,
    source_name     VARCHAR(500),
    doi             VARCHAR(255),
    paper_url       TEXT,
    cited_by_count  INTEGER,
    raw_metadata    JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_papers (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_papers(user_id);

CREATE TABLE IF NOT EXISTS project_papers (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_projpapers_project ON project_papers(project_id);

CREATE TABLE IF NOT EXISTS analyses (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id    INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    content     JSONB NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);

CREATE TABLE IF NOT EXISTS comparisons (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_ids   INTEGER[] NOT NULL,
    content     JSONB NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comparisons_user ON comparisons(user_id);

CREATE TABLE IF NOT EXISTS notes (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES research_projects(id) ON DELETE CASCADE,
    paper_id    INTEGER REFERENCES papers(id) ON DELETE SET NULL,
    title       VARCHAR(255),
    content     TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);

CREATE TABLE IF NOT EXISTS reports (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES research_projects(id) ON DELETE CASCADE,
    paper_ids   INTEGER[] NOT NULL,
    content     JSONB NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);

-- ============================================================
-- Pass 1: Research Workspace Foundation
-- Additive, idempotent columns — safe to re-run against an existing
-- database. No existing data/columns are altered or dropped.
-- ============================================================
ALTER TABLE research_projects ADD COLUMN IF NOT EXISTS research_objective TEXT;
ALTER TABLE research_projects ADD COLUMN IF NOT EXISTS research_type VARCHAR(50);
ALTER TABLE research_projects ADD COLUMN IF NOT EXISTS stage VARCHAR(30) NOT NULL DEFAULT 'define';
-- stage tracks the research journey: define -> discover -> analyze -> gaps -> plan -> create
-- research_type is one of: literature_review, research_paper, final_year_project,
--   thesis_dissertation, research_proposal, general_research (validated in app code,
--   not a DB enum, to keep the schema simple to extend).

-- ============================================================
-- Pass 2: Intelligent Paper Discovery
-- Additive column distinguishing "linked to this project" (a project_papers
-- row exists) from "selected for analysis" (this flag). Deselecting keeps
-- the paper associated with the project (e.g. for reference) without
-- including it in the next AI analysis pass; removing it deletes the row.
-- ============================================================
ALTER TABLE project_papers ADD COLUMN IF NOT EXISTS selected_for_analysis BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- Pass 3: AI Research Analysis
-- Reuses the existing `comparisons` table (already: user_id, paper_ids[],
-- content JSONB) for the new project-level "Research Intelligence" result
-- instead of creating a new table. `kind` distinguishes the original
-- ad-hoc Compare-Papers flow ('comparison', the default, so existing rows
-- are unaffected) from the new project-scoped flow ('research_intelligence').
-- `project_id` is nullable because old comparisons rows aren't tied to a
-- project.
-- ============================================================
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES research_projects(id) ON DELETE CASCADE;
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS kind VARCHAR(30) NOT NULL DEFAULT 'comparison';
CREATE INDEX IF NOT EXISTS idx_comparisons_project ON comparisons(project_id);

-- ============================================================
-- Pass 4: Research Gaps, Research Plan & Research Copilot
-- Gaps and Plan reuse the `comparisons` table again (kind='research_gap',
-- kind='research_plan') — same pattern as Pass 3's 'research_intelligence',
-- deliberately not a new table per result type.
-- Copilot chat history has no existing table to reuse, so it gets its own
-- (new, additive — does not touch any existing table).
-- ============================================================
CREATE TABLE IF NOT EXISTS copilot_messages (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_project ON copilot_messages(project_id, user_id, created_at);

-- ============================================================
-- Pass 5: Conversational Research Workspace (Chat UI)
-- One research chat = one research_projects row (unchanged). This pass
-- turns the project workspace into a single persistent conversation by
-- merging several existing tables (copilot_messages, comparisons, reports)
-- with ONE new table for the one thing that previously had nowhere to
-- persist: literature searches run inside a project. Additive only.
-- ============================================================
CREATE TABLE IF NOT EXISTS project_searches (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query       TEXT NOT NULL,
    paper_ids   INTEGER[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_searches_project ON project_searches(project_id, user_id, created_at);

-- research_projects.description already doubles as "the original free-text
-- research topic the chat was started from" — no new column needed. A chat
-- with no papers/analysis yet is simply a project at stage='define'.

-- ============================================================
-- Pass 10: Performance + caching (additive, idempotent)
-- ai_response_cache: persistent L2 cache of structured AI answers keyed by a
-- SHA-256 of (model + prompt). Identical requests (same sources, same
-- project context) are answered instantly and cost no AI call. Entries
-- expire after AI_CACHE_TTL_HOURS (default 168) and are pruned at startup.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_response_cache (
    cache_key   CHAR(64) PRIMARY KEY,
    response    JSONB NOT NULL,
    model       TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_response_cache(created_at);

-- Indexes for the hot paths: chat timeline, source numbering (ordered by
-- created_at, id), "latest result of kind X" lookups and the "analyzed" flag.
CREATE INDEX IF NOT EXISTS idx_projpapers_order ON project_papers(project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_comparisons_latest ON comparisons(project_id, user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analyses_paper_user ON analyses(paper_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
