import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MissingColumnsError, parseMasterFile } from '../../src/excel/parseMasterFile';

const HIRE_HEADERS = ['Hire Date', 'JS Date', 'First & Last Name', 'Department', 'EE#', 'Role', 'Hiring Manager ', 'Country', 'Time Zone', 'VP Level'];
const PLAN_HEADERS = ['Title', 'Category', 'Audience', 'Department', 'Region'];

function workbook(hireRows: unknown[][], planRows: unknown[][] = [['Jump Start - Week 1', 'Week 1', 'All', 'GCO', 'All']]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HIRE_HEADERS, ...hireRows]), 'Jump Start');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PLAN_HEADERS, ...planRows]), 'JS LPs');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const fullHireRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = ['2026-09-01', '2026-09-01', 'Jane Cooper', 'Services', '323292', 'Services Consultant', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'];
  return base.map((v, i) => (i in over ? over[i] : v));
};

describe('parseMasterFile', () => {
  it('parses a happy-path hire row and plan row', () => {
    const result = parseMasterFile(workbook([fullHireRow()]));
    expect(result.hires).toEqual([{
      eeNumber: '323292', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
      hiringManager: 'Maria Rivera', country: 'Mexico', hireDate: '2026-09-01', jsDate: '2026-09-01',
    }]);
    expect(result.plans).toEqual([{ title: 'Jump Start - Week 1', category: 'Week 1', audience: 'All', department: 'GCO', region: 'All' }]);
    expect(result.skipped).toEqual([]);
  });

  it('matches the "Hiring Manager " header despite its trailing space', () => {
    const result = parseMasterFile(workbook([fullHireRow()]));
    expect(result.hires[0].hiringManager).toBe('Maria Rivera');
  });

  it('skips rows with no name', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 2: '' })]));
    expect(result.hires).toHaveLength(0);
    expect(result.skipped).toEqual([{ row: 2, message: 'Missing First & Last Name' }]);
  });

  it('keeps a hire with no EE# or Role, treating them as null', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 4: '', 5: '' })]));
    expect(result.hires[0].eeNumber).toBeNull();
    expect(result.hires[0].role).toBeNull();
  });

  it('converts an Excel serial-number date', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 0: 46167, 1: 46167 })]));
    expect(result.hires[0].hireDate).toBe('2026-05-25');
  });

  it('keeps a hire with no JS Date, warning that deadlines cannot be computed', () => {
    const result = parseMasterFile(workbook([fullHireRow({ 1: '' })]));
    expect(result.hires[0].jsDate).toBeNull();
    expect(result.warnings).toContainEqual({ row: 2, message: 'No JS Date — deadlines cannot be computed for this hire' });
  });

  it('throws MissingColumnsError naming every missing hire-sheet header', () => {
    const headers = HIRE_HEADERS.filter((h) => h !== 'EE#' && h !== 'Country');
    const row = fullHireRow().filter((_, i) => i !== 4 && i !== 7);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, row]), 'Jump Start');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PLAN_HEADERS]), 'JS LPs');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseMasterFile(buf)).toThrowError(MissingColumnsError);
  });

  it('throws when the "JS LPs" sheet is missing', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HIRE_HEADERS, fullHireRow()]), 'Jump Start');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseMasterFile(buf)).toThrowError('Workbook has no "JS LPs" sheet');
  });
});
