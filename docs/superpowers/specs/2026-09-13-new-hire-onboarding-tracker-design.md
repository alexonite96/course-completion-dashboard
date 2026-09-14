# New Hire Onboarding Tracker — Design

**Date:** 2026-09-13
**Status:** Approved
**Purpose:** New feature inside the existing `course-completion-dashboard` app. Tracks each new hire's "Jump Start" onboarding journey (Week 1 plan, shared by everyone; Week 2 plan, which varies by role) and flags anyone falling behind schedule so managers can be prompted to follow up. Current milestone: proof of concept — no LMS API access exists yet, so data arrives as two Excel uploads.

## Overview

The enablement team uploads two files:

1. **Master file** — the "Jump Start" new-hire roster (name, department, role, hiring manager, country, JS start date, etc.), plus a "JS LPs" reference sheet listing every Week 1/Week 2 learning plan and which audience/department/region it's for.
2. **Learning Plan Completion Report** — a Dayforce export, one row per (employee, course), showing enrollment and completion dates. This report also contains non-new-hires who were enrolled in the same plans for other reasons, so it cannot be used alone.

The app cross-references the two: only people who appear in the master file are new hires worth tracking. For each, it determines which Week 1 and Week 2 plans apply, checks completion against fixed deadlines, and renders each hire's onboarding journey — both as an aggregate dashboard for the enablement team and as a manager-scoped view.

This is explicitly a **proof-of-concept phase**: matching and mapping are fully automatic (no manual correction UI yet), and manager access is an unauthenticated stand-in link rather than real SSO.

## Requirements

### Functional

**Data ingestion**
- Accept upload of the master file (`Jump Start` sheet + `JS LPs` sheet) and the Learning Plan Completion Report (single data sheet, header row is the second row — the first row is Dayforce's filter-summary text).
- Master file parsing skips fully blank rows; rows with a name but no hire/JS date are kept and flagged "no start date."
- Handles Excel date cells that come through as raw serial numbers (not just already-parsed dates) — convert using the same serial-to-ISO approach as the existing course-completion upload path, timezone-independent.
- Completion report is rolled up from per-course rows to one row per (employee, learning plan): plan is "Complete" if `Learning Plan Completion Date` is present, otherwise "In Progress" (with a completed/total course count) or "Not Started" if no enrollment row exists for that plan at all.

**Identity matching (master ↔ completion report)**
- No shared ID exists between the files (master has no email; completion report has no employee number). Matching is done on normalized name comparison:
  - Normalize: lowercase, strip diacritics/accents, collapse whitespace, drop punctuation.
  - Tier 1 — exact normalized full-name match: high confidence, auto-linked.
  - Tier 2 — token match: the completion report's last-name token(s) appear within the master record's combined name, and the first name matches exactly or via a small common-nickname table (e.g. "Divya"/"Divs"); auto-linked.
  - No match above tier 2 → the master-file hire is still shown on the dashboard, status "No training data found," rather than being dropped.
- Confirmed links are keyed by **EE#** and persisted, so repeat uploads don't need to re-derive a match for someone already linked. (A manual correction UI for wrong auto-matches is deferred — noted in Out of Scope.)

**Role → Learning Plan mapping**
- A mapping table (seeded from the `JS LPs` sheet) connects a hire's `Role` (and `Department`/`Country` where needed for regional variants) to the specific Week 2 Learning Plan title that applies to them. Week 1 is the same plan for everyone.
- Editable in-app: enablement can add/adjust Role-pattern → Learning Plan rules without a redeploy.
- A hire whose Role matches no rule is labeled **"Unmapped"** and still shown (not silently miscategorized), so gaps in the mapping surface naturally as new roles appear.

**Status & deadlines**
- Week 1 deadline: JS Date + 7 calendar days. Week 2 deadline: JS Date + 14 calendar days.
- Per-plan status: `Complete`, `In Progress`, `Overdue` (past deadline, incomplete), `Not Started` (no enrollment record).
- Overall hire status = the worse of the Week 1 and Week 2 statuses.
- Hires with no JS Date can't have deadlines computed; shown as "Start date missing."

**Dashboard (enablement team view)**
- Stat tiles: Total New Hires, On Track, Behind (Overdue), Not Started — scoped to a date filter defaulting to **JS Date within the last 30 days**, adjustable to see full history.
- Filterable/searchable/sortable table: one row per hire (name, role, manager, Week 1 status, Week 2 status, overall status).
- Clicking a row opens a journey drill-down panel: JS Date, Week 1 plan (courses + completion), Week 2 plan (courses + completion), computed deadlines, current status — the "story" of that hire's onboarding.
- CSV export of Overdue/Behind hires, grouped by Hiring Manager.

**Manager view**
- A per-manager link (URL keyed by a slug derived from the `Hiring Manager` name in the master file) shows the same journey-focused UI, scoped to only that manager's hires. Read-only — no upload capability.
- No login/password. Explicitly a temporary stand-in until Cloudflare Access is available (see Out of Scope); the UI should say so.

### Non-functional
- Reuses the existing Worker + D1 deployment; light data volume (hundreds of rows), fits comfortably in Cloudflare's free tier.
- POC-quality polish is acceptable; correctness of matching/status logic matters more than visual polish at this stage.

### Out of scope (future phases)
- Real authentication (Cloudflare Access / SSO) for managers — same blocker as the parent app.
- Manual match-correction UI for wrong auto-matches (rely on the two-tier automatic matcher for now).
- Automated email/notification delivery to managers.
- Direct API integration with the LMS (Excel upload is the stand-in until that exists).

## Architecture

Extends the existing single Cloudflare Worker (Hono API + React/Vite/TS static assets) and D1 database — no new services.

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | New "Onboarding" route alongside existing Dashboard/People routes |
| Excel parsing | SheetJS (`xlsx`), in the browser | Same library already in use; new parsers for the two new file shapes |
| API | Hono on the Worker | New endpoint group under `/api/onboarding/*` |
| Database | Cloudflare D1 | New tables, described below |
| Manager view | Same Worker, different route (`/onboarding/m/:slug`) | No auth middleware — filters by matching slug server-side |

## Data model

```sql
CREATE TABLE new_hires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ee_number TEXT UNIQUE,            -- NULL if missing in source; used as match key across uploads
  full_name TEXT NOT NULL,
  department TEXT,
  role TEXT,
  hiring_manager TEXT,
  manager_slug TEXT,                -- derived from hiring_manager, for manager-view links
  country TEXT,
  hire_date TEXT,                   -- ISO 8601 or NULL
  js_date TEXT,                     -- ISO 8601 or NULL
  updated_at TEXT NOT NULL
);

CREATE TABLE learning_plan_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  category TEXT,                    -- 'Week 1' or 'Week 2+'
  audience TEXT,
  department TEXT,
  region TEXT
);

CREATE TABLE role_plan_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_pattern TEXT NOT NULL,       -- exact or partial match against new_hires.role
  department_pattern TEXT,          -- optional additional filter
  country_pattern TEXT,             -- optional additional filter (for regional variants)
  learning_plan_title TEXT NOT NULL REFERENCES learning_plan_defs(title),
  priority INTEGER NOT NULL DEFAULT 0  -- higher priority rules checked first, for overlapping patterns
);

CREATE TABLE plan_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_hire_id INTEGER REFERENCES new_hires(id),
  learning_plan_title TEXT NOT NULL,
  enrollment_date TEXT,
  completion_date TEXT,             -- NULL = not complete
  courses_total INTEGER NOT NULL DEFAULT 0,
  courses_completed INTEGER NOT NULL DEFAULT 0,
  match_confidence TEXT NOT NULL,   -- 'exact' | 'token' — a row only exists here once a match is found
  updated_at TEXT NOT NULL,
  UNIQUE (new_hire_id, learning_plan_title)
);

CREATE TABLE onboarding_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type TEXT NOT NULL,          -- 'master' | 'completion_report'
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_processed INTEGER NOT NULL,
  rows_matched INTEGER,
  rows_unmatched INTEGER
);
```

All dashboard stats and status computations are derived at read time from `new_hires` + `plan_completions` + `role_plan_mapping` — no stored aggregates to drift.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/onboarding/uploads/master` | Body: parsed master-file rows + JS LPs rows. Upserts `new_hires` by `ee_number`, upserts `learning_plan_defs`. |
| `POST /api/onboarding/uploads/completion-report` | Body: parsed completion-report rows. Runs the name-matching tiers against `new_hires`, upserts `plan_completions`. Returns match summary (matched/unmatched counts). |
| `GET /api/onboarding/hires` | All hires with their raw completions, for the dashboard table. Status/deadline computation and the recency-window filter happen client-side (`src/lib/onboardingStatus.ts`) so a role-mapping edit takes effect without re-fetching. |
| `GET /api/onboarding/manager/:slug` | Hires scoped to one manager, for the manager view. |
| `GET /api/onboarding/mapping` / `POST /api/onboarding/mapping` / `DELETE /api/onboarding/mapping/:id` | Read/add/remove `role_plan_mapping` rules. |

The per-hire journey drill-down and the CSV export of overdue hires are both computed client-side from the already-fetched hire list (`src/lib/onboardingStatus.ts`, `src/lib/onboardingCsv.ts`) rather than as separate endpoints — consistent with how the parent app's dashboard already computes stats client-side.

## Upload flow

1. Enablement uploads the master file first. Rows are parsed and previewed (counts, skipped rows with reasons) before committing to `POST /api/onboarding/uploads/master`.
2. Enablement uploads the completion report. Parsed and previewed, then `POST /api/onboarding/uploads/completion-report` runs matching against the already-stored `new_hires` and reports match tiers (auto-matched exact / auto-matched token / unmatched counts).
3. Dashboard refetches and shows current status for every hire, including unmatched ones.

## Error handling

- Missing required columns in either file → names exactly which headers weren't found, nothing imported.
- Rows with no name → skipped, counted, reported.
- Unparseable/serial-number dates → converted where possible; if truly unparseable, hire is kept with "no start date" rather than dropped.
- No match found for a completion-report row against any `new_hire` → row is ignored for onboarding purposes (it's presumably a non-new-hire who got enrolled for other reasons, per the original problem statement).
- No match found for a `new_hire` against completion-report data → hire still shown, status "No training data found."
- Duplicate (new_hire, learning_plan_title) rows within one completion-report upload → most recent completion/enrollment date wins.
- Role matches no `role_plan_mapping` rule → hire shown with Week 2 status "Unmapped" instead of a guessed plan.

## Testing

- Unit tests for the two highest-risk areas:
  - Name normalization and the two-tier matcher: accented characters, nickname table, compound surnames, no-match cases.
  - Status/deadline computation: on-time, overdue, not-started, missing-start-date, and the "worse of Week 1/Week 2" rollup.
- Local `wrangler dev` check with a sample master file + sample completion report before deploy.

## Deployment

- Committed to the existing `course-completion-dashboard` GitHub repository first; Cloudflare deployment (`wrangler deploy`) happens only after the GitHub commit, per explicit request — not pushed straight to Cloudflare.
