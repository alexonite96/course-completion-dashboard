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
