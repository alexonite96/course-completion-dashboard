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
const fmtUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Build an ISO date from calendar parts, validating it is a real date. */
function fromParts(y: number, m: number, d: number): { iso: string | null; ok: boolean } {
  // Reconstruct via UTC and compare to catch impossible dates (e.g. month 13, day 45).
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { iso: null, ok: false };
  }
  return { iso: `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`, ok: true };
}

/**
 * Convert a cell value to an ISO date string.
 * ok:false means the cell had content we could not read as a date.
 *
 * Date-only values carry no timezone, so this must be timezone-independent:
 * every path resolves to fixed calendar components, never local-time getters.
 */
export function toIsoDate(value: unknown): { iso: string | null; ok: boolean } {
  if (value === null || value === undefined) return { iso: null, ok: true };
  if (value instanceof Date) {
    // SheetJS (cellDates:true) anchors date cells to UTC midnight, so read UTC parts.
    return isNaN(value.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(value), ok: true };
  }
  if (typeof value === 'number' && isFinite(value)) {
    // Excel serial date: days since 1899-12-30 (25569 = 1970-01-01)
    const d = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return { iso: null, ok: true };
    // Parse calendar components directly — do not rely on new Date()'s timezone rules.
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (mdy) return fromParts(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
    // Fallback: let Date try, then read UTC parts for a stable result.
    const d = new Date(t);
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  return { iso: null, ok: false };
}

const normalize = (s: string) => s.trim().toLowerCase();
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const isBlankRow = (row: unknown[] | undefined) =>
  !row || row.every((c) => c === null || c === undefined || String(c).trim() === '');

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');

  // Array-of-arrays with blank rows preserved so reported row numbers always
  // match the real .xlsx row (object mode silently drops fully-blank rows).
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    blankrows: true,
    defval: null,
  });

  const headerRow = grid[0];
  if (!headerRow) throw new Error('File contains no data rows');
  const dataRows = grid.slice(1);
  if (dataRows.every((r) => isBlankRow(r))) throw new Error('File contains no data rows');

  // Map each required field to its column index in the header row.
  const colByField = new Map<Field, number>();
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normalize(str(cell)) as keyof typeof HEADER_MAP];
    if (field && !colByField.has(field)) colByField.set(field, idx);
  });
  const missing = Object.entries(HEADER_MAP)
    .filter(([, field]) => !colByField.has(field))
    .map(([norm]) => DISPLAY_NAMES[norm]);
  if (missing.length > 0) throw new MissingColumnsError(missing);

  const get = (row: unknown[], field: Field) => row[colByField.get(field)!];

  const skipped: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];
  const byKey = new Map<string, EnrollmentInput>();

  dataRows.forEach((row, i) => {
    const excelRow = i + 2; // 1-based, header is row 1, data starts at row 2
    if (isBlankRow(row)) return; // skip fully-blank rows silently

    const email = str(get(row, 'email')).toLowerCase();
    if (!email || !email.includes('@')) {
      skipped.push({ row: excelRow, message: 'Missing or invalid Business Email' });
      return;
    }
    const courseTitle = str(get(row, 'courseTitle'));
    if (!courseTitle) {
      skipped.push({ row: excelRow, message: 'Missing Course Title' });
      return;
    }

    const start = toIsoDate(get(row, 'courseStartDate'));
    if (!start.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Start Date — stored as blank' });
    const completion = toIsoDate(get(row, 'courseCompletionDate'));
    if (!completion.ok) warnings.push({ row: excelRow, message: 'Unreadable Course Completion Date — treated as pending' });

    byKey.set(`${email}||${courseTitle}`, {
      firstName: str(get(row, 'firstName')),
      lastName: str(get(row, 'lastName')),
      email,
      jobAssignment: str(get(row, 'jobAssignment')) || null,
      courseTitle,
      courseStartDate: start.iso,
      courseCompletionDate: completion.iso,
      manager: str(get(row, 'manager')) || null,
    });
  });

  const rows = [...byKey.values()];
  const courses = [...new Set(rows.map((r) => r.courseTitle))].sort();
  return { rows, skipped, warnings, courses };
}
