CREATE TABLE new_hires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ee_number TEXT UNIQUE,
  full_name TEXT NOT NULL,
  department TEXT,
  role TEXT,
  hiring_manager TEXT,
  manager_slug TEXT,
  country TEXT,
  hire_date TEXT,
  js_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE learning_plan_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  category TEXT,
  audience TEXT,
  department TEXT,
  region TEXT
);

CREATE TABLE role_plan_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_pattern TEXT NOT NULL,
  department_pattern TEXT,
  country_pattern TEXT,
  learning_plan_title TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plan_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_hire_id INTEGER NOT NULL REFERENCES new_hires(id),
  learning_plan_title TEXT NOT NULL,
  enrollment_date TEXT,
  completion_date TEXT,
  courses_total INTEGER NOT NULL DEFAULT 0,
  courses_completed INTEGER NOT NULL DEFAULT 0,
  match_confidence TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (new_hire_id, learning_plan_title)
);

CREATE TABLE onboarding_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_processed INTEGER NOT NULL,
  rows_matched INTEGER,
  rows_unmatched INTEGER
);
