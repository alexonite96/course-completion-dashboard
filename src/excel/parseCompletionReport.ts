import * as XLSX from 'xlsx';
import type { CompletionReportParseResult, CompletionRowInput, ParseWarning } from '../../shared/onboarding-types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError };

type Field = 'preferredName' | 'lastName' | 'learningPlanTitle' | 'enrollmentDate' | 'courseCompletionDate' | 'planCompletionDate';

const HEADER_MAP: Record<string, Field> = {
  'preferred name': 'preferredName',
  'employee last name': 'lastName',
  'learning plan': 'learningPlanTitle',
  'learning plan enrollment date': 'enrollmentDate',
  'course enrolment completion': 'courseCompletionDate',
  'learning plan completion date': 'planCompletionDate',
};

const DISPLAY_NAMES: Record<string, string> = {
  'preferred name': 'Preferred Name',
  'employee last name': 'Employee Last Name',
  'learning plan': 'Learning Plan',
  'learning plan enrollment date': 'Learning Plan Enrollment Date',
  'course enrolment completion': 'Course Enrolment Completion',
  'learning plan completion date': 'Learning Plan Completion Date',
};

function findHeaderRowIndex(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    if (row.some((cell) => normalize(str(cell)) === 'preferred name')) return i;
  }
  return -1;
}

interface Group {
  preferredName: string;
  lastName: string;
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export function parseCompletionReport(data: ArrayBuffer | Uint8Array): CompletionReportParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, blankrows: true, defval: null });

  const headerIdx = findHeaderRowIndex(grid);
  if (headerIdx === -1) {
    throw new Error('Could not find the header row (expected a "Preferred Name" column within the first 10 rows)');
  }
  const headerRow = grid[headerIdx];
  const dataRows = grid.slice(headerIdx + 1);

  const colByField = new Map<Field, number>();
  headerRow.forEach((cell, idx) => {
    const field = HEADER_MAP[normalize(str(cell))];
    if (field && !colByField.has(field)) colByField.set(field, idx);
  });
  const missing = Object.entries(HEADER_MAP)
    .filter(([, field]) => !colByField.has(field))
    .map(([norm]) => DISPLAY_NAMES[norm]);
  if (missing.length > 0) throw new MissingColumnsError(missing);
  const get = (row: unknown[], field: Field) => row[colByField.get(field)!];

  const skipped: ParseWarning[] = [];
  const groups = new Map<string, Group>();

  dataRows.forEach((row, i) => {
    const excelRow = headerIdx + 2 + i;
    if (isBlankRow(row)) return;

    const preferredName = str(get(row, 'preferredName'));
    const lastName = str(get(row, 'lastName'));
    const learningPlanTitle = str(get(row, 'learningPlanTitle'));
    if (!preferredName || !lastName || !learningPlanTitle) {
      skipped.push({ row: excelRow, message: 'Missing name or Learning Plan' });
      return;
    }

    const key = `${normalize(preferredName)}||${normalize(lastName)}||${learningPlanTitle}`;
    const enroll = toIsoDate(get(row, 'enrollmentDate'));
    const g = groups.get(key) ?? {
      preferredName, lastName, learningPlanTitle,
      enrollmentDate: enroll.iso, completionDate: null, coursesTotal: 0, coursesCompleted: 0,
    };
    g.coursesTotal += 1;
    if (toIsoDate(get(row, 'courseCompletionDate')).iso) g.coursesCompleted += 1;
    const planDone = toIsoDate(get(row, 'planCompletionDate'));
    if (planDone.iso && !g.completionDate) g.completionDate = planDone.iso;
    groups.set(key, g);
  });

  const rows: CompletionRowInput[] = [...groups.values()];
  return { rows, skipped };
}
