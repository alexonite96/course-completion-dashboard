# Course Completion Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare-hosted dashboard where the enablement team uploads Excel exports and sees course completion stats for Daymakers, persisted in D1.

**Architecture:** One Cloudflare Worker serves the built React frontend as static assets and a Hono JSON API backed by D1 (SQLite). Excel files are parsed in the browser with SheetJS; parsed rows POST to the API which upserts by (email, course_title) and records upload history. All stats are computed from enrollment rows at read time.

**Tech Stack:** React 18 + Vite + TypeScript, Tailwind CSS v4, Hono, Cloudflare Workers + D1, SheetJS (`xlsx`), Vitest, better-sqlite3 (tests only).

**Spec:** `docs/superpowers/specs/2026-07-14-enablement-dashboard-design.md`

**Working directory for all commands:** `C:/Users/Alexa/OneDrive/Documents/Claude/Projects/course-completion-dashboard`

## File structure

```
course-completion-dashboard/
├── package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, index.html
├── migrations/0001_init.sql          # D1 schema
├── shared/types.ts                   # Types used by worker + frontend + tests
├── worker/
│   ├── index.ts                      # Hono app: 4 API routes + health
│   └── db.ts                         # Upsert SQL, param builders, row mappers (pure, testable)
├── src/
│   ├── main.tsx, index.css, App.tsx  # Shell: state, page switching, refresh
│   ├── api.ts                        # Typed fetch wrappers
│   ├── excel/parse.ts                # SheetJS parsing, header mapping, date conversion
│   ├── lib/stats.ts                  # Tiles, manager breakdown, pending CSV (pure)
│   └── components/
│       ├── Sidebar.tsx               # Nav + course switcher
│       ├── DashboardPage.tsx         # Hero + chart + export button
│       ├── HeroHeader.tsx            # Ring, stat numbers, upload button
│       ├── ManagerChart.tsx          # Horizontal bars
│       ├── PeoplePage.tsx            # Search/sort table
│       └── UploadModal.tsx           # File pick → parse → preview → confirm
├── scripts/make-sample.mjs           # Generates sample .xlsx for demos/testing
└── tests/
    ├── parse.test.ts
    ├── stats.test.ts
    └── db.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `index.html`, `src/main.tsx`, `src/index.css`, `src/App.tsx`, `worker/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "course-completion-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "npm run build && wrangler dev",
    "build": "vite build",
    "test": "vitest run",
    "deploy": "npm run build && wrangler deploy",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    "sample": "node scripts/make-sample.mjs"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react react-dom hono
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite wrangler @cloudflare/workers-types vitest better-sqlite3 @types/better-sqlite3 @types/react @types/react-dom @types/node
```

Expected: installs succeed (the SheetJS tarball URL is the vendor's official distribution channel).

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@cloudflare/workers-types", "vite/client", "node"]
  },
  "include": ["src", "worker", "shared", "tests", "scripts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 5: Write `wrangler.jsonc`**

The `database_id` is a placeholder until Task 13 creates the real database — `wrangler dev` runs a local SQLite and does not validate it.

```jsonc
{
  "name": "course-completion-dashboard",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "course-completion-dashboard",
      "database_id": "REPLACE-ON-DEPLOY",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Course Completion Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 8: Write `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Write placeholder `src/App.tsx`** (replaced in Task 8)

```tsx
export default function App() {
  return <h1 className="p-6 text-2xl font-bold text-slate-800">Course Completion Dashboard</h1>;
}
```

- [ ] **Step 10: Write `worker/index.ts`** (routes added in Task 7)

```ts
import { Hono } from 'hono';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 11: Verify build and dev server**

```bash
npm run build
```
Expected: Vite build succeeds, `dist/` created.

Start `npx wrangler dev` (background or second terminal), then:

```bash
curl http://localhost:8787/api/health
```
Expected: `{"ok":true}`. Also `curl http://localhost:8787/` returns the HTML page containing "Course Completion Dashboard". Stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + React + Hono + Cloudflare Worker project"
```

---

### Task 2: D1 schema migration

**Files:**
- Create: `migrations/0001_init.sql`

- [ ] **Step 1: Write `migrations/0001_init.sql`**

```sql
CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_assignment TEXT,
  course_title TEXT NOT NULL,
  course_start_date TEXT,
  course_completion_date TEXT,
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
  uploaded_by TEXT
);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npm run db:migrate:local
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('enrollments','uploads')"
```
Expected: migration applies; query lists both `enrollments` and `uploads`.

- [ ] **Step 3: Commit**

```bash
git add migrations
git commit -m "feat: add D1 schema for enrollments and upload history"
```

---

### Task 3: Shared types

**Files:**
- Create: `shared/types.ts`

- [ ] **Step 1: Write `shared/types.ts`**

```ts
/** One parsed spreadsheet row, ready for upsert. Dates are ISO `YYYY-MM-DD` or null. */
export interface EnrollmentInput {
  firstName: string;
  lastName: string;
  email: string;               // trimmed + lowercased by the parser
  jobAssignment: string | null;
  courseTitle: string;
  courseStartDate: string | null;
  courseCompletionDate: string | null;  // null = pending
  manager: string | null;
}

/** A stored enrollment row returned by the API. */
export interface Enrollment extends EnrollmentInput {
  id: number;
  updatedAt: string;
}

export interface ParseWarning {
  row: number;      // 1-based Excel row number
  message: string;
}

export interface ParseResult {
  rows: EnrollmentInput[];     // deduped by (email, courseTitle), last occurrence wins
  skipped: ParseWarning[];     // rows excluded entirely (e.g. missing email)
  warnings: ParseWarning[];    // rows kept but degraded (e.g. unreadable date)
  courses: string[];           // distinct course titles found, sorted
}

export interface CourseInfo {
  courseTitle: string;
  rowCount: number;
}

export interface UploadResponse {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface UploadRecord {
  id: number;
  filename: string;
  uploadedAt: string;
  rowsProcessed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  uploadedBy: string | null;   // null until Cloudflare Access (SSO) is enabled
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add shared API and domain types"
```

---

### Task 4: Excel parsing module (TDD)

**Files:**
- Create: `src/excel/parse.ts`
- Test: `tests/parse.test.ts`

- [ ] **Step 1: Write the failing tests — `tests/parse.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MissingColumnsError, parseWorkbook, toIsoDate } from '../src/excel/parse';

const HEADERS = [
  'Employee First Name', 'Employee Last Name', 'Business Email', 'Job Assignment',
  'Course Title', 'Course Start Date', 'Course Completion Date', 'Manager',
];

function workbook(rows: unknown[][], headers: string[] = HEADERS): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const fullRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = ['Jane', 'Cooper', 'Jane@Example.com', 'Specialist', 'Safety 101', '2026-06-01', '2026-06-20', 'Maria Rivera'];
  return base.map((v, i) => (i in over ? over[i] : v));
};

describe('toIsoDate', () => {
  it('passes through empty as null without error', () => {
    expect(toIsoDate(null)).toEqual({ iso: null, ok: true });
    expect(toIsoDate('')).toEqual({ iso: null, ok: true });
    expect(toIsoDate('   ')).toEqual({ iso: null, ok: true });
  });
  it('converts Excel serial numbers (days since 1899-12-30)', () => {
    expect(toIsoDate(45000)).toEqual({ iso: '2023-03-15', ok: true });
  });
  it('converts JS Date objects', () => {
    expect(toIsoDate(new Date(2026, 5, 20))).toEqual({ iso: '2026-06-20', ok: true });
  });
  it('converts common text dates', () => {
    expect(toIsoDate('06/20/2026')).toEqual({ iso: '2026-06-20', ok: true });
    expect(toIsoDate('2026-06-20')).toEqual({ iso: '2026-06-20', ok: true });
  });
  it('flags unparseable values', () => {
    expect(toIsoDate('not a date')).toEqual({ iso: null, ok: false });
  });
});

describe('parseWorkbook', () => {
  it('maps a happy-path row, lowercasing the email', () => {
    const result = parseWorkbook(workbook([fullRow()]));
    expect(result.rows).toEqual([{
      firstName: 'Jane', lastName: 'Cooper', email: 'jane@example.com',
      jobAssignment: 'Specialist', courseTitle: 'Safety 101',
      courseStartDate: '2026-06-01', courseCompletionDate: '2026-06-20', manager: 'Maria Rivera',
    }]);
    expect(result.courses).toEqual(['Safety 101']);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('matches headers case-insensitively, ignores whitespace and extra columns', () => {
    const headers = [...HEADERS.map((h) => `  ${h.toUpperCase()}  `), 'Region'];
    const result = parseWorkbook(workbook([[...fullRow(), 'EMEA']], headers));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('jane@example.com');
  });

  it('throws MissingColumnsError naming every missing header', () => {
    const headers = HEADERS.filter((h) => h !== 'Business Email' && h !== 'Manager');
    const dummyRow = ['Jane', 'Cooper', 'Specialist', 'Safety 101', '2026-06-01', '2026-06-20'];
    expect(() => parseWorkbook(workbook([dummyRow], headers))).toThrowError(MissingColumnsError);
    try {
      parseWorkbook(workbook([dummyRow], headers));
    } catch (e) {
      expect((e as MissingColumnsError).missing).toEqual(['Business Email', 'Manager']);
    }
  });

  it('skips rows with missing or invalid email, reporting the Excel row number', () => {
    const result = parseWorkbook(workbook([fullRow(), fullRow({ 2: '' }), fullRow({ 2: 'not-an-email' })]));
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([
      { row: 3, message: 'Missing or invalid Business Email' },
      { row: 4, message: 'Missing or invalid Business Email' },
    ]);
  });

  it('skips rows with missing course title', () => {
    const result = parseWorkbook(workbook([fullRow({ 4: '' })]));
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([{ row: 2, message: 'Missing Course Title' }]);
  });

  it('treats an unreadable completion date as pending, with a warning', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: 'garbage' })]));
    expect(result.rows[0].courseCompletionDate).toBeNull();
    expect(result.warnings).toEqual([{ row: 2, message: 'Unreadable Course Completion Date — treated as pending' }]);
  });

  it('treats an empty completion date as pending, without a warning', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: '' })]));
    expect(result.rows[0].courseCompletionDate).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('dedupes by email+course, last row wins', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: '' }), fullRow()]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].courseCompletionDate).toBe('2026-06-20');
  });

  it('throws on a workbook with no data rows', () => {
    expect(() => parseWorkbook(workbook([]))).toThrowError('File contains no data rows');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — cannot resolve `../src/excel/parse`.

- [ ] **Step 3: Write `src/excel/parse.ts`**

```ts
import * as XLSX from 'xlsx';
import type { EnrollmentInput, ParseResult, ParseWarning } from '../../shared/types';

/** Spreadsheet header (normalized) → EnrollmentInput field. */
const HEADER_MAP = {
  'employee first name': 'firstName',
  'employee last name': 'lastName',
  'business email': 'email',
  'job assignment': 'jobAssignment',
  'course title': 'courseTitle',
  'course start date': 'courseStartDate',
  'course completion date': 'courseCompletionDate',
  'manager': 'manager',
} as const;

type Field = (typeof HEADER_MAP)[keyof typeof HEADER_MAP];

/** Display names for error messages, keyed the same as HEADER_MAP. */
const DISPLAY_NAMES: Record<string, string> = {
  'employee first name': 'Employee First Name',
  'employee last name': 'Employee Last Name',
  'business email': 'Business Email',
  'job assignment': 'Job Assignment',
  'course title': 'Course Title',
  'course start date': 'Course Start Date',
  'course completion date': 'Course Completion Date',
  'manager': 'Manager',
};

export class MissingColumnsError extends Error {
  constructor(public missing: string[]) {
    super(`Missing required columns: ${missing.join(', ')}`);
    this.name = 'MissingColumnsError';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Convert a cell value to an ISO date string.
 * ok:false means the cell had content we could not read as a date.
 */
export function toIsoDate(value: unknown): { iso: string | null; ok: boolean } {
  if (value === null || value === undefined) return { iso: null, ok: true };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { iso: null, ok: false } : { iso: fmtLocal(value), ok: true };
  }
  if (typeof value === 'number' && isFinite(value)) {
    // Excel serial date: days since 1899-12-30 (25569 = 1970-01-01)
    const d = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return { iso: null, ok: true };
    const d = new Date(t);
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtLocal(d), ok: true };
  }
  return { iso: null, ok: false };
}

const normalize = (s: string) => s.trim().toLowerCase();
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  if (raw.length === 0) throw new Error('File contains no data rows');

  // Map each required field to the original header key present in the sheet.
  const keyByField = new Map<Field, string>();
  for (const orig of Object.keys(raw[0])) {
    const field = HEADER_MAP[normalize(orig) as keyof typeof HEADER_MAP];
    if (field && !keyByField.has(field)) keyByField.set(field, orig);
  }
  const missing = Object.entries(HEADER_MAP)
    .filter(([, field]) => !keyByField.has(field))
    .map(([norm]) => DISPLAY_NAMES[norm]);
  if (missing.length > 0) throw new MissingColumnsError(missing);

  const get = (row: Record<string, unknown>, field: Field) => row[keyByField.get(field)!];

  const skipped: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];
  const byKey = new Map<string, EnrollmentInput>();

  raw.forEach((rawRow, i) => {
    const excelRow = i + 2; // 1-based, after the header row

    const email = str(get(rawRow, 'email')).toLowerCase();
    if (!email || !email.includes('@')) {
      skipped.push({ row: excelRow, message: 'Missing or invalid Business Email' });
      return;
    }
    const courseTitle = str(get(rawRow, 'courseTitle'));
    if (!courseTitle) {
      skipped.push({ row: excelRow, message: 'Missing Course Title' });
      return;
    }

    const start = toIsoDate(get(rawRow, 'courseStartDate'));
    if (!start.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Start Date — stored as blank' });
    const completion = toIsoDate(get(rawRow, 'courseCompletionDate'));
    if (!completion.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Completion Date — treated as pending' });

    byKey.set(`${email}||${courseTitle}`, {
      firstName: str(get(rawRow, 'firstName')),
      lastName: str(get(rawRow, 'lastName')),
      email,
      jobAssignment: str(get(rawRow, 'jobAssignment')) || null,
      courseTitle,
      courseStartDate: start.iso,
      courseCompletionDate: completion.iso,
      manager: str(get(rawRow, 'manager')) || null,
    });
  });

  const rows = [...byKey.values()];
  const courses = [...new Set(rows.map((r) => r.courseTitle))].sort();
  return { rows, skipped, warnings, courses };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/excel/parse.ts tests/parse.test.ts
git commit -m "feat: Excel parsing with header mapping, date conversion, and row validation"
```

---

### Task 5: Stats module (TDD)

**Files:**
- Create: `src/lib/stats.ts`
- Test: `tests/stats.test.ts`

- [ ] **Step 1: Write the failing tests — `tests/stats.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { computeStats, managerBreakdown, pendingCsv } from '../src/lib/stats';
import type { EnrollmentInput } from '../shared/types';

const row = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  firstName: 'Jane', lastName: 'Cooper', email: 'jane@example.com', jobAssignment: 'Specialist',
  courseTitle: 'Safety 101', courseStartDate: '2026-06-01', courseCompletionDate: '2026-06-20',
  manager: 'Maria Rivera', ...over,
});

describe('computeStats', () => {
  it('computes tiles from rows', () => {
    const rows = [
      row(), row(), row({ courseCompletionDate: null }),
      row({ manager: 'Kevin Tan' }), row({ manager: '  ' , courseCompletionDate: null }),
    ];
    expect(computeStats(rows)).toEqual({
      total: 5, completed: 3, pending: 2, completionRate: 60, managers: 2,
    });
  });
  it('rounds the rate to one decimal', () => {
    const rows = [row(), row(), row({ courseCompletionDate: null })];
    expect(computeStats(rows).completionRate).toBe(66.7);
  });
  it('returns zeros for no rows', () => {
    expect(computeStats([])).toEqual({ total: 0, completed: 0, pending: 0, completionRate: 0, managers: 0 });
  });
});

describe('managerBreakdown', () => {
  it('groups by manager, sorts by rate desc then name asc', () => {
    const rows = [
      row({ manager: 'Kevin Tan' }), row({ manager: 'Kevin Tan', courseCompletionDate: null }),
      row({ manager: 'Maria Rivera' }),
      row({ manager: null, courseCompletionDate: null }),
    ];
    expect(managerBreakdown(rows)).toEqual([
      { manager: 'Maria Rivera', total: 1, completed: 1, rate: 100 },
      { manager: 'Kevin Tan', total: 2, completed: 1, rate: 50 },
      { manager: 'Unassigned', total: 1, completed: 0, rate: 0 },
    ]);
  });
});

describe('pendingCsv', () => {
  it('includes only pending rows and escapes commas', () => {
    const rows = [
      row(),
      row({ firstName: 'Bob', lastName: 'Smith, Jr.', email: 'bob@example.com', courseCompletionDate: null }),
    ];
    expect(pendingCsv(rows)).toBe(
      'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date\n' +
      'Bob,"Smith, Jr.",bob@example.com,Specialist,Maria Rivera,Safety 101,2026-06-01',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stats.test.ts`
Expected: FAIL — cannot resolve `../src/lib/stats`.

- [ ] **Step 3: Write `src/lib/stats.ts`**

```ts
import type { EnrollmentInput } from '../../shared/types';

export interface Stats {
  total: number;
  completed: number;
  pending: number;
  completionRate: number; // percentage, one decimal
  managers: number;       // distinct non-empty manager names
}

export interface ManagerStat {
  manager: string;
  total: number;
  completed: number;
  rate: number;
}

type StatRow = Pick<EnrollmentInput, 'courseCompletionDate' | 'manager'>;

const pct = (completed: number, total: number) =>
  total === 0 ? 0 : Math.round((completed / total) * 1000) / 10;

export function computeStats(rows: StatRow[]): Stats {
  const total = rows.length;
  const completed = rows.filter((r) => r.courseCompletionDate).length;
  const managers = new Set(rows.map((r) => (r.manager ?? '').trim()).filter(Boolean)).size;
  return { total, completed, pending: total - completed, completionRate: pct(completed, total), managers };
}

export function managerBreakdown(rows: StatRow[]): ManagerStat[] {
  const groups = new Map<string, { total: number; completed: number }>();
  for (const r of rows) {
    const name = (r.manager ?? '').trim() || 'Unassigned';
    const g = groups.get(name) ?? { total: 0, completed: 0 };
    g.total += 1;
    if (r.courseCompletionDate) g.completed += 1;
    groups.set(name, g);
  }
  return [...groups.entries()]
    .map(([manager, g]) => ({ manager, total: g.total, completed: g.completed, rate: pct(g.completed, g.total) }))
    .sort((a, b) => b.rate - a.rate || a.manager.localeCompare(b.manager));
}

const esc = (v: string | null) => {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function pendingCsv(rows: EnrollmentInput[]): string {
  const header = 'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date';
  const lines = rows
    .filter((r) => !r.courseCompletionDate)
    .map((r) =>
      [r.firstName, r.lastName, r.email, r.jobAssignment, r.manager, r.courseTitle, r.courseStartDate]
        .map(esc)
        .join(','),
    );
  return [header, ...lines].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts tests/stats.test.ts
git commit -m "feat: stats computation, manager breakdown, and pending CSV export"
```

---

### Task 6: Database helpers (TDD)

**Files:**
- Create: `worker/db.ts`
- Test: `tests/db.test.ts`

The upsert SQL runs against real SQLite (better-sqlite3) in tests — the same dialect D1 uses.

- [ ] **Step 1: Write the failing tests — `tests/db.test.ts`**

```ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { countInsertsAndUpdates, keyOf, rowToEnrollment, UPSERT_SQL, upsertParams } from '../worker/db';
import type { EnrollmentInput } from '../shared/types';

const migration = readFileSync('migrations/0001_init.sql', 'utf8');

const row = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  firstName: 'Jane', lastName: 'Cooper', email: 'jane@example.com', jobAssignment: 'Specialist',
  courseTitle: 'Safety 101', courseStartDate: '2026-06-01', courseCompletionDate: null,
  manager: 'Maria Rivera', ...over,
});

describe('upsert SQL', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration);
  });

  const upsert = (r: EnrollmentInput, now = '2026-07-14T00:00:00Z') =>
    db.prepare(UPSERT_SQL).run(...(upsertParams(r, now) as never[]));

  it('inserts a new enrollment', () => {
    upsert(row());
    const stored = db.prepare('SELECT * FROM enrollments').all();
    expect(stored).toHaveLength(1);
    expect(rowToEnrollment(stored[0] as Record<string, unknown>)).toMatchObject({
      firstName: 'Jane', email: 'jane@example.com', courseTitle: 'Safety 101',
      courseCompletionDate: null, updatedAt: '2026-07-14T00:00:00Z',
    });
  });

  it('updates in place on same email+course instead of duplicating', () => {
    upsert(row());
    upsert(row({ courseCompletionDate: '2026-07-01', jobAssignment: 'Team Lead' }), '2026-07-15T00:00:00Z');
    const stored = db.prepare('SELECT * FROM enrollments').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].course_completion_date).toBe('2026-07-01');
    expect(stored[0].job_assignment).toBe('Team Lead');
    expect(stored[0].updated_at).toBe('2026-07-15T00:00:00Z');
  });

  it('keeps rows for people absent from a new upload', () => {
    upsert(row());
    upsert(row({ email: 'bob@example.com', firstName: 'Bob' }));
    upsert(row({ courseCompletionDate: '2026-07-01' })); // new upload only mentions jane
    expect(db.prepare('SELECT COUNT(*) AS n FROM enrollments').get()).toEqual({ n: 2 });
  });

  it('treats same email in a different course as a separate record', () => {
    upsert(row());
    upsert(row({ courseTitle: 'Security 201' }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM enrollments').get()).toEqual({ n: 2 });
  });
});

describe('countInsertsAndUpdates', () => {
  it('partitions rows by whether their key already exists', () => {
    const existing = new Set([keyOf('jane@example.com', 'Safety 101')]);
    const result = countInsertsAndUpdates(existing, [
      row(), row({ email: 'bob@example.com' }), row({ courseTitle: 'Security 201' }),
    ]);
    expect(result).toEqual({ inserted: 2, updated: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot resolve `../worker/db`.

- [ ] **Step 3: Write `worker/db.ts`**

```ts
import type { Enrollment, EnrollmentInput } from '../shared/types';

export const UPSERT_SQL = `
INSERT INTO enrollments
  (first_name, last_name, email, job_assignment, course_title,
   course_start_date, course_completion_date, manager, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (email, course_title) DO UPDATE SET
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  job_assignment = excluded.job_assignment,
  course_start_date = excluded.course_start_date,
  course_completion_date = excluded.course_completion_date,
  manager = excluded.manager,
  updated_at = excluded.updated_at
`;

export function upsertParams(r: EnrollmentInput, now: string): (string | null)[] {
  return [
    r.firstName, r.lastName, r.email, r.jobAssignment, r.courseTitle,
    r.courseStartDate, r.courseCompletionDate, r.manager, now,
  ];
}

export const keyOf = (email: string, courseTitle: string) => `${email.toLowerCase()}||${courseTitle}`;

export function countInsertsAndUpdates(
  existingKeys: Set<string>,
  rows: EnrollmentInput[],
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    if (existingKeys.has(keyOf(r.email, r.courseTitle))) updated += 1;
    else inserted += 1;
  }
  return { inserted, updated };
}

export function rowToEnrollment(row: Record<string, unknown>): Enrollment {
  return {
    id: row.id as number,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: row.email as string,
    jobAssignment: row.job_assignment as string | null,
    courseTitle: row.course_title as string,
    courseStartDate: row.course_start_date as string | null,
    courseCompletionDate: row.course_completion_date as string | null,
    manager: row.manager as string | null,
    updatedAt: row.updated_at as string,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: parse, stats, and db tests all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/db.ts tests/db.test.ts
git commit -m "feat: upsert SQL and count helpers, verified against real SQLite"
```

---

### Task 7: Worker API endpoints

**Files:**
- Modify: `worker/index.ts`

The route logic is thin glue over the tested helpers; verify with curl against `wrangler dev`.

- [ ] **Step 1: Replace `worker/index.ts`**

```ts
import { Hono } from 'hono';
import type { EnrollmentInput } from '../shared/types';
import { countInsertsAndUpdates, keyOf, rowToEnrollment, UPSERT_SQL, upsertParams } from './db';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/courses', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT course_title AS courseTitle, COUNT(*) AS rowCount FROM enrollments GROUP BY course_title ORDER BY course_title',
  ).all();
  return c.json(results);
});

app.get('/api/enrollments', async (c) => {
  const course = c.req.query('course');
  if (!course) return c.json({ error: 'course query parameter is required' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM enrollments WHERE course_title = ? ORDER BY last_name, first_name',
  ).bind(course).all();
  return c.json(results.map((r) => rowToEnrollment(r as Record<string, unknown>)));
});

app.get('/api/uploads', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, filename, uploaded_at AS uploadedAt, rows_processed AS rowsProcessed,
            rows_inserted AS rowsInserted, rows_updated AS rowsUpdated,
            rows_skipped AS rowsSkipped, uploaded_by AS uploadedBy
     FROM uploads ORDER BY uploaded_at DESC, id DESC`,
  ).all();
  return c.json(results);
});

app.post('/api/uploads', async (c) => {
  const body = await c.req
    .json<{ filename?: string; rows?: EnrollmentInput[]; skippedCount?: number }>()
    .catch(() => null);
  if (!body || typeof body.filename !== 'string' || !Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'Body must include filename and a non-empty rows array' }, 400);
  }
  for (const r of body.rows) {
    if (typeof r.email !== 'string' || !r.email.includes('@') || typeof r.courseTitle !== 'string' || !r.courseTitle) {
      return c.json({ error: 'Every row needs a valid email and courseTitle' }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT email, course_title FROM enrollments').all();
  const existingKeys = new Set(
    existing.results.map((r) => keyOf(r.email as string, r.course_title as string)),
  );
  const { inserted, updated } = countInsertsAndUpdates(existingKeys, body.rows);

  const now = new Date().toISOString();
  const stmt = c.env.DB.prepare(UPSERT_SQL);
  await c.env.DB.batch(body.rows.map((r) => stmt.bind(...upsertParams(r, now))));

  const skipped = typeof body.skippedCount === 'number' ? body.skippedCount : 0;
  await c.env.DB.prepare(
    `INSERT INTO uploads (filename, uploaded_at, rows_processed, rows_inserted, rows_updated, rows_skipped, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    body.filename, now, body.rows.length, inserted, updated, skipped,
    c.req.header('Cf-Access-Authenticated-User-Email') ?? null, // populated once SSO is enabled
  ).run();

  return c.json({ processed: body.rows.length, inserted, updated, skipped });
});

export default app;
```

- [ ] **Step 2: Verify with curl against wrangler dev**

Build and start dev server (background or second terminal): `npm run dev`

```bash
curl -s -X POST http://localhost:8787/api/uploads -H "Content-Type: application/json" -d '{"filename":"test.xlsx","skippedCount":1,"rows":[{"firstName":"Jane","lastName":"Cooper","email":"jane@example.com","jobAssignment":"Specialist","courseTitle":"Safety 101","courseStartDate":"2026-06-01","courseCompletionDate":"2026-06-20","manager":"Maria Rivera"},{"firstName":"Bob","lastName":"Smith","email":"bob@example.com","jobAssignment":null,"courseTitle":"Safety 101","courseStartDate":"2026-06-01","courseCompletionDate":null,"manager":"Kevin Tan"}]}'
```
Expected: `{"processed":2,"inserted":2,"updated":0,"skipped":1}`

```bash
curl -s -X POST http://localhost:8787/api/uploads -H "Content-Type: application/json" -d '{"filename":"test2.xlsx","skippedCount":0,"rows":[{"firstName":"Bob","lastName":"Smith","email":"bob@example.com","jobAssignment":null,"courseTitle":"Safety 101","courseStartDate":"2026-06-01","courseCompletionDate":"2026-07-01","manager":"Kevin Tan"}]}'
```
Expected: `{"processed":1,"inserted":0,"updated":1,"skipped":0}` (Bob upserted, Jane retained)

```bash
curl -s http://localhost:8787/api/courses
curl -s "http://localhost:8787/api/enrollments?course=Safety%20101"
curl -s http://localhost:8787/api/uploads
curl -s -X POST http://localhost:8787/api/uploads -H "Content-Type: application/json" -d '{}'
```
Expected, in order: `[{"courseTitle":"Safety 101","rowCount":2}]`; two camelCase enrollment objects with Bob's `courseCompletionDate` now `"2026-07-01"`; two upload records, newest first; `{"error":"Body must include filename and a non-empty rows array"}` with HTTP 400.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add worker/index.ts
git commit -m "feat: API routes for courses, enrollments, and uploads with upsert"
```

---

### Task 8: Frontend API client and app shell

**Files:**
- Create: `src/api.ts`, `src/components/Sidebar.tsx`
- Create (stubs, replaced in Tasks 9–11): `src/components/DashboardPage.tsx`, `src/components/PeoplePage.tsx`, `src/components/UploadModal.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `src/api.ts`**

```ts
import type { CourseInfo, Enrollment, EnrollmentInput, UploadRecord, UploadResponse } from '../shared/types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const fetchCourses = () => fetch('/api/courses').then((r) => json<CourseInfo[]>(r));

export const fetchEnrollments = (course: string) =>
  fetch(`/api/enrollments?course=${encodeURIComponent(course)}`).then((r) => json<Enrollment[]>(r));

export const fetchUploads = () => fetch('/api/uploads').then((r) => json<UploadRecord[]>(r));

export const postUpload = (body: { filename: string; rows: EnrollmentInput[]; skippedCount: number }) =>
  fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<UploadResponse>(r));
```

- [ ] **Step 2: Write `src/components/Sidebar.tsx`**

```tsx
import type { CourseInfo } from '../../shared/types';

interface Props {
  page: 'dashboard' | 'people';
  onNavigate: (page: 'dashboard' | 'people') => void;
  courses: CourseInfo[];
  course: string;
  onSelectCourse: (title: string) => void;
}

export default function Sidebar({ page, onNavigate, courses, course, onSelectCourse }: Props) {
  const link = (p: 'dashboard' | 'people', label: string) => (
    <button
      onClick={() => onNavigate(p)}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        page === p ? 'bg-blue-600 font-semibold text-white' : 'text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 bg-slate-900 p-4">
      <div className="mb-4 text-lg font-bold text-white">📊 Enablement</div>
      {link('dashboard', 'Dashboard')}
      {link('people', 'People')}
      <div className="mt-auto border-t border-slate-700 pt-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Course</label>
        <select
          value={course}
          onChange={(e) => onSelectCourse(e.target.value)}
          className="mt-1 w-full rounded-md bg-slate-800 p-2 text-sm text-slate-100"
        >
          {courses.length === 0 && <option value="">No data yet</option>}
          {courses.map((c) => (
            <option key={c.courseTitle} value={c.courseTitle}>{c.courseTitle}</option>
          ))}
        </select>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Write the three page stubs** (interfaces are final; bodies are replaced in Tasks 9–11)

`src/components/DashboardPage.tsx`:
```tsx
import type { Enrollment, UploadRecord } from '../../shared/types';

interface Props {
  course: string;
  rows: Enrollment[];
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

export default function DashboardPage({ course }: Props) {
  return <div className="p-6 text-slate-500">Dashboard for {course || '(no course)'} — built in Task 9</div>;
}
```

`src/components/PeoplePage.tsx`:
```tsx
import type { Enrollment } from '../../shared/types';

export default function PeoplePage({ rows }: { rows: Enrollment[] }) {
  return <div className="p-6 text-slate-500">People table ({rows.length} rows) — built in Task 11</div>;
}
```

`src/components/UploadModal.tsx`:
```tsx
interface Props {
  onClose: () => void;
  onUploaded: (course: string) => void;
}

export default function UploadModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40" onClick={onClose}>
      <div className="rounded-lg bg-white p-6">Upload modal — built in Task 10</div>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/App.tsx`** (final version)

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { CourseInfo, Enrollment, UploadRecord } from '../shared/types';
import { fetchCourses, fetchEnrollments, fetchUploads } from './api';
import DashboardPage from './components/DashboardPage';
import PeoplePage from './components/PeoplePage';
import Sidebar from './components/Sidebar';
import UploadModal from './components/UploadModal';

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'people'>('dashboard');
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [course, setCourse] = useState('');
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [lastUpload, setLastUpload] = useState<UploadRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async (preferredCourse?: string) => {
    try {
      setLoadError('');
      const [cs, ups] = await Promise.all([fetchCourses(), fetchUploads()]);
      setCourses(cs);
      setLastUpload(ups[0] ?? null);
      setCourse((current) => {
        const next =
          preferredCourse && cs.some((c) => c.courseTitle === preferredCourse) ? preferredCourse
          : cs.some((c) => c.courseTitle === current) ? current
          : (cs[0]?.courseTitle ?? '');
        if (next) fetchEnrollments(next).then(setRows).catch((e) => setLoadError(String(e)));
        else setRows([]);
        return next;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectCourse = (title: string) => {
    setCourse(title);
    fetchEnrollments(title).then(setRows).catch((e) => setLoadError(String(e)));
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar page={page} onNavigate={setPage} courses={courses} course={course} onSelectCourse={selectCourse} />
      <main className="flex-1">
        {loadError && <p className="m-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {page === 'dashboard' ? (
          <DashboardPage course={course} rows={rows} lastUpload={lastUpload} onUploadClick={() => setUploadOpen(true)} />
        ) : (
          <PeoplePage rows={rows} />
        )}
      </main>
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={(c) => {
            setUploadOpen(false);
            void refresh(c);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify visually**

Run: `npm run dev`, open http://localhost:8787.
Expected: dark sidebar with Dashboard/People buttons and course selector showing "Safety 101" (from Task 7's curl data); main area shows the Task 9 stub text; People button switches pages. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: app shell with sidebar navigation, course switcher, and data loading"
```

---

### Task 9: Dashboard page — hero header, ring, chart, export

**Files:**
- Create: `src/components/HeroHeader.tsx`, `src/components/ManagerChart.tsx`
- Modify: `src/components/DashboardPage.tsx` (replace stub)

- [ ] **Step 1: Write `src/components/HeroHeader.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { UploadRecord } from '../../shared/types';
import type { Stats } from '../lib/stats';

interface Props {
  course: string;
  stats: Stats;
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

function Stat({ value, label, className = '' }: { value: ReactNode; label: string; className?: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

export default function HeroHeader({ course, stats, lastUpload, onUploadClick }: Props) {
  const ring = `conic-gradient(#4ade80 ${stats.completionRate * 3.6}deg, rgba(255,255,255,0.15) 0deg)`;
  return (
    <div className="bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{course || 'Course Completion Dashboard'}</h1>
          <p className="text-xs text-slate-400">
            {lastUpload
              ? `Last upload: ${new Date(lastUpload.uploadedAt).toLocaleString()} · ${lastUpload.rowsProcessed} rows`
              : 'No uploads yet'}
          </p>
        </div>
        <button
          onClick={onUploadClick}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
        >
          ⬆ Upload Excel
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: ring }}>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-800 text-lg font-bold">
            {stats.completionRate}%
          </div>
        </div>
        <Stat value={stats.total} label="Total Daymakers" />
        <Stat value={stats.completed} label="Completed" className="text-green-400" />
        <Stat value={stats.pending} label="Pending" className="text-amber-400" />
        <Stat value={stats.managers} label="Managers" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/ManagerChart.tsx`**

```tsx
import type { ManagerStat } from '../lib/stats';

export default function ManagerChart({ breakdown }: { breakdown: ManagerStat[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Completion by Manager</h2>
      <div className="space-y-2">
        {breakdown.map((m) => (
          <div key={m.manager} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate text-slate-600" title={m.manager}>{m.manager}</span>
            <div className="h-3 flex-1 rounded bg-slate-100">
              <div className="h-3 rounded bg-blue-600" style={{ width: `${m.rate}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right text-slate-500">
              {m.rate}% ({m.completed}/{m.total})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/components/DashboardPage.tsx`**

```tsx
import type { Enrollment, UploadRecord } from '../../shared/types';
import { computeStats, managerBreakdown, pendingCsv } from '../lib/stats';
import HeroHeader from './HeroHeader';
import ManagerChart from './ManagerChart';

interface Props {
  course: string;
  rows: Enrollment[];
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

export default function DashboardPage({ course, rows, lastUpload, onUploadClick }: Props) {
  const stats = computeStats(rows);
  const breakdown = managerBreakdown(rows);

  const exportPending = () => {
    const blob = new Blob([pendingCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pending-${course || 'course'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <HeroHeader course={course} stats={stats} lastUpload={lastUpload} onUploadClick={onUploadClick} />
      <div className="space-y-4 p-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            No data yet. Click <b>Upload Excel</b> to import your first export.
          </div>
        ) : (
          <>
            <ManagerChart breakdown={breakdown} />
            <button
              onClick={exportPending}
              className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
            >
              ⬇ Export pending list ({stats.pending})
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, open http://localhost:8787.
Expected with Task 7's curl data (Jane and Bob both completed after the second curl): hero shows Safety 101, 100% ring, Total 2 / Completed 2 / Pending 0 / Managers 2, and the last-upload line; chart shows two bars (Kevin Tan and Maria Rivera, both 100%, sorted alphabetically); "Export pending list (0)" downloads a CSV containing only the header row. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "feat: dashboard hero with completion ring, manager chart, pending export"
```

---

### Task 10: Upload modal

**Files:**
- Modify: `src/components/UploadModal.tsx` (replace stub)

- [ ] **Step 1: Replace `src/components/UploadModal.tsx`**

```tsx
import { useRef, useState } from 'react';
import type { ParseResult } from '../../shared/types';
import { postUpload } from '../api';
import { parseWorkbook } from '../excel/parse';

interface Props {
  onClose: () => void;
  onUploaded: (course: string) => void;
}

export default function UploadModal({ onClose, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError('');
    setResult(null);
    if (!file) return;
    setFilename(file.name);
    try {
      setResult(parseWorkbook(await file.arrayBuffer()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const confirm = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      await postUpload({ filename, rows: result.rows, skippedCount: result.skipped.length });
      onUploaded(result.courses[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">Upload Excel export</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-md border-2 border-dashed border-slate-300 p-8 text-slate-500 hover:border-blue-400 hover:text-blue-600"
        >
          {filename || 'Click to choose a .xlsx file'}
        </button>
        {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {result && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <b>{result.rows.length}</b> rows ready across <b>{result.courses.length}</b> course(s):{' '}
              {result.courses.join(', ')}
            </p>
            {result.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{result.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {result.skipped.map((s, i) => (
                    <li key={i}>Row {s.row}: {s.message}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.warnings.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{result.warnings.length} warning(s)</summary>
                <ul className="ml-5 list-disc">
                  {result.warnings.map((w, i) => (
                    <li key={i}>Row {w.row}: {w.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!result || result.rows.length === 0 || busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? 'Uploading…' : 'Confirm upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds with no type errors. (Full flow is exercised in Task 12 once the sample file exists.)

- [ ] **Step 3: Commit**

```bash
git add src/components/UploadModal.tsx
git commit -m "feat: upload modal with parse preview, skip/warning details, and confirm"
```

---

### Task 11: People page

**Files:**
- Modify: `src/components/PeoplePage.tsx` (replace stub)

- [ ] **Step 1: Replace `src/components/PeoplePage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Enrollment } from '../../shared/types';

type SortKey = 'name' | 'email' | 'jobAssignment' | 'manager' | 'status' | 'courseCompletionDate';

export default function PeoplePage({ rows }: { rows: Enrollment[] }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: Enrollment) =>
      !q ||
      [r.firstName, r.lastName, r.email, r.jobAssignment ?? '', r.manager ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      );
    const valueOf = (r: Enrollment): string => {
      switch (sortKey) {
        case 'name':
          return `${r.lastName} ${r.firstName}`.toLowerCase();
        case 'status':
          return r.courseCompletionDate ? 'a-completed' : 'b-pending';
        default:
          return (r[sortKey] ?? '').toLowerCase();
      }
    };
    return rows
      .filter(matches)
      .sort((a, b) => (asc ? 1 : -1) * valueOf(a).localeCompare(valueOf(b)));
  }, [rows, search, sortKey, asc]);

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer px-3 py-2 text-left font-semibold text-slate-600 hover:text-slate-900"
      onClick={() => {
        if (key === sortKey) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(true);
        }
      }}
    >
      {label}
      {sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-800">People ({filtered.length})</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, manager…"
          className="w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {header('name', 'Name')}
              {header('email', 'Email')}
              {header('jobAssignment', 'Job Assignment')}
              {header('manager', 'Manager')}
              {header('status', 'Status')}
              {header('courseCompletionDate', 'Completed On')}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">{r.firstName} {r.lastName}</td>
                <td className="px-3 py-2 text-slate-500">{r.email}</td>
                <td className="px-3 py-2 text-slate-600">{r.jobAssignment}</td>
                <td className="px-3 py-2 text-slate-600">{r.manager}</td>
                <td className="px-3 py-2">
                  {r.courseCompletionDate ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Completed
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Pending
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{r.courseCompletionDate ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">No matching people.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, open http://localhost:8787, switch to People.
Expected: table lists Jane and Bob with status pills; typing "bob" in search filters to one row; clicking column headers toggles sort arrows and order. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/components/PeoplePage.tsx
git commit -m "feat: searchable, sortable people table with status pills"
```

---

### Task 12: Sample data generator and end-to-end verification

**Files:**
- Create: `scripts/make-sample.mjs`
- Modify: `.gitignore` (add `sample-data/`)

- [ ] **Step 1: Write `scripts/make-sample.mjs`**

```js
import { mkdirSync } from 'node:fs';
import * as XLSX from 'xlsx';

const managers = ['Maria Rivera', 'Kevin Tan', 'Jide Okafor', 'Sara Lopez'];
const rows = [[
  'Employee First Name', 'Employee Last Name', 'Business Email', 'Job Assignment',
  'Course Title', 'Course Start Date', 'Course Completion Date', 'Manager',
]];
for (let i = 1; i <= 40; i += 1) {
  const completed = i % 3 !== 0; // ~2/3 completed
  rows.push([
    `First${i}`, `Last${i}`, `user${i}@example.com`,
    i % 7 === 0 ? 'Team Lead' : 'Specialist',
    'Safety 101', '2026-06-01', completed ? '2026-06-20' : '',
    managers[i % managers.length],
  ]);
}
// One row that the parser must skip (no email)
rows.push(['NoEmail', 'Person', '', 'Specialist', 'Safety 101', '2026-06-01', '', 'Maria Rivera']);

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Export');
mkdirSync('sample-data', { recursive: true });
XLSX.writeFile(wb, 'sample-data/sample-course.xlsx');
console.log('Wrote sample-data/sample-course.xlsx (40 valid rows + 1 skippable)');
```

- [ ] **Step 2: Add `sample-data/` to `.gitignore`**

Append the line `sample-data/` to `.gitignore`.

- [ ] **Step 3: Generate the sample and run the full E2E flow**

```bash
npm run sample
npm test
npm run dev
```

In the browser at http://localhost:8787:
1. Click **Upload Excel**, choose `sample-data/sample-course.xlsx`.
2. Preview shows **40 rows ready across 1 course(s): Safety 101** and **1 row(s) will be skipped** (missing email).
3. Confirm. Hero updates: Total 42* / rate recomputed (*40 sample people plus Jane and Bob from Task 7 curls — if the local DB was reset, expect exactly 40, 27 completed, 13 pending, 67.5%, 4 managers).
4. Manager chart shows 4 named bars; People page lists everyone; export downloads a CSV whose row count matches the Pending tile.
5. Re-upload the same file. Upload response counts all rows as **updated**, none inserted; totals unchanged — proving upsert.

Expected: all five checks pass. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add scripts/make-sample.mjs .gitignore
git commit -m "feat: sample spreadsheet generator for demos and E2E checks"
```

---

### Task 13: Deploy to Cloudflare and publish to GitHub

Requires the user's Cloudflare account (browser login) — pause and ask if not already authenticated.

- [ ] **Step 1: Check Cloudflare auth**

Run: `npx wrangler whoami`
If not logged in: run `npx wrangler login` (opens browser; needs the user).

- [ ] **Step 2: Create the D1 database**

```bash
npx wrangler d1 create course-completion-dashboard
```
Expected: output includes a `database_id` UUID. Copy it into `wrangler.jsonc`, replacing `REPLACE-ON-DEPLOY`.

- [ ] **Step 3: Apply migrations remotely**

```bash
npm run db:migrate:remote
```
Expected: `0001_init.sql` applied.

- [ ] **Step 4: Deploy**

```bash
npm run deploy
```
Expected: deploy succeeds, prints `https://course-completion-dashboard.<subdomain>.workers.dev`.

- [ ] **Step 5: Smoke-test production**

Open the deployed URL: empty dashboard renders. Upload `sample-data/sample-course.xlsx`; stats appear; refresh the page — data persists.

- [ ] **Step 6: Commit config and publish to GitHub**

```bash
git add wrangler.jsonc
git commit -m "chore: point wrangler at production D1 database"
gh repo create course-completion-dashboard --private --source . --push
```
Expected: repo created at `github.com/alexonite96/course-completion-dashboard`, `main` pushed.

- [ ] **Step 7: Report the live URL and repo link to the user**

---

## Verification checklist (spec → task)

| Spec requirement | Task |
|---|---|
| Stat tiles + completion ring | 5, 9 |
| Completion-by-manager chart | 5, 9 |
| Searchable/sortable people table | 11 |
| Export pending CSV | 5, 9 |
| Excel upload, header mapping, date handling | 4, 10 |
| Preview with skipped rows/warnings | 4, 10 |
| Upsert by (email, course_title); absentees retained | 6, 7 |
| Multi-course model + course switcher | 2, 7, 8 |
| Upload history w/ uploaded_by (audit foundation) | 2, 7 |
| Persistence (D1) | 2, 13 |
| Error handling (missing columns, bad dates, API 400s) | 4, 7, 10 |
| Vitest for parsing + upsert | 4, 5, 6 |
| Cloudflare deploy, free tier | 1, 13 |
