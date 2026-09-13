import { describe, expect, it } from 'vitest';
import type { HireJourney } from '../../shared/onboarding-types';
import { overdueCsv } from '../../src/lib/onboardingCsv';

const journey = (over: Partial<HireJourney['hire']> = {}, overallStatus: HireJourney['overallStatus'] = 'behind'): HireJourney => ({
  hire: {
    id: 1, eeNumber: '1', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
    hiringManager: 'Maria Rivera', managerSlug: 'maria-rivera', country: 'Mexico',
    hireDate: '2026-09-01', jsDate: '2026-09-01', completions: [], ...over,
  },
  week1: { learningPlanTitle: 'Jump Start - Week 1', status: 'overdue', deadline: '2026-09-08', enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0 },
  week2: { learningPlanTitle: null, status: 'unmapped', deadline: null, enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0 },
  overallStatus,
});

describe('overdueCsv', () => {
  it('includes only hires with overallStatus "behind", grouped/sorted by manager then name', () => {
    const rows = [
      journey({ fullName: 'Zed Adams', hiringManager: 'Kevin Tan' }, 'behind'),
      journey({ fullName: 'Amy Brooks', hiringManager: 'Kevin Tan' }, 'behind'),
      journey({ fullName: 'Someone Else', hiringManager: 'Maria Rivera' }, 'on_track'),
    ];
    const csv = overdueCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Hiring Manager,Name,Role,JS Date,Week 1 Status,Week 2 Status,Overall Status');
    expect(lines).toHaveLength(3); // header + 2 behind rows, "on_track" excluded
    expect(lines[1]).toContain('Amy Brooks'); // Amy before Zed within the same manager
    expect(lines[2]).toContain('Zed Adams');
  });

  it('escapes commas in fullName and hiringManager by wrapping in quotes', () => {
    const rows = [
      journey({ fullName: 'Smith, Jr.', hiringManager: 'Rivera, Maria' }, 'behind'),
    ];
    const csv = overdueCsv(rows);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('"Rivera, Maria","Smith, Jr.",Services Consultant,2026-09-01,overdue,unmapped,behind');
  });

  it('renders null role and null jsDate as empty cells, not the literal "null"', () => {
    const rows = [
      journey({ role: null, jsDate: null }, 'behind'),
    ];
    const csv = overdueCsv(rows);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('Maria Rivera,Jane Cooper,,,overdue,unmapped,behind');
  });
});
