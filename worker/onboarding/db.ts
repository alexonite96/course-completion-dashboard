import type { CourseCompletionRecord, HireRecord, LearningPlanDefInput, NewHireInput, PlanCompletionRecord, RolePlanMappingRule } from '../../shared/onboarding-types';
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
  (new_hire_id, learning_plan_title, enrollment_date, completion_date, courses_total, courses_completed, courses, match_confidence, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (new_hire_id, learning_plan_title) DO UPDATE SET
  enrollment_date = excluded.enrollment_date,
  completion_date = excluded.completion_date,
  courses_total = excluded.courses_total,
  courses_completed = excluded.courses_completed,
  courses = excluded.courses,
  match_confidence = excluded.match_confidence,
  updated_at = excluded.updated_at
`;

export function completionUpsertParams(
  newHireId: number,
  row: {
    learningPlanTitle: string;
    enrollmentDate: string | null;
    completionDate: string | null;
    coursesTotal: number;
    coursesCompleted: number;
    courses: CourseCompletionRecord[];
  },
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
    JSON.stringify(row.courses),
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
  let courses: CourseCompletionRecord[] = [];
  try {
    courses = JSON.parse((row.courses as string | null) ?? '[]');
  } catch {
    courses = [];
  }
  return {
    learningPlanTitle: row.learning_plan_title as string,
    enrollmentDate: row.enrollment_date as string | null,
    completionDate: row.completion_date as string | null,
    coursesTotal: row.courses_total as number,
    coursesCompleted: row.courses_completed as number,
    courses,
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
