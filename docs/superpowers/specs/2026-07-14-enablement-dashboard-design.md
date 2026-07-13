# Daymaker Course Completion Dashboard — Design

**Date:** 2026-07-14
**Status:** Approved
**Purpose:** Internal dashboard for the enablement team to track course completion across employees ("Daymakers"), fed by Excel exports from the learning system. Current milestone: a working demo to show management; SSO and role-based features come later.

## Overview

A single-page web app deployed on Cloudflare. The enablement team uploads an Excel export; the app parses it in the browser, stores per-person-per-course records in a database, and renders a dashboard of completion stats. Data is persistent and shared — anyone opening the URL sees the same data. Re-uploading updates existing records.

## Requirements

### Functional
- Accept an Excel (.xlsx) upload containing, at minimum, these columns (matched by header name; extra columns ignored):
  - Employee First Name, Employee Last Name, Business Email, Job Assignment, Course Title, Course Start Date, Course Completion Date, Manager
- A row is **Completed** when Course Completion Date has a value; otherwise **Pending**.
- Dashboard stat tiles (all scoped to the currently selected course):
  - **Total Daymakers** — count of enrollments for the selected course
  - **Completed** — count with a completion date
  - **Pending** — count without a completion date
  - **Completion rate** — Completed / Total, shown as a percentage ring
  - **Managers** — count of distinct names in the Manager column among the selected course's rows
- **Completion-by-manager chart** — horizontal bars ranking each manager's team completion rate.
- **Searchable people table** — name, email, job assignment, manager, status, completion date; search and sort.
- **Export pending list** — one-click CSV download of everyone still pending.
- **Upload merge semantics: upsert by (email, course title).** Existing records are updated; new people are inserted; people absent from a new file are retained.
- Multi-course capable data model. Today's exports contain one course; the UI has a course switcher for when more arrive.
- Data persists across refreshes, browser closes, and devices (server-side storage, not browser storage).

### Non-functional
- Light app: a few hundred rows per course, occasional uploads. Must fit Cloudflare free tier.
- Demo-ready polish; this will be shown to management.

### Out of scope (future phases)
- SSO / Cloudflare Access enforcement (planned; see Future-proofing)
- Role-based access control
- Audit page UI ("who changed what")
- Direct API integration with the learning system

## Architecture

One **Cloudflare Worker** serves both the static frontend and the JSON API, backed by **D1** (Cloudflare's SQLite database). Single `wrangler deploy` ships everything.

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Styling | Tailwind CSS |
| Excel parsing | SheetJS (`xlsx`), in the browser |
| API | Hono on the Worker |
| Database | Cloudflare D1 |
| Charts | Styled divs (horizontal bars) — no chart library |

**Why D1 over alternatives:** browser storage (localStorage/IndexedDB) is per-device, failing the shared-persistence requirement. Workers KV would force read-modify-write of a whole JSON blob per upload; D1 gives real upserts in one SQL statement and scales cleanly to multiple courses.

### Layout (approved via mockup)

Sidebar navigation + hero header hybrid:
- **Sidebar:** Dashboard and People pages; course switcher pinned at the bottom.
- **Dashboard page:** dark hero header with course title, "last upload" timestamp and row count, an Upload Excel button, a completion-rate ring, and inline stat numbers (Total Daymakers, Completed, Pending, Managers). Below the hero: completion-by-manager bar chart and a pending-list export.
- **People page:** full searchable/sortable table.

## Data model

```sql
CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_assignment TEXT,
  course_title TEXT NOT NULL,
  course_start_date TEXT,        -- ISO 8601 or NULL
  course_completion_date TEXT,   -- ISO 8601; NULL = pending
  manager TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (email, course_title)
);

CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_processed INTEGER NOT NULL,
  rows_inserted INTEGER NOT NULL,
  rows_updated INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  uploaded_by TEXT               -- NULL until SSO; then Cf-Access-Authenticated-User-Email
);
```

All dashboard stats are computed from `enrollments` at read time — no stored aggregates to drift.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/enrollments?course=<title>` | All rows for a course. Frontend computes stats, chart data, search/sort, and CSV export client-side. |
| `GET /api/courses` | Distinct course titles + last-upload metadata, for the course switcher and hero. |
| `POST /api/uploads` | Body: parsed rows (JSON). Upserts each by (email, course_title), records a row in `uploads`, returns insert/update/skip counts. |
| `GET /api/uploads` | Upload history — data source for the future audit page. |

Upsert statement: `INSERT ... ON CONFLICT (email, course_title) DO UPDATE`.

## Upload flow

1. User clicks **Upload Excel** and picks a `.xlsx` file.
2. Browser parses it with SheetJS. Columns are matched by header name, case-insensitively and tolerant of surrounding whitespace; extra columns are ignored.
3. Preview shown before committing: rows found, courses found, rows skipped (missing/invalid email) — with reasons.
4. On confirm, rows POST to `/api/uploads`; the Worker upserts and logs the upload.
5. Dashboard refetches and shows updated numbers plus the new "last upload" stamp.

## Error handling

- **Missing required columns** → error names exactly which headers were not found; nothing is imported.
- **Rows without a Business Email** → skipped, counted, and reported in the preview; never silently dropped.
- **Dates:** Excel numeric serial dates and text dates both parsed to ISO. Unparseable completion date → treated as pending, surfaced as a warning in the preview.
- **Duplicate (email, course) within one file** → last row wins.
- **Empty file / wrong file type** → clear message, nothing imported.
- **API/database failure during upload** → the upload is not recorded as successful; user sees an error and can retry (upsert makes retries safe).

## Future-proofing (designed for, not built)

- **SSO:** enable Cloudflare Access in front of the Worker — zero code changes to gate access. The Worker will then read `Cf-Access-Authenticated-User-Email` and populate `uploads.uploaded_by`.
- **Audit page:** reads `uploads` history, which is collected from day one.
- **Role-based access:** once identities exist via Access, roles can gate the upload endpoint vs read-only viewing.

## Testing

- **Vitest unit tests** for the two risky areas:
  - Excel parsing/column mapping: header variations, Excel serial dates vs text dates, missing values, skipped rows.
  - Upsert logic: insert vs update counts, retained records absent from new files, duplicate handling.
- **Local end-to-end check** with `wrangler dev` (local D1) and a sample spreadsheet before each deploy.

## Deployment

- New GitHub repository (working name: `course-completion-dashboard`).
- Cloudflare Worker with static assets + D1 binding, deployed via `wrangler deploy`.
- Free tier throughout (D1 free tier: 5 GB storage, 5M reads/day — orders of magnitude above this app's needs).
