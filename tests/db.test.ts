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

  it('upserts case-insensitively on email (same person, different email casing)', () => {
    upsert(row({ email: 'Jane@Example.com' }));
    upsert(row({ email: 'jane@example.com', courseCompletionDate: '2026-07-01' }));
    const stored = db.prepare('SELECT * FROM enrollments').all() as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(stored[0].course_completion_date).toBe('2026-07-01');
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
