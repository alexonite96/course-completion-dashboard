import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MissingColumnsError, parseWorkbook, toIsoDate } from '../src/excel/parse';

const HEADERS = [
  'Employee First Name', 'Employee Last Name', 'Business Email', 'Job Assignment',
  'Course Title', 'Course Start Date', 'Course Completion Date', 'Manager',
];

function workbook(rows: unknown[][], headers: string[] = HEADERS): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const fullRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = ['Jane', 'Cooper', 'Jane@Example.com', 'Specialist', 'Safety 101', '2026-06-01', '2026-06-20', 'Maria Rivera'];
  return base.map((v, i) => (i in over ? over[i] : v));
};

// Dates carry no timezone: every toIsoDate path must be timezone-independent,
// so these expectations must hold identically under any host TZ (e.g. TZ=America/Los_Angeles).
describe('toIsoDate', () => {
  it('passes through empty as null without error', () => {
    expect(toIsoDate(null)).toEqual({ iso: null, ok: true });
    expect(toIsoDate('')).toEqual({ iso: null, ok: true });
    expect(toIsoDate('   ')).toEqual({ iso: null, ok: true });
  });
  it('converts Excel serial numbers (days since 1899-12-30)', () => {
    expect(toIsoDate(45000)).toEqual({ iso: '2023-03-15', ok: true });
  });
  it('converts JS Date objects (UTC-anchored, as SheetJS produces)', () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 5, 20)))).toEqual({ iso: '2026-06-20', ok: true });
  });
  it('converts common text dates', () => {
    expect(toIsoDate('06/20/2026')).toEqual({ iso: '2026-06-20', ok: true });
    expect(toIsoDate('2026-06-20')).toEqual({ iso: '2026-06-20', ok: true });
  });
  it('flags unparseable values', () => {
    expect(toIsoDate('not a date')).toEqual({ iso: null, ok: false });
  });
});

describe('parseWorkbook', () => {
  it('maps a happy-path row, lowercasing the email', () => {
    const result = parseWorkbook(workbook([fullRow()]));
    expect(result.rows).toEqual([{
      firstName: 'Jane', lastName: 'Cooper', email: 'jane@example.com',
      jobAssignment: 'Specialist', courseTitle: 'Safety 101',
      courseStartDate: '2026-06-01', courseCompletionDate: '2026-06-20', manager: 'Maria Rivera',
    }]);
    expect(result.courses).toEqual(['Safety 101']);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('matches headers case-insensitively, ignores whitespace and extra columns', () => {
    const headers = [...HEADERS.map((h) => `  ${h.toUpperCase()}  `), 'Region'];
    const result = parseWorkbook(workbook([[...fullRow(), 'EMEA']], headers));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('jane@example.com');
  });

  it('throws MissingColumnsError naming every missing header', () => {
    const headers = HEADERS.filter((h) => h !== 'Business Email' && h !== 'Manager');
    const dummyRow = ['Jane', 'Cooper', 'Specialist', 'Safety 101', '2026-06-01', '2026-06-20'];
    expect(() => parseWorkbook(workbook([dummyRow], headers))).toThrowError(MissingColumnsError);
    try {
      parseWorkbook(workbook([dummyRow], headers));
    } catch (e) {
      expect((e as MissingColumnsError).missing).toEqual(['Business Email', 'Manager']);
    }
  });

  it('skips rows with missing or invalid email, reporting the Excel row number', () => {
    const result = parseWorkbook(workbook([fullRow(), fullRow({ 2: '' }), fullRow({ 2: 'not-an-email' })]));
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([
      { row: 3, message: 'Missing or invalid Business Email' },
      { row: 4, message: 'Missing or invalid Business Email' },
    ]);
  });

  it('skips rows with missing course title', () => {
    const result = parseWorkbook(workbook([fullRow({ 4: '' })]));
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([{ row: 2, message: 'Missing Course Title' }]);
  });

  it('treats an unreadable completion date as pending, with a warning', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: 'garbage' })]));
    expect(result.rows[0].courseCompletionDate).toBeNull();
    expect(result.warnings).toEqual([{ row: 2, message: 'Unreadable Course Completion Date — treated as pending' }]);
  });

  it('treats an empty completion date as pending, without a warning', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: '' })]));
    expect(result.rows[0].courseCompletionDate).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('dedupes by email+course, last row wins', () => {
    const result = parseWorkbook(workbook([fullRow({ 6: '' }), fullRow()]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].courseCompletionDate).toBe('2026-06-20');
  });

  it('keeps Excel row numbers accurate when a blank row precedes bad data', () => {
    // Row 2 = valid, row 3 = fully blank (dropped by object mode), row 4 = invalid email.
    const result = parseWorkbook(workbook([fullRow(), [], fullRow({ 2: '' })]));
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ row: 4, message: 'Missing or invalid Business Email' }]);
  });

  it('throws on a workbook with no data rows', () => {
    expect(() => parseWorkbook(workbook([]))).toThrowError('File contains no data rows');
  });
});
