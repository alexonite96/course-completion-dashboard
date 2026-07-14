import { describe, expect, it } from 'vitest';
import { computeStats, managerBreakdown, pendingCsv } from '../src/lib/stats';
import type { EnrollmentInput } from '../shared/types';

const row = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  firstName: 'Jane', lastName: 'Cooper', email: 'jane@example.com', jobAssignment: 'Specialist',
  courseTitle: 'Safety 101', courseStartDate: '2026-06-01', courseCompletionDate: '2026-06-20',
  manager: 'Maria Rivera', ...over,
});

describe('computeStats', () => {
  it('computes tiles from rows', () => {
    const rows = [
      row(), row(), row({ courseCompletionDate: null }),
      row({ manager: 'Kevin Tan' }), row({ manager: '  ' , courseCompletionDate: null }),
    ];
    expect(computeStats(rows)).toEqual({
      total: 5, completed: 3, pending: 2, completionRate: 60, managers: 2,
    });
  });
  it('rounds the rate to one decimal', () => {
    const rows = [row(), row(), row({ courseCompletionDate: null })];
    expect(computeStats(rows).completionRate).toBe(66.7);
  });
  it('returns zeros for no rows', () => {
    expect(computeStats([])).toEqual({ total: 0, completed: 0, pending: 0, completionRate: 0, managers: 0 });
  });
});

describe('managerBreakdown', () => {
  it('groups by manager, sorts by rate desc then name asc', () => {
    const rows = [
      row({ manager: 'Kevin Tan' }), row({ manager: 'Kevin Tan', courseCompletionDate: null }),
      row({ manager: 'Maria Rivera' }),
      row({ manager: null, courseCompletionDate: null }),
    ];
    expect(managerBreakdown(rows)).toEqual([
      { manager: 'Maria Rivera', total: 1, completed: 1, rate: 100 },
      { manager: 'Kevin Tan', total: 2, completed: 1, rate: 50 },
      { manager: 'Unassigned', total: 1, completed: 0, rate: 0 },
    ]);
  });
});

describe('pendingCsv', () => {
  it('includes only pending rows and escapes commas', () => {
    const rows = [
      row(),
      row({ firstName: 'Bob', lastName: 'Smith, Jr.', email: 'bob@example.com', courseCompletionDate: null }),
    ];
    expect(pendingCsv(rows)).toBe(
      'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date\n' +
      'Bob,"Smith, Jr.",bob@example.com,Specialist,Maria Rivera,Safety 101,2026-06-01',
    );
  });

  it('escapes embedded double-quotes by doubling them and wrapping', () => {
    const rows = [row({ lastName: 'O"Brien', courseCompletionDate: null })];
    expect(pendingCsv(rows)).toBe(
      'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date\n' +
      'Jane,"O""Brien",jane@example.com,Specialist,Maria Rivera,Safety 101,2026-06-01',
    );
  });

  it('wraps fields containing an embedded newline in quotes', () => {
    const rows = [row({ jobAssignment: 'Team\nLead', courseCompletionDate: null })];
    expect(pendingCsv(rows)).toBe(
      'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date\n' +
      'Jane,Cooper,jane@example.com,"Team\nLead",Maria Rivera,Safety 101,2026-06-01',
    );
  });

  it('renders null fields as empty cells, not the literal "null"', () => {
    const rows = [row({ jobAssignment: null, manager: null, courseStartDate: null, courseCompletionDate: null })];
    expect(pendingCsv(rows)).toBe(
      'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date\n' +
      'Jane,Cooper,jane@example.com,,,Safety 101,',
    );
  });
});
