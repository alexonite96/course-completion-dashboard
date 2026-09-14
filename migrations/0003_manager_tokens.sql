CREATE TABLE manager_tokens (
  manager_slug TEXT PRIMARY KEY,
  hiring_manager TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
