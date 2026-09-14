-- Per-course detail for a plan_completions row, stored as a JSON array
-- ([{ "name": string, "completionDate": string | null }]) rather than a child
-- table, so re-uploading a completion report can just overwrite the whole
-- list in place instead of a delete-then-reinsert per plan_completions row.
ALTER TABLE plan_completions ADD COLUMN courses TEXT NOT NULL DEFAULT '[]';
