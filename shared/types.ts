/** One parsed spreadsheet row, ready for upsert. Dates are ISO `YYYY-MM-DD` or null. */
export interface EnrollmentInput {
  firstName: string;
  lastName: string;
  email: string;               // trimmed + lowercased by the parser
  jobAssignment: string | null;
  courseTitle: string;
  courseStartDate: string | null;
  courseCompletionDate: string | null;  // null = pending
  manager: string | null;
}

/** A stored enrollment row returned by the API. */
export interface Enrollment extends EnrollmentInput {
  id: number;
  updatedAt: string;
}

export interface ParseWarning {
  row: number;      // 1-based Excel row number
  message: string;
}

export interface ParseResult {
  rows: EnrollmentInput[];     // deduped by (email, courseTitle), last occurrence wins
  skipped: ParseWarning[];     // rows excluded entirely (e.g. missing email)
  warnings: ParseWarning[];    // rows kept but degraded (e.g. unreadable date)
  courses: string[];           // distinct course titles found, sorted
}

export interface CourseInfo {
  courseTitle: string;
  rowCount: number;
}

export interface UploadResponse {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface UploadRecord {
  id: number;
  filename: string;
  uploadedAt: string;
  rowsProcessed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  uploadedBy: string | null;   // null until Cloudflare Access (SSO) is enabled
}
