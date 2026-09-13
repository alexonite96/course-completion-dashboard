import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { MissingColumnsError, parseCompletionReport } from '../../src/excel/parseCompletionReport';

const METADATA_ROW = ['MyDayforce | Learning Plan Completion Report | Dayforce filters...'];
const HEADERS = [
  'Preferred Name', 'Employee Last Name', 'Business Email', 'Job Assignment Name', 'Learning Plan',
  'Learning Plan Enrollment Date', 'Course', 'Course Enrollment Start', 'Course Enrolment Completion',
  'Course Score', 'Manager', 'Second Level Manager', 'Primary Address Country', 'Department Name',
  'Location Name', 'Course Duration', 'Learning Plan Completion Date',
];

function workbook(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([METADATA_ROW, HEADERS, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const courseRow = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base = [
    'Abbey', 'Litschke', 'Abbey.Litschke@dayforce.com', 'Services Consultant', 'Jump Start - Week 1',
    '2026-09-01', 'Course A', '2026-09-01', '2026-09-02', '', 'Maria Rivera', 'Someone', 'Mexico',
    'Implementation', 'Location', 900, '2026-09-05',
  ];
  return base.map((v, i) => (i in over ? over[i] : v));
};

describe('parseCompletionReport', () => {
  it('rolls up multiple course rows into one row per (person, plan)', () => {
    const result = parseCompletionReport(workbook([
      courseRow({ 6: 'Course A', 8: '2026-09-02' }),
      courseRow({ 6: 'Course B', 8: '' }),
    ]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      preferredName: 'Abbey', lastName: 'Litschke', learningPlanTitle: 'Jump Start - Week 1',
      enrollmentDate: '2026-09-01', completionDate: '2026-09-05', coursesTotal: 2, coursesCompleted: 1,
    });
  });

  it('treats the same person enrolled in two plans as two separate rows', () => {
    const result = parseCompletionReport(workbook([
      courseRow({ 4: 'Jump Start - Week 1' }),
      courseRow({ 4: 'Jump Start - Services Consultants Core & GL', 16: '' }),
    ]));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.learningPlanTitle).sort()).toEqual([
      'Jump Start - Services Consultants Core & GL', 'Jump Start - Week 1',
    ]);
  });

  it('leaves completionDate null while the plan is still in progress', () => {
    const result = parseCompletionReport(workbook([courseRow({ 16: '' })]));
    expect(result.rows[0].completionDate).toBeNull();
  });

  it('skips rows missing a name or Learning Plan', () => {
    const result = parseCompletionReport(workbook([courseRow({ 0: '' }), courseRow({ 4: '' })]));
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([
      { row: 3, message: 'Missing name or Learning Plan' },
      { row: 4, message: 'Missing name or Learning Plan' },
    ]);
  });

  it('finds the header row even with a longer metadata block above it', () => {
    const wb = XLSX.utils.book_new();
    const extraMetadata = [['line 1'], ['line 2'], ['line 3']];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...extraMetadata, HEADERS, courseRow()]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(parseCompletionReport(buf).rows).toHaveLength(1);
  });

  it('throws when the header row cannot be found', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['no headers here'], ['still nothing']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseCompletionReport(buf)).toThrowError('Could not find the header row');
  });

  it('throws MissingColumnsError when the header row is present but missing a required column', () => {
    const headers = HEADERS.filter((h) => h !== 'Learning Plan Completion Date');
    const row = courseRow().filter((_, i) => i !== 16);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([METADATA_ROW, headers, row]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => parseCompletionReport(buf)).toThrowError(MissingColumnsError);
  });
});
