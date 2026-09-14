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
import type { CourseCompletionRecord } from '../../shared/onboarding-types';

const migration = readFileSync('migrations/0002_onboarding.sql', 'utf8')
  + readFileSync('migrations/0003_plan_completion_courses.sql', 'utf8');

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
    const row = { learningPlanTitle: 'Jump Start - Week 1', enrollmentDate: '2026-09-01', completionDate: null, coursesTotal: 5, coursesCompleted: 2, courses: [] as CourseCompletionRecord[] };
    db.prepare(UPSERT_COMPLETION_SQL).run(...(completionUpsertParams(hireId, row, 'exact', '2026-09-13T00:00:00Z') as never[]));
    db.prepare(UPSERT_COMPLETION_SQL).run(
      ...(completionUpsertParams(hireId, { ...row, completionDate: '2026-09-06', coursesCompleted: 5 }, 'exact', '2026-09-14T00:00:00Z') as never[]),
    );
    const stored = db.prepare('SELECT * FROM plan_completions').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].completion_date).toBe('2026-09-06');
    expect(stored[0].courses_completed).toBe(5);
  });

  it('round-trips the per-course list as JSON through upsert and assembleHires', () => {
    const courses: CourseCompletionRecord[] = [
      { name: 'Intro', completionDate: '2026-09-02' },
      { name: 'Advanced', completionDate: null },
    ];
    const row = { learningPlanTitle: 'Jump Start - Week 1', enrollmentDate: '2026-09-01', completionDate: null, coursesTotal: 2, coursesCompleted: 1, courses };
    db.prepare(UPSERT_COMPLETION_SQL).run(...(completionUpsertParams(hireId, row, 'exact', '2026-09-13T00:00:00Z') as never[]));

    const storedRaw = db.prepare('SELECT courses FROM plan_completions').get() as { courses: string };
    expect(JSON.parse(storedRaw.courses)).toEqual(courses);

    const hireRows = db.prepare('SELECT * FROM new_hires').all() as Record<string, unknown>[];
    const completionRows = db.prepare('SELECT * FROM plan_completions').all() as Record<string, unknown>[];
    const hires = assembleHires(hireRows, completionRows);
    expect(hires.find((h) => h.id === hireId)?.completions[0].courses).toEqual(courses);
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
