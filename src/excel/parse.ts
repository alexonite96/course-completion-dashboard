import * as XLSX from 'xlsx';
import type { EnrollmentInput, ParseResult, ParseWarning } from '../../shared/types';

/** Spreadsheet header (normalized) → EnrollmentInput field. */
const HEADER_MAP = {
  'employee first name': 'firstName',
  'employee last name': 'lastName',
  'business email': 'email',
  'job assignment': 'jobAssignment',
  'course title': 'courseTitle',
  'course start date': 'courseStartDate',
  'course completion date': 'courseCompletionDate',
  'manager': 'manager',
} as const;

type Field = (typeof HEADER_MAP)[keyof typeof HEADER_MAP];

/** Display names for error messages, keyed the same as HEADER_MAP. */
const DISPLAY_NAMES: Record<string, string> = {
  'employee first name': 'Employee First Name',
  'employee last name': 'Employee Last Name',
  'business email': 'Business Email',
  'job assignment': 'Job Assignment',
  'course title': 'Course Title',
  'course start date': 'Course Start Date',
  'course completion date': 'Course Completion Date',
  'manager': 'Manager',
};

export class MissingColumnsError extends Error {
  constructor(public missing: string[]) {
    super(`Missing required columns: ${missing.join(', ')}`);
    this.name = 'MissingColumnsError';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Convert a cell value to an ISO date string.
 * ok:false means the cell had content we could not read as a date.
 */
export function toIsoDate(value: unknown): { iso: string | null; ok: boolean } {
  if (value === null || value === undefined) return { iso: null, ok: true };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { iso: null, ok: false } : { iso: fmtLocal(value), ok: true };
  }
  if (typeof value === 'number' && isFinite(value)) {
    // Excel serial date: days since 1899-12-30 (25569 = 1970-01-01)
    const d = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return { iso: null, ok: true };
    const d = new Date(t);
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtLocal(d), ok: true };
  }
  return { iso: null, ok: false };
}

const normalize = (s: string) => s.trim().toLowerCase();
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  if (raw.length === 0) throw new Error('File contains no data rows');

  // Map each required field to the original header key present in the sheet.
  const keyByField = new Map<Field, string>();
  for (const orig of Object.keys(raw[0])) {
    const field = HEADER_MAP[normalize(orig) as keyof typeof HEADER_MAP];
    if (field && !keyByField.has(field)) keyByField.set(field, orig);
  }
  const missing = Object.entries(HEADER_MAP)
    .filter(([, field]) => !keyByField.has(field))
    .map(([norm]) => DISPLAY_NAMES[norm]);
  if (missing.length > 0) throw new MissingColumnsError(missing);

  const get = (row: Record<string, unknown>, field: Field) => row[keyByField.get(field)!];

  const skipped: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];
  const byKey = new Map<string, EnrollmentInput>();

  raw.forEach((rawRow, i) => {
    const excelRow = i + 2; // 1-based, after the header row

    const email = str(get(rawRow, 'email')).toLowerCase();
    if (!email || !email.includes('@')) {
      skipped.push({ row: excelRow, message: 'Missing or invalid Business Email' });
      return;
    }
    const courseTitle = str(get(rawRow, 'courseTitle'));
    if (!courseTitle) {
      skipped.push({ row: excelRow, message: 'Missing Course Title' });
      return;
    }

    const start = toIsoDate(get(rawRow, 'courseStartDate'));
    if (!start.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Start Date — stored as blank' });
    const completion = toIsoDate(get(rawRow, 'courseCompletionDate'));
    if (!completion.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Completion Date — treated as pending' });

    byKey.set(`${email}||${courseTitle}`, {
      firstName: str(get(rawRow, 'firstName')),
      lastName: str(get(rawRow, 'lastName')),
      email,
      jobAssignment: str(get(rawRow, 'jobAssignment')) || null,
      courseTitle,
      courseStartDate: start.iso,
      courseCompletionDate: completion.iso,
      manager: str(get(rawRow, 'manager')) || null,
    });
  });

  const rows = [...byKey.values()];
  const courses = [...new Set(rows.map((r) => r.courseTitle))].sort();
  return { rows, skipped, warnings, courses };
}
