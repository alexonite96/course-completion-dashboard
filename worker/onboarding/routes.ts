// worker/onboarding/routes.ts
import { Hono } from 'hono';
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

app.onError((err, c) => {
  console.error('Onboarding API error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
