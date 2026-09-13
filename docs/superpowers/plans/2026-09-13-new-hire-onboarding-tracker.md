# New Hire Onboarding Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a New Hire Onboarding Tracker feature to the existing `course-completion-dashboard` app: upload the Jump Start master file + Dayforce completion report, match new hires across the two (no shared ID exists), resolve each hire's Week 2 plan via an editable role mapping table, compute on-track/behind status against fixed deadlines, and show it all as a dashboard (enablement team) and a read-only per-manager link.

**Architecture:** Extends the existing single Cloudflare Worker (Hono API + React/Vite/TS static assets) and D1 database — no new services. Parsing happens client-side (SheetJS), matching happens server-side at upload time (needs DB access), and status/role-mapping computation happens client-side at read time so mapping edits take effect immediately without re-processing uploads — mirroring how `src/lib/stats.ts` already computes stats client-side from raw fetched rows.

**Tech Stack:** Hono (Worker routes), Cloudflare D1 (SQLite), React + TypeScript + Tailwind (frontend), SheetJS (`xlsx`) for parsing, Vitest + better-sqlite3 for tests (same as existing app).

**Reference spec:** `docs/superpowers/specs/2026-09-13-new-hire-onboarding-tracker-design.md`

---

## Before you start

Read these existing files to understand established conventions — every new file in this plan follows their patterns exactly:
- `shared/types.ts`, `worker/db.ts`, `worker/index.ts` — types, SQL/upsert helpers, Hono routes
- `src/excel/parse.ts`, `tests/parse.test.ts` — Excel parsing conventions, especially `toIsoDate` (timezone-independent date handling — **never** use local-time `Date` getters, always UTC)
- `src/lib/stats.ts`, `src/components/DashboardPage.tsx` — client-side derived stats + CSV export pattern
- `src/App.tsx`, `src/components/Sidebar.tsx` — page navigation pattern (plain `useState`, no router)

All new shared logic files use **relative imports** (no path aliases are configured in this project).

---

## Group A: Pure logic (TDD, no DB, no UI)

### Task 1: Shared onboarding types and constants

**Files:**
- Create: `shared/onboarding-types.ts`
- Create: `shared/onboarding-constants.ts`

No tests in this task — these are type/constant declarations with no behavior.

- [ ] **Step 1: Create the types file**

```ts
// shared/onboarding-types.ts

export interface ParseWarning {
  row: number;
  message: string;
}

export interface NewHireInput {
  eeNumber: string | null;
  fullName: string;
  department: string | null;
  role: string | null;
  hiringManager: string | null;
  country: string | null;
  hireDate: string | null; // ISO YYYY-MM-DD or null
  jsDate: string | null;   // ISO YYYY-MM-DD or null
}

export interface LearningPlanDefInput {
  title: string;
  category: string | null;
  audience: string | null;
  department: string | null;
  region: string | null;
}

export interface MasterParseResult {
  hires: NewHireInput[];
  plans: LearningPlanDefInput[];
  skipped: ParseWarning[];
  warnings: ParseWarning[];
}

export interface CompletionRowInput {
  preferredName: string;
  lastName: string;
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface CompletionReportParseResult {
  rows: CompletionRowInput[]; // rolled up to one row per (person, plan)
  skipped: ParseWarning[];
}

export interface PlanCompletionRecord {
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface HireRecord {
  id: number;
  eeNumber: string | null;
  fullName: string;
  department: string | null;
  role: string | null;
  hiringManager: string | null;
  managerSlug: string | null;
  country: string | null;
  hireDate: string | null;
  jsDate: string | null;
  completions: PlanCompletionRecord[];
}

export interface RolePlanMappingRule {
  id: number;
  rolePattern: string;
  departmentPattern: string | null;
  countryPattern: string | null;
  learningPlanTitle: string;
  priority: number;
}

export interface RolePlanMappingInput {
  rolePattern: string;
  departmentPattern: string | null;
  countryPattern: string | null;
  learningPlanTitle: string;
  priority: number;
}

export interface MasterUploadResponse {
  hiresProcessed: number;
  plansProcessed: number;
}

export interface CompletionUploadResponse {
  processed: number;
  matchedExact: number;
  matchedToken: number;
  unmatched: number;
}

export type PlanStatus = 'complete' | 'in_progress' | 'overdue' | 'not_started' | 'unmapped';
export type OverallStatus = 'on_track' | 'behind' | 'not_started' | 'unmapped' | 'no_start_date';

export interface PlanJourney {
  learningPlanTitle: string | null; // null when Week 2 has no mapping rule
  status: PlanStatus;
  deadline: string | null;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface HireJourney {
  hire: HireRecord;
  week1: PlanJourney;
  week2: PlanJourney;
  overallStatus: OverallStatus;
}
```

- [ ] **Step 2: Create the constants file**

```ts
// shared/onboarding-constants.ts

export const WEEK1_PLAN_TITLE = 'Jump Start - Week 1';
export const WEEK1_DEADLINE_DAYS = 7;
export const WEEK2_DEADLINE_DAYS = 14;
export const DEFAULT_RECENT_WINDOW_DAYS = 30;
```

- [ ] **Step 3: Commit**

```bash
git add shared/onboarding-types.ts shared/onboarding-constants.ts
git commit -m "feat(onboarding): add shared types and constants"
```

---

### Task 2: Extract shared Excel helpers (DRY foundation for new parsers)

**Files:**
- Create: `src/excel/shared.ts`
- Modify: `src/excel/parse.ts` (delegate to shared.ts, keep its public API identical)

- [ ] **Step 1: Create `src/excel/shared.ts` with the helpers moved out of `parse.ts`**

```ts
// src/excel/shared.ts
export class MissingColumnsError extends Error {
  constructor(public missing: string[]) {
    super(`Missing required columns: ${missing.join(', ')}`);
    this.name = 'MissingColumnsError';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Build an ISO date from calendar parts, validating it is a real date. */
function fromParts(y: number, m: number, d: number): { iso: string | null; ok: boolean } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { iso: null, ok: false };
  }
  return { iso: `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`, ok: true };
}

/**
 * Convert a cell value to an ISO date string.
 * ok:false means the cell had content we could not read as a date.
 *
 * Date-only values carry no timezone, so this must be timezone-independent:
 * every path resolves to fixed calendar components, never local-time getters.
 */
export function toIsoDate(value: unknown): { iso: string | null; ok: boolean } {
  if (value === null || value === undefined) return { iso: null, ok: true };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(value), ok: true };
  }
  if (typeof value === 'number' && isFinite(value)) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return { iso: null, ok: true };
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (mdy) return fromParts(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
    const d = new Date(t);
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  return { iso: null, ok: false };
}

export const normalize = (s: string) => s.trim().toLowerCase();
export const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
export const isBlankRow = (row: unknown[] | undefined) =>
  !row || row.every((c) => c === null || c === undefined || String(c).trim() === '');
```

- [ ] **Step 2: Rewrite `src/excel/parse.ts` to import from `shared.ts` instead of defining these locally**

Replace the entire top of the file (everything before `export function parseWorkbook`) with:

```ts
import * as XLSX from 'xlsx';
import type { EnrollmentInput, ParseResult, ParseWarning } from '../../shared/types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError, toIsoDate };

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
```

Leave `export function parseWorkbook(...)` and everything below it exactly as-is — it already only uses `XLSX`, `HEADER_MAP`, `DISPLAY_NAMES`, `normalize`, `str`, `isBlankRow`, `toIsoDate`, and `MissingColumnsError`, all of which are now imported.

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: All existing tests in `tests/parse.test.ts`, `tests/db.test.ts`, `tests/stats.test.ts` still PASS. `tests/parse.test.ts` imports `MissingColumnsError`, `parseWorkbook`, `toIsoDate` from `'../src/excel/parse'` — these must still resolve via the re-export.

- [ ] **Step 4: Commit**

```bash
git add src/excel/shared.ts src/excel/parse.ts
git commit -m "refactor(excel): extract shared parsing helpers for reuse by onboarding parsers"
```

---

### Task 3: Name matching algorithm

There is no shared ID between the master file and the completion report. This is a pure, two-tier normalized-name matcher: exact match first, then a last-name-token + nickname-aware first-name match.

**Files:**
- Create: `worker/onboarding/nameMatch.ts`
- Test: `tests/onboarding/nameMatch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/nameMatch.test.ts
import { describe, expect, it } from 'vitest';
import { matchPerson, normalizeName } from '../../worker/onboarding/nameMatch';

describe('normalizeName', () => {
  it('lowercases, strips accents and punctuation, collapses whitespace', () => {
    expect(normalizeName('Brayan Hernández Escobar')).toBe('brayan hernandez escobar');
    expect(normalizeName('  Jorge   Martin  ')).toBe('jorge martin');
  });
});

describe('matchPerson', () => {
  const candidates = [
    { index: 0, fullName: 'Abbey Litschke' },
    { index: 1, fullName: 'David Peralta Santoyo' },
    { index: 2, fullName: 'Divya Gupta' },
    { index: 3, fullName: 'Christian Luna Rodríguez' },
  ];

  it('matches an exact normalized full name', () => {
    expect(matchPerson('Abbey', 'Litschke', candidates)).toEqual({ index: 0, confidence: 'exact' });
  });

  it('matches via a known nickname when last-name tokens all appear', () => {
    expect(matchPerson('Divs', 'Gupta', candidates)).toEqual({ index: 2, confidence: 'token' });
  });

  it('matches a compound surname where the report drops a middle surname', () => {
    expect(matchPerson('Christian', 'Rodriguez', candidates)).toEqual({ index: 3, confidence: 'token' });
  });

  it('does not match a different person who happens to share a surname', () => {
    expect(matchPerson('Carmela', 'Peralta', candidates)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchPerson('Nobody', 'Unknown', candidates)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/nameMatch.test.ts`
Expected: FAIL — `Cannot find module '../../worker/onboarding/nameMatch'`

- [ ] **Step 3: Implement**

```ts
// worker/onboarding/nameMatch.ts

const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

/** Strips combining diacritical marks left behind by NFD normalization (e.g. accents). */
export function stripDiacritics(s: string): string {
  return [...s.normalize('NFD')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARK_START || code > COMBINING_MARK_END;
    })
    .join('');
}

export function normalizeName(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Preferred-name → legal-first-name aliases seen in real data. Extend as new cases appear. */
const NICKNAMES: Record<string, string> = {
  divs: 'divya',
};

function canonicalFirstName(name: string): string {
  return NICKNAMES[name] ?? name;
}

export interface MatchCandidate {
  index: number;
  fullName: string;
}

export type MatchConfidence = 'exact' | 'token';

export interface MatchOutcome {
  index: number;
  confidence: MatchConfidence;
}

/**
 * Matches a (preferredName, lastName) pair from the completion report against
 * master-file hire candidates. Tier 1: exact normalized full-name match.
 * Tier 2: all normalized last-name tokens appear in the candidate's name, and
 * the first-name tokens match exactly or via the nickname table. First match
 * wins in each tier — good enough for this proof-of-concept phase.
 */
export function matchPerson(
  preferredName: string,
  lastName: string,
  candidates: MatchCandidate[],
): MatchOutcome | null {
  const fullNormalized = normalizeName(`${preferredName} ${lastName}`);
  for (const c of candidates) {
    if (normalizeName(c.fullName) === fullNormalized) {
      return { index: c.index, confidence: 'exact' };
    }
  }

  const lastTokens = normalizeName(lastName).split(' ').filter(Boolean);
  const firstCanonical = canonicalFirstName(normalizeName(preferredName));
  if (lastTokens.length === 0) return null;

  for (const c of candidates) {
    const candTokens = normalizeName(c.fullName).split(' ').filter(Boolean);
    if (candTokens.length === 0) continue;
    const candFirstCanonical = canonicalFirstName(candTokens[0]);
    const hasAllLastTokens = lastTokens.every((t) => candTokens.includes(t));
    if (hasAllLastTokens && candFirstCanonical === firstCanonical) {
      return { index: c.index, confidence: 'token' };
    }
  }

  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/nameMatch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/onboarding/nameMatch.ts tests/onboarding/nameMatch.test.ts
git commit -m "feat(onboarding): add two-tier name matcher for master file <-> completion report"
```

---

### Task 4: Role → Week 2 plan mapping resolver

Computed client-side at read time (not stored at upload time) so editing the mapping table takes effect immediately.

**Files:**
- Create: `src/lib/roleMapping.ts`
- Test: `tests/onboarding/roleMapping.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/roleMapping.test.ts
import { describe, expect, it } from 'vitest';
import type { RolePlanMappingRule } from '../../shared/onboarding-types';
import { resolveWeek2PlanTitle } from '../../src/lib/roleMapping';

const rule = (over: Partial<RolePlanMappingRule> = {}): RolePlanMappingRule => ({
  id: 1, rolePattern: '', departmentPattern: null, countryPattern: null, learningPlanTitle: '', priority: 0, ...over,
});

describe('resolveWeek2PlanTitle', () => {
  const rules: RolePlanMappingRule[] = [
    rule({ id: 1, rolePattern: 'services consultant', learningPlanTitle: 'Jump Start - Services Consultants Core & GL' }),
    rule({ id: 2, rolePattern: 'payroll specialist', learningPlanTitle: 'Jump Start - Managed Payroll Specialist' }),
    rule({ id: 3, rolePattern: 'payroll specialist', countryPattern: 'australia', learningPlanTitle: 'Jump Start - Managed Payroll Specialist ANZ', priority: 10 }),
  ];

  it('matches a role by substring, case-insensitively', () => {
    expect(resolveWeek2PlanTitle({ role: 'Services Consultant Sr', department: 'Services', country: 'Mexico' }, rules))
      .toBe('Jump Start - Services Consultants Core & GL');
  });

  it('prefers a higher-priority, more specific rule', () => {
    expect(resolveWeek2PlanTitle({ role: 'Payroll Specialist III', department: 'Support', country: 'Australia' }, rules))
      .toBe('Jump Start - Managed Payroll Specialist ANZ');
  });

  it('falls back to a less specific rule when the more specific one does not match', () => {
    expect(resolveWeek2PlanTitle({ role: 'Payroll Specialist III', department: 'Support', country: 'India' }, rules))
      .toBe('Jump Start - Managed Payroll Specialist');
  });

  it('returns null when no rule matches', () => {
    expect(resolveWeek2PlanTitle({ role: 'Application Developer', department: 'Support', country: 'USA' }, rules)).toBeNull();
  });

  it('returns null when the hire has no role', () => {
    expect(resolveWeek2PlanTitle({ role: null, department: 'Support', country: 'USA' }, rules)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/roleMapping.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/roleMapping.ts
import type { RolePlanMappingRule } from '../../shared/onboarding-types';

/**
 * Resolves which Week 2 Learning Plan applies to a hire, by checking mapping
 * rules in priority order (highest first) and returning the first rule whose
 * role/department/country patterns all match. Patterns are simple
 * case-insensitive substring checks against the hire's fields — good enough
 * for this admin-editable POC table.
 */
export function resolveWeek2PlanTitle(
  hire: { role: string | null; department: string | null; country: string | null },
  rules: RolePlanMappingRule[],
): string | null {
  const role = (hire.role ?? '').trim().toLowerCase();
  if (!role) return null;
  const department = (hire.department ?? '').trim().toLowerCase();
  const country = (hire.country ?? '').trim().toLowerCase();

  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    const rolePattern = rule.rolePattern.trim().toLowerCase();
    if (!rolePattern || !role.includes(rolePattern)) continue;
    if (rule.departmentPattern && !department.includes(rule.departmentPattern.trim().toLowerCase())) continue;
    if (rule.countryPattern && !country.includes(rule.countryPattern.trim().toLowerCase())) continue;
    return rule.learningPlanTitle;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/roleMapping.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/roleMapping.ts tests/onboarding/roleMapping.test.ts
git commit -m "feat(onboarding): add editable role-to-learning-plan mapping resolver"
```

---

### Task 5: Status and deadline computation

**Files:**
- Create: `src/lib/onboardingStatus.ts`
- Test: `tests/onboarding/onboardingStatus.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/onboardingStatus.test.ts
import { describe, expect, it } from 'vitest';
import { WEEK1_PLAN_TITLE } from '../../shared/onboarding-constants';
import type { HireRecord, RolePlanMappingRule } from '../../shared/onboarding-types';
import { buildHireJourney } from '../../src/lib/onboardingStatus';

const hire = (over: Partial<HireRecord> = {}): HireRecord => ({
  id: 1, eeNumber: '100', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
  hiringManager: 'Maria Rivera', managerSlug: 'maria-rivera', country: 'Mexico',
  hireDate: '2026-09-01', jsDate: '2026-09-01', completions: [], ...over,
});

const rules: RolePlanMappingRule[] = [
  { id: 1, rolePattern: 'services consultant', departmentPattern: null, countryPattern: null, learningPlanTitle: 'Jump Start - Services Consultants Core & GL', priority: 0 },
];

describe('buildHireJourney', () => {
  it('reports not_started before enrollment and before the deadline', () => {
    const j = buildHireJourney(hire({ completions: [] }), rules, '2026-09-03');
    expect(j.week1.status).toBe('not_started');
    expect(j.week2.status).toBe('not_started');
    expect(j.overallStatus).toBe('not_started');
  });

  it('marks Week 1 overdue once the 7-day deadline passes without completion', () => {
    const j = buildHireJourney(hire({ completions: [] }), rules, '2026-09-09');
    expect(j.week1.status).toBe('overdue');
    expect(j.week1.deadline).toBe('2026-09-08');
    expect(j.overallStatus).toBe('behind');
  });

  it('is on track when Week 1 is complete and Week 2 is still in progress before its deadline', () => {
    const completions = [
      { learningPlanTitle: WEEK1_PLAN_TITLE, enrollmentDate: '2026-09-01', completionDate: '2026-09-05', coursesTotal: 5, coursesCompleted: 5 },
      { learningPlanTitle: 'Jump Start - Services Consultants Core & GL', enrollmentDate: '2026-09-05', completionDate: null, coursesTotal: 10, coursesCompleted: 3 },
    ];
    const j = buildHireJourney(hire({ completions }), rules, '2026-09-08');
    expect(j.week1.status).toBe('complete');
    expect(j.week2.status).toBe('in_progress');
    expect(j.overallStatus).toBe('on_track');
  });

  it('is unmapped for Week 2 when the role matches no mapping rule', () => {
    const j = buildHireJourney(hire({ role: 'Mystery Role' }), [], '2026-09-03');
    expect(j.week2.status).toBe('unmapped');
    expect(j.week2.learningPlanTitle).toBeNull();
    expect(j.overallStatus).toBe('unmapped');
  });

  it('reports no_start_date when jsDate is missing, regardless of plan status', () => {
    const j = buildHireJourney(hire({ jsDate: null }), rules, '2026-09-03');
    expect(j.overallStatus).toBe('no_start_date');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/onboardingStatus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/onboardingStatus.ts
import { WEEK1_DEADLINE_DAYS, WEEK1_PLAN_TITLE, WEEK2_DEADLINE_DAYS } from '../../shared/onboarding-constants';
import type { HireJourney, HireRecord, OverallStatus, PlanJourney, PlanStatus, RolePlanMappingRule } from '../../shared/onboarding-types';
import { resolveWeek2PlanTitle } from './roleMapping';

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function buildJourney(
  planTitle: string | null,
  jsDate: string | null,
  deadlineDays: number,
  completions: HireRecord['completions'],
  today: string,
): PlanJourney {
  if (planTitle === null) {
    return { learningPlanTitle: null, status: 'unmapped', deadline: null, enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0 };
  }
  const record = completions.find((c) => c.learningPlanTitle === planTitle) ?? null;
  const deadline = jsDate ? addDaysIso(jsDate, deadlineDays) : null;

  let status: PlanStatus;
  if (record?.completionDate) {
    status = 'complete';
  } else {
    const overdue = deadline !== null && today > deadline;
    if (record) status = overdue ? 'overdue' : 'in_progress';
    else status = overdue ? 'overdue' : 'not_started';
  }

  return {
    learningPlanTitle: planTitle,
    status,
    deadline,
    enrollmentDate: record?.enrollmentDate ?? null,
    completionDate: record?.completionDate ?? null,
    coursesTotal: record?.coursesTotal ?? 0,
    coursesCompleted: record?.coursesCompleted ?? 0,
  };
}

const STATUS_RANK: Record<PlanStatus, number> = {
  complete: 0,
  in_progress: 1,
  not_started: 2,
  unmapped: 3,
  overdue: 4,
};

function overallFromPlans(week1: PlanStatus, week2: PlanStatus): OverallStatus {
  const worse = STATUS_RANK[week1] >= STATUS_RANK[week2] ? week1 : week2;
  if (worse === 'complete' || worse === 'in_progress') return 'on_track';
  if (worse === 'overdue') return 'behind';
  if (worse === 'unmapped') return 'unmapped';
  return 'not_started';
}

/** Builds the full onboarding story for one hire: Week 1 + Week 2 journeys and an overall status. */
export function buildHireJourney(hire: HireRecord, rules: RolePlanMappingRule[], today: string): HireJourney {
  const week1 = buildJourney(WEEK1_PLAN_TITLE, hire.jsDate, WEEK1_DEADLINE_DAYS, hire.completions, today);
  const week2PlanTitle = resolveWeek2PlanTitle(hire, rules);
  const week2 = buildJourney(week2PlanTitle, hire.jsDate, WEEK2_DEADLINE_DAYS, hire.completions, today);
  const overallStatus: OverallStatus = hire.jsDate === null ? 'no_start_date' : overallFromPlans(week1.status, week2.status);
  return { hire, week1, week2, overallStatus };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/onboardingStatus.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboardingStatus.ts tests/onboarding/onboardingStatus.test.ts
git commit -m "feat(onboarding): compute Week 1/Week 2 journey status against fixed deadlines"
```

---

### Task 6: Master file parser (Jump Start + JS LPs sheets)

**Files:**
- Create: `src/excel/parseMasterFile.ts`
- Test: `tests/onboarding/parseMasterFile.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/parseMasterFile.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MissingColumnsError, parseMasterFile } from '../../src/excel/parseMasterFile';

const HIRE_HEADERS = ['Hire Date', 'JS Date', 'First & Last Name', 'Department', 'EE#', 'Role', 'Hiring Manager ', 'Country', 'Time Zone', 'VP Level'];
const PLAN_HEADERS = ['Title', 'Category', 'Audience', 'Department', 'Region'];

function workbook(hireRows: unknown[][], planRows: unknown[][] = [['Jump Start - Week 1', 'Week 1', 'All', 'GCO', 'All']]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HIRE_HEADERS, ...hireRows]), 'Jump Start');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PLAN_HEADERS, ...planRows]), 'JS LPs');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const fullHireRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = ['2026-09-01', '2026-09-01', 'Jane Cooper', 'Services', '323292', 'Services Consultant', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'];
  return base.map((v, i) => (i in over ? over[i] : v));
};

describe('parseMasterFile', () => {
  it('parses a happy-path hire row and plan row', () => {
    const result = parseMasterFile(workbook([fullHireRow()]));
    expect(result.hires).toEqual([{
      eeNumber: '323292', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
      hiringManager: 'Maria Rivera', country: 'Mexico', hireDate: '2026-09-01', jsDate: '2026-09-01',
    }]);
    expect(result.plans).toEqual([{ title: 'Jump Start - Week 1', category: 'Week 1', audience: 'All', department: 'GCO', region: 'All' }]);
    expect(result.skipped).toEqual([]);
  });

  it('matches the "Hiring Manager " header despite its trailing space', () => {
    const result = parseMasterFile(workbook([fullHireRow()]));
    expect(result.hires[0].hiringManager).toBe('Maria Rivera');
  });

  it('skips rows with no name', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 2: '' })]));
    expect(result.hires).toHaveLength(0);
    expect(result.skipped).toEqual([{ row: 2, message: 'Missing First & Last Name' }]);
  });

  it('keeps a hire with no EE# or Role, treating them as null', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 4: '', 5: '' })]));
    expect(result.hires[0].eeNumber).toBeNull();
    expect(result.hires[0].role).toBeNull();
  });

  it('converts an Excel serial-number date', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 0: 46167, 1: 46167 })]));
    expect(result.hires[0].hireDate).toBe('2026-05-25');
  });

  it('keeps a hire with no JS Date, warning that deadlines cannot be computed', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 1: '' })]));
    expect(result.hires[0].jsDate).toBeNull();
    expect(result.warnings).toContainEqual({ row: 2, message: 'No JS Date — deadlines cannot be computed for this hire' });
  });

  it('throws MissingColumnsError naming every missing hire-sheet header', () => {
    const headers = HIRE_HEADERS.filter((h) => h !== 'EE#' && h !== 'Country');
    const row = fullHireRow().filter((_, i) => i !== 4 && i !== 7);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, row]), 'Jump Start');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PLAN_HEADERS]), 'JS LPs');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseMasterFile(buf)).toThrowError(MissingColumnsError);
  });

  it('throws when the "JS LPs" sheet is missing', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HIRE_HEADERS, fullHireRow()]), 'Jump Start');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseMasterFile(buf)).toThrowError('Workbook has no "JS LPs" sheet');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/parseMasterFile.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/excel/parseMasterFile.ts
import * as XLSX from 'xlsx';
import type { LearningPlanDefInput, MasterParseResult, NewHireInput, ParseWarning } from '../../shared/onboarding-types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError };

const HIRE_SHEET_NAME = 'Jump Start';
const PLAN_SHEET_NAME = 'JS LPs';

const HIRE_HEADER_MAP: Record<string, HireField> = {
  'hire date': 'hireDate',
  'js date': 'jsDate',
  'first & last name': 'fullName',
  'department': 'department',
  'ee#': 'eeNumber',
  'role': 'role',
  'hiring manager': 'hiringManager',
  'country': 'country',
};
type HireField = 'hireDate' | 'jsDate' | 'fullName' | 'department' | 'eeNumber' | 'role' | 'hiringManager' | 'country';

const HIRE_DISPLAY_NAMES: Record<string, string> = {
  'hire date': 'Hire Date',
  'js date': 'JS Date',
  'first & last name': 'First & Last Name',
  'department': 'Department',
  'ee#': 'EE#',
  'role': 'Role',
  'hiring manager': 'Hiring Manager',
  'country': 'Country',
};

const PLAN_HEADER_MAP: Record<string, PlanField> = {
  'title': 'title',
  'category': 'category',
  'audience': 'audience',
  'department': 'department',
  'region': 'region',
};
type PlanField = 'title' | 'category' | 'audience' | 'department' | 'region';

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  title: 'Title', category: 'Category', audience: 'Audience', department: 'Department', region: 'Region',
};

function sheetGrid(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook has no "${sheetName}" sheet`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: null });
}

export function parseMasterFile(data: ArrayBuffer | Uint8Array): MasterParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });

  const hireGrid = sheetGrid(wb, HIRE_SHEET_NAME);
  const hireHeaderRow = hireGrid[0];
  if (!hireHeaderRow) throw new Error(`"${HIRE_SHEET_NAME}" sheet contains no data rows`);

  const hireCols = new Map<HireField, number>();
  hireHeaderRow.forEach((cell, idx) => {
    const field = HIRE_HEADER_MAP[normalize(str(cell))];
    if (field && !hireCols.has(field)) hireCols.set(field, idx);
  });
  const missingHireCols = Object.entries(HIRE_HEADER_MAP)
    .filter(([, field]) => !hireCols.has(field))
    .map(([norm]) => HIRE_DISPLAY_NAMES[norm]);
  if (missingHireCols.length > 0) throw new MissingColumnsError(missingHireCols);
  const getHire = (row: unknown[], field: HireField) => row[hireCols.get(field)!];

  const skipped: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];
  const hires: NewHireInput[] = [];

  hireGrid.slice(1).forEach((row, i) => {
    const excelRow = i + 2;
    if (isBlankRow(row)) return;
    const fullName = str(getHire(row, 'fullName'));
    if (!fullName) {
      skipped.push({ row: excelRow, message: 'Missing First & Last Name' });
      return;
    }

    const hireDate = toIsoDate(getHire(row, 'hireDate'));
    if (!hireDate.ok) warnings.push({ row: excelRow, message: 'Unreadable Hire Date — stored as blank' });
    const jsDate = toIsoDate(getHire(row, 'jsDate'));
    if (!jsDate.ok) warnings.push({ row: excelRow, message: 'Unreadable JS Date — stored as blank' });
    else if (jsDate.iso === null) warnings.push({ row: excelRow, message: 'No JS Date — deadlines cannot be computed for this hire' });

    hires.push({
      eeNumber: str(getHire(row, 'eeNumber')) || null,
      fullName,
      department: str(getHire(row, 'department')) || null,
      role: str(getHire(row, 'role')) || null,
      hiringManager: str(getHire(row, 'hiringManager')) || null,
      country: str(getHire(row, 'country')) || null,
      hireDate: hireDate.iso,
      jsDate: jsDate.iso,
    });
  });

  const planGrid = sheetGrid(wb, PLAN_SHEET_NAME);
  const planHeaderRow = planGrid[0];
  if (!planHeaderRow) throw new Error(`"${PLAN_SHEET_NAME}" sheet contains no data rows`);

  const planCols = new Map<PlanField, number>();
  planHeaderRow.forEach((cell, idx) => {
    const field = PLAN_HEADER_MAP[normalize(str(cell))];
    if (field && !planCols.has(field)) planCols.set(field, idx);
  });
  const missingPlanCols = Object.entries(PLAN_HEADER_MAP)
    .filter(([, field]) => !planCols.has(field))
    .map(([norm]) => PLAN_DISPLAY_NAMES[norm]);
  if (missingPlanCols.length > 0) throw new MissingColumnsError(missingPlanCols);
  const getPlan = (row: unknown[], field: PlanField) => row[planCols.get(field)!];

  const plans: LearningPlanDefInput[] = [];
  planGrid.slice(1).forEach((row, i) => {
    const excelRow = i + 2;
    if (isBlankRow(row)) return;
    const title = str(getPlan(row, 'title'));
    if (!title) {
      skipped.push({ row: excelRow, message: `Missing Title in "${PLAN_SHEET_NAME}" sheet` });
      return;
    }
    plans.push({
      title,
      category: str(getPlan(row, 'category')) || null,
      audience: str(getPlan(row, 'audience')) || null,
      department: str(getPlan(row, 'department')) || null,
      region: str(getPlan(row, 'region')) || null,
    });
  });

  return { hires, plans, skipped, warnings };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/parseMasterFile.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/excel/parseMasterFile.ts tests/onboarding/parseMasterFile.test.ts
git commit -m "feat(onboarding): parse Jump Start master file (hire roster + JS LPs sheet)"
```

---

### Task 7: Completion report parser

The Dayforce export has a Dayforce-generated filter-summary line above the real header row, so the parser locates the header row by content rather than assuming a fixed index.

**Files:**
- Create: `src/excel/parseCompletionReport.ts`
- Test: `tests/onboarding/parseCompletionReport.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/parseCompletionReport.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCompletionReport } from '../../src/excel/parseCompletionReport';

const METADATA_ROW = ['MyDayforce | Learning Plan Completion Report | Dayforce filters...'];
const HEADERS = [
  'Preferred Name', 'Employee Last Name', 'Business Email', 'Job Assignment Name', 'Learning Plan',
  'Learning Plan Enrollment Date', 'Course', 'Course Enrollment Start', 'Course Enrolment Completion',
  'Course Score', 'Manager', 'Second Level Manager', 'Primary Address Country', 'Department Name',
  'Location Name', 'Course Duration', 'Learning Plan Completion Date',
];

function workbook(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([METADATA_ROW, HEADERS, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const courseRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = [
    'Abbey', 'Litschke', 'Abbey.Litschke@dayforce.com', 'Services Consultant', 'Jump Start - Week 1',
    '2026-09-01', 'Course A', '2026-09-01', '2026-09-02', '', 'Maria Rivera', 'Someone', 'Mexico',
    'Implementation', 'Location', 900, '2026-09-05',
  ];
  return base.map((v, i) => (i in over ? over[i] : v));
};

describe('parseCompletionReport', () => {
  it('rolls up multiple course rows into one row per (person, plan)', () => {
    const result = parseCompletionReport(workbook([
      courseRow({ 6: 'Course A', 8: '2026-09-02' }),
      courseRow({ 6: 'Course B', 8: '' }),
    ]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      preferredName: 'Abbey', lastName: 'Litschke', learningPlanTitle: 'Jump Start - Week 1',
      enrollmentDate: '2026-09-01', completionDate: '2026-09-05', coursesTotal: 2, coursesCompleted: 1,
    });
  });

  it('treats the same person enrolled in two plans as two separate rows', () => {
    const result = parseCompletionReport(workbook([
      courseRow({ 4: 'Jump Start - Week 1' }),
      courseRow({ 4: 'Jump Start - Services Consultants Core & GL', 16: '' }),
    ]));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.learningPlanTitle).sort()).toEqual([
      'Jump Start - Services Consultants Core & GL', 'Jump Start - Week 1',
    ]);
  });

  it('leaves completionDate null while the plan is still in progress', () => {
    const result = parseCompletionReport(workbook([courseRow({ 16: '' })]));
    expect(result.rows[0].completionDate).toBeNull();
  });

  it('skips rows missing a name or Learning Plan', () => {
    const result = parseCompletionReport(workbook([courseRow({ 0: '' }), courseRow({ 4: '' })]));
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([
      { row: 3, message: 'Missing name or Learning Plan' },
      { row: 4, message: 'Missing name or Learning Plan' },
    ]);
  });

  it('finds the header row even with a longer metadata block above it', () => {
    const wb = XLSX.utils.book_new();
    const extraMetadata = [['line 1'], ['line 2'], ['line 3']];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...extraMetadata, HEADERS, courseRow()]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(parseCompletionReport(buf).rows).toHaveLength(1);
  });

  it('throws when the header row cannot be found', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['no headers here'], ['still nothing']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseCompletionReport(buf)).toThrowError('Could not find the header row');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/parseCompletionReport.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/excel/parseCompletionReport.ts
import * as XLSX from 'xlsx';
import type { CompletionReportParseResult, CompletionRowInput, ParseWarning } from '../../shared/onboarding-types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError };

type Field = 'preferredName' | 'lastName' | 'learningPlanTitle' | 'enrollmentDate' | 'courseCompletionDate' | 'planCompletionDate';

const HEADER_MAP: Record<string, Field> = {
  'preferred name': 'preferredName',
  'employee last name': 'lastName',
  'learning plan': 'learningPlanTitle',
  'learning plan enrollment date': 'enrollmentDate',
  'course enrolment completion': 'courseCompletionDate',
  'learning plan completion date': 'planCompletionDate',
};

const DISPLAY_NAMES: Record<string, string> = {
  'preferred name': 'Preferred Name',
  'employee last name': 'Employee Last Name',
  'learning plan': 'Learning Plan',
  'learning plan enrollment date': 'Learning Plan Enrollment Date',
  'course enrolment completion': 'Course Enrolment Completion',
  'learning plan completion date': 'Learning Plan Completion Date',
};

function findHeaderRowIndex(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    if (row.some((cell) => normalize(str(cell)) === 'preferred name')) return i;
  }
  return -1;
}

interface Group {
  preferredName: string;
  lastName: string;
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export function parseCompletionReport(data: ArrayBuffer | Uint8Array): CompletionReportParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, blankrows: true, defval: null });

  const headerIdx = findHeaderRowIndex(grid);
  if (headerIdx === -1) {
    throw new Error('Could not find the header row (expected a "Preferred Name" column within the first 10 rows)');
  }
  const headerRow = grid[headerIdx];
  const dataRows = grid.slice(headerIdx + 1);

  const colByField = new Map<Field, number>();
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normalize(str(cell))];
    if (field && !colByField.has(field)) colByField.set(field, idx);
  });
  const missing = Object.entries(HEADER_MAP)
    .filter(([, field]) => !colByField.has(field))
    .map(([norm]) => DISPLAY_NAMES[norm]);
  if (missing.length > 0) throw new MissingColumnsError(missing);
  const get = (row: unknown[], field: Field) => row[colByField.get(field)!];

  const skipped: ParseWarning[] = [];
  const groups = new Map<string, Group>();

  dataRows.forEach((row, i) => {
    const excelRow = headerIdx + 2 + i;
    if (isBlankRow(row)) return;

    const preferredName = str(get(row, 'preferredName'));
    const lastName = str(get(row, 'lastName'));
    const learningPlanTitle = str(get(row, 'learningPlanTitle'));
    if (!preferredName || !lastName || !learningPlanTitle) {
      skipped.push({ row: excelRow, message: 'Missing name or Learning Plan' });
      return;
    }

    const key = `${normalize(preferredName)}||${normalize(lastName)}||${learningPlanTitle}`;
    const enroll = toIsoDate(get(row, 'enrollmentDate'));
    const g = groups.get(key) ?? {
      preferredName, lastName, learningPlanTitle,
      enrollmentDate: enroll.iso, completionDate: null, coursesTotal: 0, coursesCompleted: 0,
    };
    g.coursesTotal += 1;
    if (toIsoDate(get(row, 'courseCompletionDate')).iso) g.coursesCompleted += 1;
    const planDone = toIsoDate(get(row, 'planCompletionDate'));
    if (planDone.iso && !g.completionDate) g.completionDate = planDone.iso;
    groups.set(key, g);
  });

  const rows: CompletionRowInput[] = [...groups.values()];
  return { rows, skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/parseCompletionReport.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/excel/parseCompletionReport.ts tests/onboarding/parseCompletionReport.test.ts
git commit -m "feat(onboarding): parse and roll up the Dayforce completion report"
```

---

## Group B: Database and Worker API

### Task 8: Database migration

**Files:**
- Create: `migrations/0002_onboarding.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE new_hires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ee_number TEXT UNIQUE,
  full_name TEXT NOT NULL,
  department TEXT,
  role TEXT,
  hiring_manager TEXT,
  manager_slug TEXT,
  country TEXT,
  hire_date TEXT,
  js_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE learning_plan_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  category TEXT,
  audience TEXT,
  department TEXT,
  region TEXT
);

CREATE TABLE role_plan_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_pattern TEXT NOT NULL,
  department_pattern TEXT,
  country_pattern TEXT,
  learning_plan_title TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plan_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_hire_id INTEGER NOT NULL REFERENCES new_hires(id),
  learning_plan_title TEXT NOT NULL,
  enrollment_date TEXT,
  completion_date TEXT,
  courses_total INTEGER NOT NULL DEFAULT 0,
  courses_completed INTEGER NOT NULL DEFAULT 0,
  match_confidence TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (new_hire_id, learning_plan_title)
);

CREATE TABLE onboarding_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_processed INTEGER NOT NULL,
  rows_matched INTEGER,
  rows_unmatched INTEGER
);
```

- [ ] **Step 2: Apply it to the local D1 database**

Run: `npm run db:migrate:local`
Expected: Output confirms `0002_onboarding.sql` applied.

- [ ] **Step 3: Commit**

```bash
git add migrations/0002_onboarding.sql
git commit -m "feat(onboarding): add database schema for new hires, plans, mapping, completions"
```

---

### Task 9: Worker DB helpers

**Files:**
- Create: `worker/onboarding/db.ts`
- Test: `tests/onboarding/db.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/onboarding/db.test.ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewHireInput } from '../../shared/onboarding-types';
import {
  assembleHires,
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  slugify,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from '../../worker/onboarding/db';

const migration = readFileSync('migrations/0002_onboarding.sql', 'utf8');

const hire = (over: Partial<NewHireInput> = {}): NewHireInput => ({
  eeNumber: '100', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
  hiringManager: 'Maria Rivera', country: 'Mexico', hireDate: '2026-09-01', jsDate: '2026-09-01', ...over,
});

describe('slugify', () => {
  it('lowercases, strips accents, and dashes a manager name', () => {
    expect(slugify('María Rivera')).toBe('maria-rivera');
  });
});

describe('new_hires upsert', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration);
  });

  const upsertHire = (h: NewHireInput, now = '2026-09-13T00:00:00Z') =>
    db.prepare(UPSERT_HIRE_SQL).run(...(hireUpsertParams(h, now) as never[]));

  it('inserts a new hire with a derived manager slug', () => {
    upsertHire(hire());
    const stored = db.prepare('SELECT * FROM new_hires').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].manager_slug).toBe('maria-rivera');
  });

  it('updates in place when the same ee_number is uploaded again', () => {
    upsertHire(hire());
    upsertHire(hire({ role: 'Services Consultant Sr' }), '2026-09-14T00:00:00Z');
    const stored = db.prepare('SELECT * FROM new_hires').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe('Services Consultant Sr');
  });

  it('inserts a fresh row each time for hires with no ee_number (known POC limitation)', () => {
    upsertHire(hire({ eeNumber: null, fullName: 'No Number Person' }));
    upsertHire(hire({ eeNumber: null, fullName: 'No Number Person' }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM new_hires').get()).toEqual({ n: 2 });
  });
});

describe('learning_plan_defs upsert', () => {
  it('inserts and updates by title', () => {
    const db = new Database(':memory:');
    db.exec(migration);
    const def = { title: 'Jump Start - Week 1', category: 'Week 1', audience: 'All', department: 'GCO', region: 'All' };
    db.prepare(UPSERT_PLAN_DEF_SQL).run(...(planDefParams(def) as never[]));
    db.prepare(UPSERT_PLAN_DEF_SQL).run(...(planDefParams({ ...def, region: 'Updated' }) as never[]));
    const stored = db.prepare('SELECT * FROM learning_plan_defs').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].region).toBe('Updated');
  });
});

describe('plan_completions upsert', () => {
  let db: Database.Database;
  let hireId: number;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration);
    db.prepare(UPSERT_HIRE_SQL).run(...(hireUpsertParams(hire(), '2026-09-13T00:00:00Z') as never[]));
    hireId = (db.prepare('SELECT id FROM new_hires').get() as { id: number }).id;
  });

  it('inserts and then updates a completion record for the same (hire, plan)', () => {
    const row = { learningPlanTitle: 'Jump Start - Week 1', enrollmentDate: '2026-09-01', completionDate: null, coursesTotal: 5, coursesCompleted: 2 };
    db.prepare(UPSERT_COMPLETION_SQL).run(...(completionUpsertParams(hireId, row, 'exact', '2026-09-13T00:00:00Z') as never[]));
    db.prepare(UPSERT_COMPLETION_SQL).run(
      ...(completionUpsertParams(hireId, { ...row, completionDate: '2026-09-06', coursesCompleted: 5 }, 'exact', '2026-09-14T00:00:00Z') as never[]),
    );
    const stored = db.prepare('SELECT * FROM plan_completions').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].completion_date).toBe('2026-09-06');
    expect(stored[0].courses_completed).toBe(5);
  });
});

describe('assembleHires', () => {
  it('groups plan_completions under their matching hire', () => {
    const hireRows = [
      { id: 1, ee_number: '100', full_name: 'Jane Cooper', department: 'Services', role: 'Services Consultant', hiring_manager: 'Maria Rivera', manager_slug: 'maria-rivera', country: 'Mexico', hire_date: '2026-09-01', js_date: '2026-09-01' },
      { id: 2, ee_number: '101', full_name: 'Bob Ross', department: 'Support', role: 'Payroll Specialist', hiring_manager: 'Kevin Tan', manager_slug: 'kevin-tan', country: 'India', hire_date: '2026-09-01', js_date: '2026-09-01' },
    ];
    const completionRows = [
      { new_hire_id: 1, learning_plan_title: 'Jump Start - Week 1', enrollment_date: '2026-09-01', completion_date: '2026-09-05', courses_total: 5, courses_completed: 5 },
    ];
    const hires = assembleHires(hireRows, completionRows);
    expect(hires.find((h) => h.id === 1)?.completions).toHaveLength(1);
    expect(hires.find((h) => h.id === 2)?.completions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/db.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// worker/onboarding/db.ts
import type { HireRecord, LearningPlanDefInput, NewHireInput, PlanCompletionRecord, RolePlanMappingRule } from '../../shared/onboarding-types';
import { stripDiacritics } from './nameMatch';

export function slugify(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const UPSERT_HIRE_SQL = `
INSERT INTO new_hires
  (ee_number, full_name, department, role, hiring_manager, manager_slug, country, hire_date, js_date, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (ee_number) DO UPDATE SET
  full_name = excluded.full_name,
  department = excluded.department,
  role = excluded.role,
  hiring_manager = excluded.hiring_manager,
  manager_slug = excluded.manager_slug,
  country = excluded.country,
  hire_date = excluded.hire_date,
  js_date = excluded.js_date,
  updated_at = excluded.updated_at
`;

// NOTE: SQLite treats every NULL as distinct for a UNIQUE constraint, so rows with
// no ee_number never conflict — they always insert fresh (see the "known POC
// limitation" test in tests/onboarding/db.test.ts). Fine for this proof of concept.
export function hireUpsertParams(h: NewHireInput, now: string): (string | null)[] {
  return [
    h.eeNumber,
    h.fullName,
    h.department,
    h.role,
    h.hiringManager,
    h.hiringManager ? slugify(h.hiringManager) : null,
    h.country,
    h.hireDate,
    h.jsDate,
    now,
  ];
}

export const UPSERT_PLAN_DEF_SQL = `
INSERT INTO learning_plan_defs (title, category, audience, department, region)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (title) DO UPDATE SET
  category = excluded.category,
  audience = excluded.audience,
  department = excluded.department,
  region = excluded.region
`;

export function planDefParams(p: LearningPlanDefInput): (string | null)[] {
  return [p.title, p.category, p.audience, p.department, p.region];
}

export const UPSERT_COMPLETION_SQL = `
INSERT INTO plan_completions
  (new_hire_id, learning_plan_title, enrollment_date, completion_date, courses_total, courses_completed, match_confidence, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (new_hire_id, learning_plan_title) DO UPDATE SET
  enrollment_date = excluded.enrollment_date,
  completion_date = excluded.completion_date,
  courses_total = excluded.courses_total,
  courses_completed = excluded.courses_completed,
  match_confidence = excluded.match_confidence,
  updated_at = excluded.updated_at
`;

export function completionUpsertParams(
  newHireId: number,
  row: { learningPlanTitle: string; enrollmentDate: string | null; completionDate: string | null; coursesTotal: number; coursesCompleted: number },
  confidence: 'exact' | 'token',
  now: string,
): (string | number | null)[] {
  return [
    newHireId,
    row.learningPlanTitle,
    row.enrollmentDate,
    row.completionDate,
    row.coursesTotal,
    row.coursesCompleted,
    confidence,
    now,
  ];
}

function rowToHire(row: Record<string, unknown>): Omit<HireRecord, 'completions'> {
  return {
    id: row.id as number,
    eeNumber: row.ee_number as string | null,
    fullName: row.full_name as string,
    department: row.department as string | null,
    role: row.role as string | null,
    hiringManager: row.hiring_manager as string | null,
    managerSlug: row.manager_slug as string | null,
    country: row.country as string | null,
    hireDate: row.hire_date as string | null,
    jsDate: row.js_date as string | null,
  };
}

function rowToCompletion(row: Record<string, unknown>): PlanCompletionRecord {
  return {
    learningPlanTitle: row.learning_plan_title as string,
    enrollmentDate: row.enrollment_date as string | null,
    completionDate: row.completion_date as string | null,
    coursesTotal: row.courses_total as number,
    coursesCompleted: row.courses_completed as number,
  };
}

/** Groups raw plan_completions rows under their matching hire, producing full HireRecords. */
export function assembleHires(
  hireRows: Record<string, unknown>[],
  completionRows: Record<string, unknown>[],
): HireRecord[] {
  const byHireId = new Map<number, PlanCompletionRecord[]>();
  for (const row of completionRows) {
    const hireId = row.new_hire_id as number;
    const list = byHireId.get(hireId) ?? [];
    list.push(rowToCompletion(row));
    byHireId.set(hireId, list);
  }
  return hireRows.map((row) => ({
    ...rowToHire(row),
    completions: byHireId.get(row.id as number) ?? [],
  }));
}

export function rowToMappingRule(row: Record<string, unknown>): RolePlanMappingRule {
  return {
    id: row.id as number,
    rolePattern: row.role_pattern as string,
    departmentPattern: row.department_pattern as string | null,
    countryPattern: row.country_pattern as string | null,
    learningPlanTitle: row.learning_plan_title as string,
    priority: row.priority as number,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/db.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/onboarding/db.ts tests/onboarding/db.test.ts
git commit -m "feat(onboarding): add worker DB helpers for hires, plans, mapping, completions"
```

---

### Task 10: Worker routes — master file upload

**Files:**
- Create: `worker/onboarding/routes.ts`
- Modify: `worker/index.ts` (mount the new routes)

- [ ] **Step 1: Create the routes file with the master upload endpoint**

```ts
// worker/onboarding/routes.ts
import { Hono } from 'hono';
import type { MasterParseResult, MasterUploadResponse } from '../../shared/onboarding-types';
import { hireUpsertParams, planDefParams, UPSERT_HIRE_SQL, UPSERT_PLAN_DEF_SQL } from './db';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.post('/api/onboarding/uploads/master', async (c) => {
  const body = await c.req.json<MasterParseResult & { filename?: string }>().catch(() => null);
  if (!body || !Array.isArray(body.hires) || !Array.isArray(body.plans)) {
    return c.json({ error: 'Body must include hires[] and plans[] arrays' }, 400);
  }
  if (body.hires.length + body.plans.length > 5000) {
    return c.json({ error: 'Too many rows in one upload (max 5000 combined hires + plans)' }, 400);
  }
  for (const h of body.hires) {
    if (typeof h.fullName !== 'string' || !h.fullName) {
      return c.json({ error: 'Every hire needs a fullName' }, 400);
    }
  }
  for (const p of body.plans) {
    if (typeof p.title !== 'string' || !p.title) {
      return c.json({ error: 'Every plan needs a title' }, 400);
    }
  }

  const now = new Date().toISOString();
  const hireStmt = c.env.DB.prepare(UPSERT_HIRE_SQL);
  const planStmt = c.env.DB.prepare(UPSERT_PLAN_DEF_SQL);
  const historyStmt = c.env.DB
    .prepare(
      `INSERT INTO onboarding_uploads (file_type, filename, uploaded_at, rows_processed, rows_matched, rows_unmatched)
       VALUES ('master', ?, ?, ?, NULL, NULL)`,
    )
    .bind(body.filename ?? 'master.xlsx', now, body.hires.length + body.plans.length);

  await c.env.DB.batch([
    ...body.hires.map((h) => hireStmt.bind(...hireUpsertParams(h, now))),
    ...body.plans.map((p) => planStmt.bind(...planDefParams(p))),
    historyStmt,
  ]);

  const response: MasterUploadResponse = { hiresProcessed: body.hires.length, plansProcessed: body.plans.length };
  return c.json(response);
});

app.onError((err, c) => {
  console.error('Onboarding API error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
```

- [ ] **Step 2: Mount it in `worker/index.ts`**

Add near the top, after the existing imports:

```ts
import onboardingApp from './onboarding/routes';
```

Add right before the `app.onError(...)` call at the bottom of the file:

```ts
app.route('/', onboardingApp);
```

- [ ] **Step 3: Verify the existing worker tests and build still pass**

Run: `npm test`
Expected: All tests PASS (this task adds no new automated test — it's exercised by the manual verification in Task 24).

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add worker/onboarding/routes.ts worker/index.ts
git commit -m "feat(onboarding): add master-file upload endpoint"
```

---

### Task 11: Worker routes — completion report upload (with matching)

**Files:**
- Modify: `worker/onboarding/routes.ts`

- [ ] **Step 1: Replace `worker/onboarding/routes.ts` with this full content** (adds the completion-report endpoint and its imports to the file from Task 10)

```ts
// worker/onboarding/routes.ts
import { Hono } from 'hono';
import type {
  CompletionRowInput,
  CompletionUploadResponse,
  MasterParseResult,
  MasterUploadResponse,
} from '../../shared/onboarding-types';
import {
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from './db';
import { matchPerson, type MatchCandidate } from './nameMatch';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.post('/api/onboarding/uploads/master', async (c) => {
  const body = await c.req.json<MasterParseResult & { filename?: string }>().catch(() => null);
  if (!body || !Array.isArray(body.hires) || !Array.isArray(body.plans)) {
    return c.json({ error: 'Body must include hires[] and plans[] arrays' }, 400);
  }
  if (body.hires.length + body.plans.length > 5000) {
    return c.json({ error: 'Too many rows in one upload (max 5000 combined hires + plans)' }, 400);
  }
  for (const h of body.hires) {
    if (typeof h.fullName !== 'string' || !h.fullName) {
      return c.json({ error: 'Every hire needs a fullName' }, 400);
    }
  }
  for (const p of body.plans) {
    if (typeof p.title !== 'string' || !p.title) {
      return c.json({ error: 'Every plan needs a title' }, 400);
    }
  }

  const now = new Date().toISOString();
  const hireStmt = c.env.DB.prepare(UPSERT_HIRE_SQL);
  const planStmt = c.env.DB.prepare(UPSERT_PLAN_DEF_SQL);
  const historyStmt = c.env.DB
    .prepare(
      `INSERT INTO onboarding_uploads (file_type, filename, uploaded_at, rows_processed, rows_matched, rows_unmatched)
       VALUES ('master', ?, ?, ?, NULL, NULL)`,
    )
    .bind(body.filename ?? 'master.xlsx', now, body.hires.length + body.plans.length);

  await c.env.DB.batch([
    ...body.hires.map((h) => hireStmt.bind(...hireUpsertParams(h, now))),
    ...body.plans.map((p) => planStmt.bind(...planDefParams(p))),
    historyStmt,
  ]);

  const response: MasterUploadResponse = { hiresProcessed: body.hires.length, plansProcessed: body.plans.length };
  return c.json(response);
});

app.post('/api/onboarding/uploads/completion-report', async (c) => {
  const body = await c.req.json<{ filename?: string; rows?: CompletionRowInput[] }>().catch(() => null);
  if (!body || !Array.isArray(body.rows)) {
    return c.json({ error: 'Body must include a rows[] array' }, 400);
  }
  if (body.rows.length > 5000) {
    return c.json({ error: 'Too many rows in one upload (max 5000)' }, 400);
  }
  for (const r of body.rows) {
    if (
      typeof r.preferredName !== 'string' || !r.preferredName ||
      typeof r.lastName !== 'string' || !r.lastName ||
      typeof r.learningPlanTitle !== 'string' || !r.learningPlanTitle
    ) {
      return c.json({ error: 'Every row needs preferredName, lastName, and learningPlanTitle' }, 400);
    }
  }

  const { results } = await c.env.DB.prepare('SELECT id, full_name FROM new_hires').all();
  const candidates: MatchCandidate[] = results.map((r, index) => ({ index, fullName: r.full_name as string }));
  const idByIndex = results.map((r) => r.id as number);

  const now = new Date().toISOString();
  const stmt = c.env.DB.prepare(UPSERT_COMPLETION_SQL);
  const binds: D1PreparedStatement[] = [];
  let matchedExact = 0;
  let matchedToken = 0;
  let unmatched = 0;

  for (const row of body.rows) {
    const outcome = matchPerson(row.preferredName, row.lastName, candidates);
    if (!outcome) {
      unmatched += 1;
      continue;
    }
    if (outcome.confidence === 'exact') matchedExact += 1;
    else matchedToken += 1;
    const newHireId = idByIndex[outcome.index];
    binds.push(stmt.bind(...completionUpsertParams(newHireId, row, outcome.confidence, now)));
  }

  const historyStmt = c.env.DB
    .prepare(
      `INSERT INTO onboarding_uploads (file_type, filename, uploaded_at, rows_processed, rows_matched, rows_unmatched)
       VALUES ('completion_report', ?, ?, ?, ?, ?)`,
    )
    .bind(body.filename ?? 'completion-report.xlsx', now, body.rows.length, matchedExact + matchedToken, unmatched);

  await c.env.DB.batch([...binds, historyStmt]);

  const response: CompletionUploadResponse = { processed: body.rows.length, matchedExact, matchedToken, unmatched };
  return c.json(response);
});

app.onError((err, c) => {
  console.error('Onboarding API error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add worker/onboarding/routes.ts
git commit -m "feat(onboarding): add completion-report upload endpoint with name matching"
```

---

### Task 12: Worker routes — GET hires and GET manager view

**Files:**
- Modify: `worker/onboarding/routes.ts`

- [ ] **Step 1: In `worker/onboarding/routes.ts`, add `assembleHires` to the existing `./db` import**

Change:

```ts
import {
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from './db';
```

to:

```ts
import {
  assembleHires,
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from './db';
```

- [ ] **Step 2: Add the two GET routes**

Add above `app.onError`:

```ts
app.get('/api/onboarding/hires', async (c) => {
  const [hireRows, completionRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM new_hires ORDER BY js_date DESC, full_name').all(),
    c.env.DB.prepare('SELECT * FROM plan_completions').all(),
  ]);
  const hires = assembleHires(
    hireRows.results as Record<string, unknown>[],
    completionRows.results as Record<string, unknown>[],
  );
  return c.json(hires);
});

app.get('/api/onboarding/manager/:slug', async (c) => {
  const slug = c.req.param('slug');
  const [hireRows, completionRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM new_hires WHERE manager_slug = ? ORDER BY js_date DESC, full_name').bind(slug).all(),
    c.env.DB.prepare('SELECT * FROM plan_completions').all(),
  ]);
  const hireIds = new Set(hireRows.results.map((r) => r.id));
  const relevantCompletions = (completionRows.results as Record<string, unknown>[])
    .filter((r) => hireIds.has(r.new_hire_id as number));
  const hires = assembleHires(hireRows.results as Record<string, unknown>[], relevantCompletions);
  return c.json(hires);
});
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add worker/onboarding/routes.ts
git commit -m "feat(onboarding): add hires list and manager-scoped read endpoints"
```

---

### Task 13: Worker routes — role mapping CRUD

**Files:**
- Modify: `worker/onboarding/routes.ts`

- [ ] **Step 1: In `worker/onboarding/routes.ts`, extend the two shared imports**

Change:

```ts
import type {
  CompletionRowInput,
  CompletionUploadResponse,
  MasterParseResult,
  MasterUploadResponse,
} from '../../shared/onboarding-types';
import {
  assembleHires,
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from './db';
```

to:

```ts
import type {
  CompletionRowInput,
  CompletionUploadResponse,
  MasterParseResult,
  MasterUploadResponse,
  RolePlanMappingInput,
} from '../../shared/onboarding-types';
import {
  assembleHires,
  completionUpsertParams,
  hireUpsertParams,
  planDefParams,
  rowToMappingRule,
  UPSERT_COMPLETION_SQL,
  UPSERT_HIRE_SQL,
  UPSERT_PLAN_DEF_SQL,
} from './db';
```

This is the final import state for `worker/onboarding/routes.ts` — every subsequent task in this plan only touches other files.

- [ ] **Step 2: Add the mapping routes**

Add above `app.onError`:

```ts
app.get('/api/onboarding/mapping', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM role_plan_mapping ORDER BY priority DESC, id').all();
  return c.json(results.map((r) => rowToMappingRule(r as Record<string, unknown>)));
});

app.post('/api/onboarding/mapping', async (c) => {
  const body = await c.req.json<RolePlanMappingInput>().catch(() => null);
  if (!body || typeof body.rolePattern !== 'string' || !body.rolePattern.trim() ||
      typeof body.learningPlanTitle !== 'string' || !body.learningPlanTitle.trim()) {
    return c.json({ error: 'rolePattern and learningPlanTitle are required' }, 400);
  }
  const result = await c.env.DB
    .prepare(
      `INSERT INTO role_plan_mapping (role_pattern, department_pattern, country_pattern, learning_plan_title, priority)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      body.rolePattern.trim(),
      body.departmentPattern?.trim() || null,
      body.countryPattern?.trim() || null,
      body.learningPlanTitle.trim(),
      body.priority ?? 0,
    )
    .run();
  return c.json({ id: result.meta.last_row_id });
});

app.delete('/api/onboarding/mapping/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare('DELETE FROM role_plan_mapping WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add worker/onboarding/routes.ts
git commit -m "feat(onboarding): add role-to-plan mapping admin endpoints"
```

---

## Group C: Frontend

### Task 14: Frontend API wrapper

**Files:**
- Create: `src/onboarding-api.ts`

- [ ] **Step 1: Implement**

```ts
// src/onboarding-api.ts
import type {
  CompletionRowInput,
  CompletionUploadResponse,
  HireRecord,
  MasterParseResult,
  MasterUploadResponse,
  RolePlanMappingInput,
  RolePlanMappingRule,
} from '../shared/onboarding-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const uploadMasterFile = (body: MasterParseResult & { filename: string }) =>
  fetch('/api/onboarding/uploads/master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<MasterUploadResponse>(r));

export const uploadCompletionReport = (body: { filename: string; rows: CompletionRowInput[] }) =>
  fetch('/api/onboarding/uploads/completion-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<CompletionUploadResponse>(r));

export const fetchHires = () => fetch('/api/onboarding/hires').then((r) => json<HireRecord[]>(r));

export const fetchManagerHires = (slug: string) =>
  fetch(`/api/onboarding/manager/${encodeURIComponent(slug)}`).then((r) => json<HireRecord[]>(r));

export const fetchMappingRules = () => fetch('/api/onboarding/mapping').then((r) => json<RolePlanMappingRule[]>(r));

export const addMappingRule = (rule: RolePlanMappingInput) =>
  fetch('/api/onboarding/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  }).then((r) => json<{ id: number }>(r));

export const deleteMappingRule = (id: number) =>
  fetch(`/api/onboarding/mapping/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r));
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/onboarding-api.ts
git commit -m "feat(onboarding): add frontend API wrapper"
```

---

### Task 15: CSV export helper

**Files:**
- Create: `src/lib/onboardingCsv.ts`
- Test: `tests/onboarding/onboardingCsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/onboarding/onboardingCsv.test.ts
import { describe, expect, it } from 'vitest';
import type { HireJourney } from '../../shared/onboarding-types';
import { overdueCsv } from '../../src/lib/onboardingCsv';

const journey = (over: Partial<HireJourney['hire']> = {}, overallStatus: HireJourney['overallStatus'] = 'behind'): HireJourney => ({
  hire: {
    id: 1, eeNumber: '1', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
    hiringManager: 'Maria Rivera', managerSlug: 'maria-rivera', country: 'Mexico',
    hireDate: '2026-09-01', jsDate: '2026-09-01', completions: [], ...over,
  },
  week1: { learningPlanTitle: 'Jump Start - Week 1', status: 'overdue', deadline: '2026-09-08', enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0 },
  week2: { learningPlanTitle: null, status: 'unmapped', deadline: null, enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0 },
  overallStatus,
});

describe('overdueCsv', () => {
  it('includes only hires with overallStatus "behind", grouped/sorted by manager then name', () => {
    const rows = [
      journey({ fullName: 'Zed Adams', hiringManager: 'Kevin Tan' }, 'behind'),
      journey({ fullName: 'Amy Brooks', hiringManager: 'Kevin Tan' }, 'behind'),
      journey({ fullName: 'Someone Else', hiringManager: 'Maria Rivera' }, 'on_track'),
    ];
    const csv = overdueCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Hiring Manager,Name,Role,JS Date,Week 1 Status,Week 2 Status,Overall Status');
    expect(lines).toHaveLength(3); // header + 2 behind rows, "on_track" excluded
    expect(lines[1]).toContain('Amy Brooks'); // Amy before Zed within the same manager
    expect(lines[2]).toContain('Zed Adams');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/onboarding/onboardingCsv.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/onboardingCsv.ts
import type { HireJourney } from '../../shared/onboarding-types';

const esc = (v: string | null) => {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function overdueCsv(journeys: HireJourney[]): string {
  const header = 'Hiring Manager,Name,Role,JS Date,Week 1 Status,Week 2 Status,Overall Status';
  const rows = journeys
    .filter((j) => j.overallStatus === 'behind')
    .sort((a, b) =>
      (a.hire.hiringManager ?? '').localeCompare(b.hire.hiringManager ?? '') ||
      a.hire.fullName.localeCompare(b.hire.fullName),
    )
    .map((j) =>
      [j.hire.hiringManager, j.hire.fullName, j.hire.role, j.hire.jsDate, j.week1.status, j.week2.status, j.overallStatus]
        .map(esc)
        .join(','),
    );
  return [header, ...rows].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/onboarding/onboardingCsv.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboardingCsv.ts tests/onboarding/onboardingCsv.test.ts
git commit -m "feat(onboarding): add behind-schedule CSV export grouped by manager"
```

---

### Task 16: Upload modal (two-step: master file, then completion report)

**Files:**
- Create: `src/components/onboarding/OnboardingUploadModal.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/OnboardingUploadModal.tsx
import { useRef, useState } from 'react';
import type { CompletionReportParseResult, MasterParseResult } from '../../../shared/onboarding-types';
import { parseCompletionReport } from '../../excel/parseCompletionReport';
import { parseMasterFile } from '../../excel/parseMasterFile';
import { uploadCompletionReport, uploadMasterFile } from '../../onboarding-api';

interface Props {
  onClose: () => void;
  onUploaded: () => void;
}

type Step = 'master' | 'completion' | 'done';

export default function OnboardingUploadModal({ onClose, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('master');
  const [filename, setFilename] = useState('');
  const [masterResult, setMasterResult] = useState<MasterParseResult | null>(null);
  const [completionResult, setCompletionResult] = useState<CompletionReportParseResult | null>(null);
  const [matchSummary, setMatchSummary] = useState<{ matchedExact: number; matchedToken: number; unmatched: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      if (step === 'master') setMasterResult(parseMasterFile(buf));
      else setCompletionResult(parseCompletionReport(buf));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const confirmMaster = async () => {
    if (!masterResult) return;
    setBusy(true);
    setError('');
    try {
      await uploadMasterFile({ ...masterResult, filename });
      setMasterResult(null);
      setFilename('');
      setStep('completion');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCompletion = async () => {
    if (!completionResult) return;
    setBusy(true);
    setError('');
    try {
      const res = await uploadCompletionReport({ filename, rows: completionResult.rows });
      setMatchSummary(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">
          {step === 'master' && 'Step 1 of 2: Upload master file'}
          {step === 'completion' && 'Step 2 of 2: Upload completion report'}
          {step === 'done' && 'Upload complete'}
        </h2>

        {step !== 'done' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void onFile(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-md border-2 border-dashed border-slate-300 p-8 text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              {filename || 'Click to choose a .xlsx file'}
            </button>
          </>
        )}

        {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {step === 'master' && masterResult && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p><b>{masterResult.hires.length}</b> new hires and <b>{masterResult.plans.length}</b> learning plans ready.</p>
            {masterResult.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{masterResult.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {masterResult.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.message}</li>)}
                </ul>
              </details>
            )}
            {masterResult.warnings.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{masterResult.warnings.length} warning(s)</summary>
                <ul className="ml-5 list-disc">
                  {masterResult.warnings.map((w, i) => <li key={i}>Row {w.row}: {w.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {step === 'completion' && completionResult && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p><b>{completionResult.rows.length}</b> plan-completion record(s) ready to match against uploaded hires.</p>
            {completionResult.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{completionResult.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {completionResult.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {step === 'done' && matchSummary && (
          <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <b>{matchSummary.matchedExact}</b> matched exactly, <b>{matchSummary.matchedToken}</b> matched by name similarity,{' '}
              <b>{matchSummary.unmatched}</b> could not be matched.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={step === 'done' ? onUploaded : onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'master' && (
            <button
              onClick={() => void confirmMaster()}
              disabled={!masterResult || busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Uploading…' : 'Confirm & continue'}
            </button>
          )}
          {step === 'completion' && (
            <button
              onClick={() => void confirmCompletion()}
              disabled={!completionResult || busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Uploading…' : 'Confirm upload'}
            </button>
          )}
          {step === 'done' && (
            <button onClick={onUploaded} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/OnboardingUploadModal.tsx
git commit -m "feat(onboarding): add two-step upload modal for master file + completion report"
```

---

### Task 17: Hire table (stat-tile row lives in OnboardingPage; this is the filterable table)

**Files:**
- Create: `src/components/onboarding/HireTable.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/HireTable.tsx
import { useMemo, useState } from 'react';
import type { HireJourney, OverallStatus } from '../../../shared/onboarding-types';

type SortKey = 'name' | 'manager' | 'jsDate' | 'status';

const STATUS_LABEL: Record<OverallStatus, string> = {
  on_track: 'On Track',
  behind: 'Behind',
  not_started: 'Not Started',
  unmapped: 'Unmapped',
  no_start_date: 'No Start Date',
};

const STATUS_CLASS: Record<OverallStatus, string> = {
  on_track: 'bg-green-100 text-green-700',
  behind: 'bg-red-100 text-red-700',
  not_started: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-slate-200 text-slate-700',
  no_start_date: 'bg-slate-200 text-slate-700',
};

interface Props {
  journeys: HireJourney[];
  onSelect: (id: number) => void;
}

export default function HireTable({ journeys, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OverallStatus | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('jsDate');
  const [asc, setAsc] = useState(false);

  const managers = useMemo(
    () => [...new Set(journeys.map((j) => j.hire.hiringManager).filter((m): m is string => !!m))].sort(),
    [journeys],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const valueOf = (j: HireJourney): string => {
      switch (sortKey) {
        case 'name': return j.hire.fullName.toLowerCase();
        case 'manager': return (j.hire.hiringManager ?? '').toLowerCase();
        case 'jsDate': return j.hire.jsDate ?? '';
        case 'status': return j.overallStatus;
      }
    };
    return journeys
      .filter((j) => !q || [j.hire.fullName, j.hire.role ?? '', j.hire.hiringManager ?? ''].some((v) => v.toLowerCase().includes(q)))
      .filter((j) => !managerFilter || j.hire.hiringManager === managerFilter)
      .filter((j) => !statusFilter || j.overallStatus === statusFilter)
      .sort((a, b) => (asc ? 1 : -1) * valueOf(a).localeCompare(valueOf(b)));
  }, [journeys, search, managerFilter, statusFilter, sortKey, asc]);

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer px-3 py-2 text-left font-semibold text-slate-600 hover:text-slate-900"
      onClick={() => { if (key === sortKey) setAsc(!asc); else { setSortKey(key); setAsc(true); } }}
    >
      {label}{sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, role, manager…"
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OverallStatus | '')} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as OverallStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {header('name', 'Name')}
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Role</th>
              {header('manager', 'Manager')}
              {header('jsDate', 'JS Date')}
              {header('status', 'Status')}
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => (
              <tr key={j.hire.id} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50" onClick={() => onSelect(j.hire.id)}>
                <td className="px-3 py-2 font-medium text-slate-800">{j.hire.fullName}</td>
                <td className="px-3 py-2 text-slate-600">{j.hire.role ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{j.hire.hiringManager ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{j.hire.jsDate ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[j.overallStatus]}`}>
                    {STATUS_LABEL[j.overallStatus]}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No matching hires.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/HireTable.tsx
git commit -m "feat(onboarding): add filterable/sortable hire table"
```

---

### Task 18: Journey drill-down drawer

**Files:**
- Create: `src/components/onboarding/HireDrawer.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/HireDrawer.tsx
import type { HireJourney, PlanJourney, PlanStatus } from '../../../shared/onboarding-types';

const STATUS_TEXT: Record<PlanStatus, string> = {
  complete: 'Complete',
  in_progress: 'In Progress',
  overdue: 'Overdue',
  not_started: 'Not Started',
  unmapped: 'Unmapped',
};

function PlanRow({ label, plan }: { label: string; plan: PlanJourney }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs font-medium text-slate-500">{STATUS_TEXT[plan.status]}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{plan.learningPlanTitle ?? 'No plan could be determined for this role.'}</p>
      {plan.learningPlanTitle && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
          <dt>Deadline</dt><dd>{plan.deadline ?? '—'}</dd>
          <dt>Enrolled</dt><dd>{plan.enrollmentDate ?? '—'}</dd>
          <dt>Completed</dt><dd>{plan.completionDate ?? '—'}</dd>
          <dt>Courses</dt><dd>{plan.coursesCompleted} / {plan.coursesTotal}</dd>
        </dl>
      )}
    </div>
  );
}

export default function HireDrawer({ journey, onClose }: { journey: HireJourney; onClose: () => void }) {
  const { hire } = journey;
  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="mb-4 text-sm text-slate-500 hover:text-slate-800">← Close</button>
        <h2 className="text-lg font-bold text-slate-800">{hire.fullName}</h2>
        <p className="text-sm text-slate-500">{hire.role ?? 'Role unknown'} · {hire.hiringManager ?? 'No manager on file'}</p>
        <p className="mt-1 text-xs text-slate-400">JS Date: {hire.jsDate ?? 'Not recorded'}</p>
        <div className="mt-5 space-y-3">
          <PlanRow label="Week 1" plan={journey.week1} />
          <PlanRow label="Week 2" plan={journey.week2} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/HireDrawer.tsx
git commit -m "feat(onboarding): add journey drill-down drawer"
```

---

### Task 19: Role mapping admin

**Files:**
- Create: `src/components/onboarding/MappingAdmin.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/MappingAdmin.tsx
import { useState } from 'react';
import type { RolePlanMappingRule } from '../../../shared/onboarding-types';
import { addMappingRule, deleteMappingRule } from '../../onboarding-api';

interface Props {
  rules: RolePlanMappingRule[];
  onClose: () => void;
  onChanged: () => void;
}

export default function MappingAdmin({ rules, onClose, onChanged }: Props) {
  const [rolePattern, setRolePattern] = useState('');
  const [departmentPattern, setDepartmentPattern] = useState('');
  const [countryPattern, setCountryPattern] = useState('');
  const [learningPlanTitle, setLearningPlanTitle] = useState('');
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!rolePattern.trim() || !learningPlanTitle.trim()) {
      setError('Role pattern and Learning Plan title are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const parsedPriority = Number(priority);
      await addMappingRule({
        rolePattern,
        departmentPattern: departmentPattern || null,
        countryPattern: countryPattern || null,
        learningPlanTitle,
        priority: Number.isNaN(parsedPriority) ? 0 : parsedPriority,
      });
      setRolePattern('');
      setDepartmentPattern('');
      setCountryPattern('');
      setLearningPlanTitle('');
      setPriority('0');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add rule.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await deleteMappingRule(id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">Role → Week 2 Learning Plan mapping</h2>
        <p className="mb-4 text-sm text-slate-500">
          A hire's Role is matched against these patterns (substring match, case-insensitive) to decide their Week 2 plan.
          Rules are checked in priority order; the first match wins.
        </p>

        <table className="mb-5 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-1">Role pattern</th>
              <th className="py-1">Department</th>
              <th className="py-1">Country</th>
              <th className="py-1">Priority</th>
              <th className="py-1">Learning Plan</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-1">{r.rolePattern}</td>
                <td className="py-1">{r.departmentPattern ?? '—'}</td>
                <td className="py-1">{r.countryPattern ?? '—'}</td>
                <td className="py-1">{r.priority}</td>
                <td className="py-1">{r.learningPlanTitle}</td>
                <td className="py-1 text-right">
                  <button onClick={() => void remove(r.id)} disabled={busy} className="text-xs text-red-600 hover:underline">Remove</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-slate-400">No rules yet.</td></tr>
            )}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-3">
          <input value={rolePattern} onChange={(e) => setRolePattern(e.target.value)} placeholder="Role pattern (required)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={learningPlanTitle} onChange={(e) => setLearningPlanTitle(e.target.value)} placeholder="Learning Plan title (required)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={departmentPattern} onChange={(e) => setDepartmentPattern(e.target.value)} placeholder="Department pattern (optional)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={countryPattern} onChange={(e) => setCountryPattern(e.target.value)} placeholder="Country pattern (optional)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Priority (higher wins ties, default 0)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
          <button onClick={() => void add()} disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
            Add rule
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/MappingAdmin.tsx
git commit -m "feat(onboarding): add role-to-plan mapping admin UI"
```

---

### Task 20: OnboardingPage (composes everything for the enablement-team view)

**Files:**
- Create: `src/components/onboarding/OnboardingPage.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/OnboardingPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RECENT_WINDOW_DAYS } from '../../../shared/onboarding-constants';
import type { HireRecord, RolePlanMappingRule } from '../../../shared/onboarding-types';
import { overdueCsv } from '../../lib/onboardingCsv';
import { buildHireJourney } from '../../lib/onboardingStatus';
import { fetchHires, fetchMappingRules } from '../../onboarding-api';
import HireDrawer from './HireDrawer';
import HireTable from './HireTable';
import MappingAdmin from './MappingAdmin';
import OnboardingUploadModal from './OnboardingUploadModal';

const todayIso = () => new Date().toISOString().slice(0, 10);
const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function OnboardingPage() {
  const [hires, setHires] = useState<HireRecord[]>([]);
  const [rules, setRules] = useState<RolePlanMappingRule[]>([]);
  const [loadError, setLoadError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError('');
      const [h, r] = await Promise.all([fetchHires(), fetchMappingRules()]);
      setHires(h);
      setRules(r);
    } catch (e) {
      setLoadError(errMessage(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const today = todayIso();
  const journeys = useMemo(() => hires.map((h) => buildHireJourney(h, rules, today)), [hires, rules, today]);

  const visible = useMemo(() => {
    if (showAll) return journeys;
    const cutoff = new Date(Date.now() - DEFAULT_RECENT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    return journeys.filter((j) => j.hire.jsDate === null || j.hire.jsDate >= cutoff);
  }, [journeys, showAll]);

  const selected = journeys.find((j) => j.hire.id === selectedId) ?? null;

  const stats = useMemo(() => ({
    total: visible.length,
    onTrack: visible.filter((j) => j.overallStatus === 'on_track').length,
    behind: visible.filter((j) => j.overallStatus === 'behind').length,
    notStarted: visible.filter((j) => j.overallStatus === 'not_started').length,
    needsAttention: visible.filter((j) => j.overallStatus === 'unmapped' || j.overallStatus === 'no_start_date').length,
  }), [visible]);

  // Always covers every behind-schedule hire, regardless of the recency-window
  // toggle above, since this list exists for operational follow-up.
  const totalBehindCount = useMemo(
    () => journeys.filter((j) => j.overallStatus === 'behind').length,
    [journeys],
  );

  const exportOverdue = () => {
    const blob = new Blob(['﻿' + overdueCsv(journeys)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'onboarding-behind.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">New Hire Onboarding</h1>
          <p className="text-xs text-slate-500">
            {showAll ? 'Showing full history' : `Showing hires with JS Date in the last ${DEFAULT_RECENT_WINDOW_DAYS} days`}
            {' · '}
            <button className="underline" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show recent only' : 'Show all'}</button>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMappingOpen(true)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Manage role mapping
          </button>
          <button onClick={() => setUploadOpen(true)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
            ⬆ Upload files
          </button>
        </div>
      </div>

      {loadError && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}

      <div className="mb-5 grid grid-cols-5 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
          <div className="text-xs text-slate-400">Total New Hires</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-green-600">{stats.onTrack}</div>
          <div className="text-xs text-slate-400">On Track</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{stats.behind}</div>
          <div className="text-xs text-slate-400">Behind</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-amber-600">{stats.notStarted}</div>
          <div className="text-xs text-slate-400">Not Started</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-purple-600">{stats.needsAttention}</div>
          <div className="text-xs text-slate-400">Needs Attention</div>
        </div>
      </div>

      {hires.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No data yet. Click <b>Upload files</b> to import the master file and completion report.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No hires match the last {DEFAULT_RECENT_WINDOW_DAYS} days. <button className="underline" onClick={() => setShowAll(true)}>Show all</button> to see full history.
        </div>
      ) : null}

      {visible.length > 0 && (
        <>
          <button
            onClick={exportOverdue}
            disabled={totalBehindCount === 0}
            className="mb-4 rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⬇ Export behind-schedule list ({totalBehindCount})
          </button>
          <HireTable journeys={visible} onSelect={setSelectedId} />
        </>
      )}

      {selected && <HireDrawer journey={selected} onClose={() => setSelectedId(null)} />}
      {uploadOpen && (
        <OnboardingUploadModal onClose={() => setUploadOpen(false)} onUploaded={() => { setUploadOpen(false); void refresh(); }} />
      )}
      {mappingOpen && (
        <MappingAdmin rules={rules} onClose={() => setMappingOpen(false)} onChanged={() => void refresh()} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/OnboardingPage.tsx
git commit -m "feat(onboarding): add OnboardingPage composing stats, table, drawer, upload, mapping"
```

---

### Task 21: Manager view (read-only, unauthenticated stand-in link)

**Files:**
- Create: `src/components/onboarding/ManagerView.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/onboarding/ManagerView.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HireJourney, HireRecord, RolePlanMappingRule } from '../../../shared/onboarding-types';
import { buildHireJourney } from '../../lib/onboardingStatus';
import { fetchManagerHires, fetchMappingRules } from '../../onboarding-api';
import HireDrawer from './HireDrawer';
import HireTable from './HireTable';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ManagerView({ slug }: { slug: string }) {
  const [hires, setHires] = useState<HireRecord[]>([]);
  const [rules, setRules] = useState<RolePlanMappingRule[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setError('');
      const [h, r] = await Promise.all([fetchManagerHires(slug), fetchMappingRules()]);
      setHires(h);
      setRules(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your team.');
    }
  }, [slug]);

  useEffect(() => { void refresh(); }, [refresh]);

  const today = todayIso();
  const journeys: HireJourney[] = useMemo(() => hires.map((h) => buildHireJourney(h, rules, today)), [hires, rules, today]);
  const selected = journeys.find((j) => j.hire.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 rounded-md bg-amber-50 p-3 text-xs text-amber-700">
        This is a temporary, unauthenticated view shared by a private link. Real sign-in is planned for a future phase.
      </div>
      <h1 className="mb-4 text-xl font-bold text-slate-800">Your team's onboarding journeys</h1>
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {hires.length === 0 && !error ? (
        <p className="text-slate-500">No new hires found for this link.</p>
      ) : (
        <HireTable journeys={journeys} onSelect={setSelectedId} />
      )}
      {selected && <HireDrawer journey={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/ManagerView.tsx
git commit -m "feat(onboarding): add read-only manager view"
```

---

### Task 22: Wire into App, Sidebar, and main entrypoint

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Update `src/components/Sidebar.tsx`**

Change the `Props` interface's `page`/`onNavigate` types and add the nav link, and hide the course selector on the onboarding page:

```tsx
import type { CourseInfo } from '../../shared/types';

interface Props {
  page: 'dashboard' | 'people' | 'onboarding';
  onNavigate: (page: 'dashboard' | 'people' | 'onboarding') => void;
  courses: CourseInfo[];
  course: string;
  onSelectCourse: (title: string) => void;
}

export default function Sidebar({ page, onNavigate, courses, course, onSelectCourse }: Props) {
  const link = (p: 'dashboard' | 'people' | 'onboarding', label: string) => (
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
      {link('onboarding', 'Onboarding')}
      {page !== 'onboarding' && (
        <div className="mt-auto border-t border-slate-700 pt-3">
          <label htmlFor="course-select" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Course</label>
          <select
            id="course-select"
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
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Update `src/App.tsx`**

Change the `page` state type and add the `OnboardingPage` import and render branch:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { CourseInfo, Enrollment, UploadRecord } from '../shared/types';
import { fetchCourses, fetchEnrollments, fetchUploads } from './api';
import DashboardPage from './components/DashboardPage';
import OnboardingPage from './components/onboarding/OnboardingPage';
import PeoplePage from './components/PeoplePage';
import Sidebar from './components/Sidebar';
import UploadModal from './components/UploadModal';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'people' | 'onboarding'>('dashboard');
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [course, setCourse] = useState('');
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [lastUpload, setLastUpload] = useState<UploadRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(async (preferredCourse?: string) => {
    try {
      setLoadError('');
      const [cs, ups] = await Promise.all([fetchCourses(), fetchUploads()]);
      setCourses(cs);
      setLastUpload(ups[0] ?? null);
      setCourse((current) =>
        preferredCourse && cs.some((c) => c.courseTitle === preferredCourse) ? preferredCourse
        : cs.some((c) => c.courseTitle === current) ? current
        : (cs[0]?.courseTitle ?? ''),
      );
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setLoadError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!course) {
      setRows([]);
      return;
    }
    let cancelled = false;
    fetchEnrollments(course)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [course, refreshToken]);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar page={page} onNavigate={setPage} courses={courses} course={course} onSelectCourse={setCourse} />
      <main className="flex-1">
        {loadError && <p className="m-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {page === 'dashboard' ? (
          <DashboardPage course={course} rows={rows} lastUpload={lastUpload} onUploadClick={() => setUploadOpen(true)} />
        ) : page === 'people' ? (
          <PeoplePage rows={rows} />
        ) : (
          <OnboardingPage />
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

- [ ] **Step 3: Update `src/main.tsx`** to route `/onboarding/m/:slug` to `ManagerView` instead of the main `App`

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ManagerView from './components/onboarding/ManagerView';
import './index.css';

const managerMatch = /^\/onboarding\/m\/([^/]+)/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {managerMatch ? <ManagerView slug={managerMatch[1]} /> : <App />}
  </StrictMode>,
);
```

This keeps `App`'s hooks unconditional (Rules of Hooks) — the routing decision happens once, outside any component, before either component is rendered.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/main.tsx
git commit -m "feat(onboarding): wire Onboarding nav item and manager-link routing"
```

---

## Group D: Manual verification

### Task 23: Sample data script

**Files:**
- Create: `scripts/make-onboarding-sample.mjs`

- [ ] **Step 1: Implement**

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const hireHeaders = ['Hire Date', 'JS Date', 'First & Last Name', 'Department', 'EE#', 'Role', 'Hiring Manager ', 'Country', 'Time Zone', 'VP Level'];
const planHeaders = ['Title', 'Category', 'Audience', 'Department', 'Region'];

const today = new Date();
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const hires = [
  [daysAgo(20), daysAgo(20), 'Jane Cooper', 'Services', '900001', 'Services Consultant', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'],
  [daysAgo(20), daysAgo(20), 'Kevin Adebayo', 'Support', '900002', 'Payroll Specialist III', 'Kevin Tan', 'India', 'IST', 'Ed Ciszewski'],
  [daysAgo(3), daysAgo(3), 'Sofia Marin', 'Services', '900003', 'Services Consultant Sr', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'],
  [daysAgo(45), daysAgo(45), 'Old Hire Example', 'Support', '900004', 'Application Developer', 'Kevin Tan', 'USA', 'EST', 'Ed Ciszewski'],
];

const plans = [
  ['Jump Start - Week 1', 'Week 1', 'All', 'GCO', 'All'],
  ['Jump Start - Services Consultants Core & GL', 'Week 2+', 'Services Consultants & GL Consultants', 'Services', 'All'],
  ['Jump Start - Managed Payroll Specialist', 'Week 2+', 'Managed Payroll Specialist', 'Support - Managed', 'All'],
];

const masterWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(masterWb, XLSX.utils.aoa_to_sheet([hireHeaders, ...hires]), 'Jump Start');
XLSX.utils.book_append_sheet(masterWb, XLSX.utils.aoa_to_sheet([planHeaders, ...plans]), 'JS LPs');

const reportMetadata = ['MyDayforce | Learning Plan Completion Report | Dayforce sample'];
const reportHeaders = [
  'Preferred Name', 'Employee Last Name', 'Business Email', 'Job Assignment Name', 'Learning Plan',
  'Learning Plan Enrollment Date', 'Course', 'Course Enrollment Start', 'Course Enrolment Completion',
  'Course Score', 'Manager', 'Second Level Manager', 'Primary Address Country', 'Department Name',
  'Location Name', 'Course Duration', 'Learning Plan Completion Date',
];

const reportRows = [
  // Jane Cooper: Week 1 complete, Week 2 complete -> On Track
  ['Jane', 'Cooper', 'jane.cooper@dayforce.com', 'Services Consultant', 'Jump Start - Week 1', daysAgo(20), 'Intro', daysAgo(20), daysAgo(18), '', 'Maria Rivera', '', 'Mexico', 'Implementation', 'Loc', 900, daysAgo(18)],
  ['Jane', 'Cooper', 'jane.cooper@dayforce.com', 'Services Consultant', 'Jump Start - Services Consultants Core & GL', daysAgo(18), 'Core Skills', daysAgo(18), daysAgo(12), '', 'Maria Rivera', '', 'Mexico', 'Implementation', 'Loc', 900, daysAgo(12)],
  // Kevin Adebayo: Week 1 complete, Week 2 overdue (JS date 20 days ago, Week 2 deadline was 6 days ago)
  ['Kevin', 'Adebayo', 'kevin.adebayo@dayforce.com', 'Payroll Specialist III', 'Jump Start - Week 1', daysAgo(20), 'Intro', daysAgo(20), daysAgo(18), '', 'Kevin Tan', '', 'India', 'Support', 'Loc', 900, daysAgo(18)],
  ['Kevin', 'Adebayo', 'kevin.adebayo@dayforce.com', 'Payroll Specialist III', 'Jump Start - Managed Payroll Specialist', daysAgo(18), 'Payroll Basics', daysAgo(18), '', '', 'Kevin Tan', '', 'India', 'Support', 'Loc', 900, ''],
  // Sofia Marin: nothing started yet (JS date 3 days ago, within deadline)
  // Old Hire Example: intentionally absent from the report (unmatched, "No training data found")
];

const reportWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.aoa_to_sheet([reportMetadata, reportHeaders, ...reportRows]), 'Sheet1');

mkdirSync('sample-data', { recursive: true });
writeFileSync('sample-data/onboarding-master.xlsx', XLSX.write(masterWb, { type: 'buffer', bookType: 'xlsx' }));
writeFileSync('sample-data/onboarding-completion-report.xlsx', XLSX.write(reportWb, { type: 'buffer', bookType: 'xlsx' }));
console.log('Wrote sample-data/onboarding-master.xlsx and sample-data/onboarding-completion-report.xlsx');
```

- [ ] **Step 2: Add a package.json script**

Add to the `"scripts"` object in `package.json`, alongside the existing `"sample"` entry:

```json
"sample:onboarding": "node scripts/make-onboarding-sample.mjs"
```

- [ ] **Step 3: Run it**

Run: `npm run sample:onboarding`
Expected: `Wrote sample-data/onboarding-master.xlsx and sample-data/onboarding-completion-report.xlsx`

- [ ] **Step 4: Commit**

```bash
git add scripts/make-onboarding-sample.mjs package.json
git commit -m "feat(onboarding): add sample data script for manual verification"
```

---

### Task 24: Manual end-to-end verification

Not a code change — a checklist to run before considering the feature done. Do this after every prior task is committed.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: Every test file passes, including all new `tests/onboarding/*.test.ts` files and the pre-existing three.

- [ ] **Step 2: Apply the migration locally (if not already applied in Task 8)**

Run: `npm run db:migrate:local`
Expected: Confirms `0002_onboarding.sql` is applied (or already up to date).

- [ ] **Step 3: Start the local dev server**

Run: `npm run dev`
Expected: Server starts; note the local URL it prints.

- [ ] **Step 4: Walk through the enablement-team flow in a browser**
  1. Open the app, click **Onboarding** in the sidebar. Expect the empty state ("No data yet...").
  2. Click **Upload files**. Choose `sample-data/onboarding-master.xlsx`. Confirm the preview shows 4 hires and 3 plans, then confirm the upload.
  3. On step 2, choose `sample-data/onboarding-completion-report.xlsx`. Confirm the preview, then confirm the upload. Expect the match summary to report matches for Jane Cooper and Kevin Adebayo (exact matches) and 0 unmatched from the report side.
  4. Click **Done**. Expect the stat tiles to populate and the table to show 3 hires (Jane, Kevin, Sofia) under the default 30-day window — "Old Hire Example" (45 days ago) should be excluded until you click **Show all**.
  5. Click Jane Cooper's row. Expect the drawer to show Week 1 "Complete" and Week 2 "Complete" (or "In Progress"/"Overdue" depending on today's date relative to the sample's relative dates — the important thing is real dates render, not blank).
  6. Click **Show all**. Expect "Old Hire Example" to appear with status "Not Started" or "No training data found" behavior reflected as "Not Started" (no completions, no deadline text if `jsDate` render as expected) — actually verify it does NOT throw and shows a sensible status per its old JS Date.
  7. Click **Export behind-schedule list**. Expect a CSV file to download named `onboarding-behind.csv`.
  8. Click **Manage role mapping**. Add a new rule (e.g. Role pattern "Application Developer", Learning Plan "Jump Start - Test Plan"). Close and reopen — confirm it persisted (re-fetches from the API). Remove it again.

- [ ] **Step 5: Walk through the manager view**
  1. Note a `managerSlug` value — either read it from the `/api/onboarding/hires` JSON response in browser dev tools, or derive it (e.g. "Maria Rivera" → `maria-rivera`).
  2. Navigate to `http://localhost:<port>/onboarding/m/maria-rivera` directly in the browser.
  3. Expect the read-only view with the amber "temporary, unauthenticated" banner, showing only Jane Cooper and Sofia Marin (Maria Rivera's hires) — not Kevin Adebayo or Old Hire Example.
  4. Confirm there is no Upload button and no way to navigate back to the main dashboard from this view (it's a standalone page).

- [ ] **Step 6: Re-upload the same two files a second time** (idempotency check)

Expect: hire and plan counts stay the same (upserted, not duplicated) for hires with an EE#; the completion match summary again reports the same matches; no errors.

- [ ] **Step 7: Report results**

If every check above passes, the feature is ready. If something fails, fix the underlying code (not the checklist) and re-run from Step 1.

---

## Self-review notes (already applied above)

- **Spec coverage:** every functional requirement in the design spec has a corresponding task — ingestion (6, 7), matching (3, 11), role mapping (4, 13, 19), status/deadlines (5), dashboard + drill-down (17, 18, 20), manager view (12, 21, 22), CSV export (15), mapping admin (13, 19), upload flow (10, 11, 16), error handling (built into parsers in 6/7 and routes in 10/11).
- **Type consistency:** `HireRecord`, `HireJourney`, `PlanJourney`, `RolePlanMappingRule` field names are identical everywhere they're used (types defined once in Task 1, never redefined).
- **Known, documented limitation:** hires with no EE# insert fresh on every master-file re-upload rather than upserting (SQLite treats NULL as always-distinct in a UNIQUE constraint) — called out in code comments and a test in Task 9, not silently swallowed.
