import { Hono } from 'hono';
import type { EnrollmentInput } from '../shared/types';
import { countInsertsAndUpdates, keyOf, rowToEnrollment, UPSERT_SQL, upsertParams } from './db';
import onboardingApp from './onboarding/routes';

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
  if (body.rows.length > 5000) {
    return c.json({ error: 'Too many rows in one upload (max 5000)' }, 400);
  }
  for (const r of body.rows) {
    if (
      typeof r.firstName !== 'string' || !r.firstName ||
      typeof r.lastName !== 'string' || !r.lastName ||
      typeof r.email !== 'string' || !r.email.includes('@') ||
      typeof r.courseTitle !== 'string' || !r.courseTitle
    ) {
      return c.json({ error: 'Every row needs firstName, lastName, a valid email, and courseTitle' }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT email, course_title FROM enrollments').all();
  const existingKeys = new Set(
    existing.results.map((r) => keyOf(r.email as string, r.course_title as string)),
  );
  const { inserted, updated } = countInsertsAndUpdates(existingKeys, body.rows);

  const now = new Date().toISOString();
  const upsertStmt = c.env.DB.prepare(UPSERT_SQL);
  const skipped = typeof body.skippedCount === 'number' ? body.skippedCount : 0;
  const historyStmt = c.env.DB.prepare(
    `INSERT INTO uploads (filename, uploaded_at, rows_processed, rows_inserted, rows_updated, rows_skipped, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    body.filename, now, body.rows.length, inserted, updated, skipped,
    // NOTE: Cf-Access-Authenticated-User-Email is only trustworthy once Cloudflare Access
    // fronts this Worker (Access overwrites any client-supplied value). Until SSO is enabled,
    // treat uploaded_by as untrusted — a direct caller could set this header.
    c.req.header('Cf-Access-Authenticated-User-Email') ?? null,
  );

  await c.env.DB.batch([
    ...body.rows.map((r) => upsertStmt.bind(...upsertParams(r, now))),
    historyStmt,
  ]);

  return c.json({ processed: body.rows.length, inserted, updated, skipped });
});

app.route('/', onboardingApp);

app.onError((err, c) => {
  console.error('API error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
