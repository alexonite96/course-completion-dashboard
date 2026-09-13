// tests/onboarding/onboardingStatus.test.ts
import { describe, expect, it } from 'vitest';
import { WEEK1_PLAN_TITLE } from '../../shared/onboarding-constants';
import type { HireRecord, RolePlanMappingRule } from '../../shared/onboarding-types';
import { buildHireJourney } from '../../src/lib/onboardingStatus';

const hire = (over: Partial<HireRecord> = {}): HireRecord => ({
  id: 1, eeNumber: '100', fullName: 'Jane Cooper', department: 'Services', role: 'Services Consultant',
  hiringManager: 'Maria Rivera', managerSlug: 'maria-rivera', country: 'Mexico',
  hireDate: '2026-09-01', jsDate: '2026-09-01', completions: [], ...over,
});

const rules: RolePlanMappingRule[] = [
  { id: 1, rolePattern: 'services consultant', departmentPattern: null, countryPattern: null, learningPlanTitle: 'Jump Start - Services Consultants Core & GL', priority: 0 },
];

describe('buildHireJourney', () => {
  it('reports not_started before enrollment and before the deadline', () => {
    const j = buildHireJourney(hire({ completions: [] }), rules, '2026-09-03');
    expect(j.week1.status).toBe('not_started');
    expect(j.week2.status).toBe('not_started');
    expect(j.overallStatus).toBe('not_started');
  });

  it('marks Week 1 overdue once the 7-day deadline passes without completion', () => {
    const j = buildHireJourney(hire({ completions: [] }), rules, '2026-09-09');
    expect(j.week1.status).toBe('overdue');
    expect(j.week1.deadline).toBe('2026-09-08');
    expect(j.overallStatus).toBe('behind');
  });

  it('is on track when Week 1 is complete and Week 2 is still in progress before its deadline', () => {
    const completions = [
      { learningPlanTitle: WEEK1_PLAN_TITLE, enrollmentDate: '2026-09-01', completionDate: '2026-09-05', coursesTotal: 5, coursesCompleted: 5 },
      { learningPlanTitle: 'Jump Start - Services Consultants Core & GL', enrollmentDate: '2026-09-05', completionDate: null, coursesTotal: 10, coursesCompleted: 3 },
    ];
    const j = buildHireJourney(hire({ completions }), rules, '2026-09-08');
    expect(j.week1.status).toBe('complete');
    expect(j.week2.status).toBe('in_progress');
    expect(j.overallStatus).toBe('on_track');
  });

  it('is unmapped for Week 2 when the role matches no mapping rule', () => {
    const j = buildHireJourney(hire({ role: 'Mystery Role' }), [], '2026-09-03');
    expect(j.week2.status).toBe('unmapped');
    expect(j.week2.learningPlanTitle).toBeNull();
    expect(j.overallStatus).toBe('unmapped');
  });

  it('reports no_start_date when jsDate is missing, regardless of plan status', () => {
    const j = buildHireJourney(hire({ jsDate: null }), rules, '2026-09-03');
    expect(j.overallStatus).toBe('no_start_date');
  });
});
