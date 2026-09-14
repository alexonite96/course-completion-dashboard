import * as XLSX from 'xlsx';
import type { LearningPlanDefInput, MasterParseResult, NewHireInput, ParseWarning } from '../../shared/onboarding-types';
import { isBlankRow, MissingColumnsError, normalize, str, toIsoDate } from './shared';

export { MissingColumnsError };

const HIRE_SHEET_NAME = 'Jump Start';
const PLAN_SHEET_NAME = 'JS LPs';

const HIRE_HEADER_MAP: Record<string, HireField> = {
  'hire date': 'hireDate',
  'js date': 'jsDate',
  'first & last name': 'fullName',
  'department': 'department',
  'ee#': 'eeNumber',
  'role': 'role',
  'hiring manager': 'hiringManager',
  'country': 'country',
};
type HireField = 'hireDate' | 'jsDate' | 'fullName' | 'department' | 'eeNumber' | 'role' | 'hiringManager' | 'country';

const HIRE_DISPLAY_NAMES: Record<string, string> = {
  'hire date': 'Hire Date',
  'js date': 'JS Date',
  'first & last name': 'First & Last Name',
  'department': 'Department',
  'ee#': 'EE#',
  'role': 'Role',
  'hiring manager': 'Hiring Manager',
  'country': 'Country',
};

const PLAN_HEADER_MAP: Record<string, PlanField> = {
  'title': 'title',
  'category': 'category',
  'audience': 'audience',
  'department': 'department',
  'region': 'region',
};
type PlanField = 'title' | 'category' | 'audience' | 'department' | 'region';

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  title: 'Title', category: 'Category', audience: 'Audience', department: 'Department', region: 'Region',
};

function sheetGrid(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook has no "${sheetName}" sheet`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: null });
}

export function parseMasterFile(data: ArrayBuffer | Uint8Array): MasterParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });

  const hireGrid = sheetGrid(wb, HIRE_SHEET_NAME);
  const hireHeaderRow = hireGrid[0];
  if (!hireHeaderRow) throw new Error(`"${HIRE_SHEET_NAME}" sheet contains no data rows`);

  const hireCols = new Map<HireField, number>();
  hireHeaderRow.forEach((cell, idx) => {
    const field = HIRE_HEADER_MAP[normalize(str(cell))];
    if (field && !hireCols.has(field)) hireCols.set(field, idx);
  });
  const missingHireCols = Object.entries(HIRE_HEADER_MAP)
    .filter(([, field]) => !hireCols.has(field))
    .map(([norm]) => HIRE_DISPLAY_NAMES[norm]);
  if (missingHireCols.length > 0) throw new MissingColumnsError(missingHireCols);
  const getHire = (row: unknown[], field: HireField) => row[hireCols.get(field)!];

  const skipped: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];
  const hires: NewHireInput[] = [];

  hireGrid.slice(1).forEach((row, i) => {
    const excelRow = i + 2;
    if (isBlankRow(row)) return;
    const fullName = str(getHire(row, 'fullName'));
    if (!fullName) {
      skipped.push({ row: excelRow, message: 'Missing First & Last Name' });
      return;
    }

    const hireDate = toIsoDate(getHire(row, 'hireDate'));
    if (!hireDate.ok) warnings.push({ row: excelRow, message: 'Unreadable Hire Date — stored as blank' });
    const jsDate = toIsoDate(getHire(row, 'jsDate'));
    if (!jsDate.ok) warnings.push({ row: excelRow, message: 'Unreadable JS Date — stored as blank' });
    else if (jsDate.iso === null) warnings.push({ row: excelRow, message: 'No JS Date — deadlines cannot be computed for this hire' });

    hires.push({
      eeNumber: str(getHire(row, 'eeNumber')) || null,
      fullName,
      department: str(getHire(row, 'department')) || null,
      role: str(getHire(row, 'role')) || null,
      hiringManager: str(getHire(row, 'hiringManager')) || null,
      country: str(getHire(row, 'country')) || null,
      hireDate: hireDate.iso,
      jsDate: jsDate.iso,
    });
  });

  const planGrid = sheetGrid(wb, PLAN_SHEET_NAME);
  const planHeaderRow = planGrid[0];
  if (!planHeaderRow) throw new Error(`"${PLAN_SHEET_NAME}" sheet contains no data rows`);

  const planCols = new Map<PlanField, number>();
  planHeaderRow.forEach((cell, idx) => {
    const field = PLAN_HEADER_MAP[normalize(str(cell))];
    if (field && !planCols.has(field)) planCols.set(field, idx);
  });
  const missingPlanCols = Object.entries(PLAN_HEADER_MAP)
    .filter(([, field]) => !planCols.has(field))
    .map(([norm]) => PLAN_DISPLAY_NAMES[norm]);
  if (missingPlanCols.length > 0) throw new MissingColumnsError(missingPlanCols);
  const getPlan = (row: unknown[], field: PlanField) => row[planCols.get(field)!];

  const plans: LearningPlanDefInput[] = [];
  planGrid.slice(1).forEach((row, i) => {
    const excelRow = i + 2;
    if (isBlankRow(row)) return;
    const title = str(getPlan(row, 'title'));
    if (!title) {
      skipped.push({ row: excelRow, message: `Missing Title in "${PLAN_SHEET_NAME}" sheet` });
      return;
    }
    plans.push({
      title,
      category: str(getPlan(row, 'category')) || null,
      audience: str(getPlan(row, 'audience')) || null,
      department: str(getPlan(row, 'department')) || null,
      region: str(getPlan(row, 'region')) || null,
    });
  });

  return { hires, plans, skipped, warnings };
}
