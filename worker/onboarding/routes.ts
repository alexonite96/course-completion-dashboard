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
