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
