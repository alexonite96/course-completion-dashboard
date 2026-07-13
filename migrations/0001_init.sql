CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_assignment TEXT,
  course_title TEXT NOT NULL,
  course_start_date TEXT,
  course_completion_date TEXT,
  manager TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (email, course_title)
);

CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_processed INTEGER NOT NULL,
  rows_inserted INTEGER NOT NULL,
  rows_updated INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  uploaded_by TEXT
);
