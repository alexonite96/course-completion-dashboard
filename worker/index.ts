import { Hono } from 'hono';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
