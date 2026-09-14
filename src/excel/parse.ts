import * as XLSX from 'xlsx';
import type { EnrollmentInput, ParseResult, ParseWarning } from '../../shared/types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError, toIsoDate };

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
