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
