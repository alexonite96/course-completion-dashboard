import { describe, expect, it } from 'vitest';
import type { RolePlanMappingRule } from '../../shared/onboarding-types';
import { resolveWeek2PlanTitle } from '../../src/lib/roleMapping';

const rule = (over: Partial<RolePlanMappingRule> = {}): RolePlanMappingRule => ({
  id: 1, rolePattern: '', departmentPattern: null, countryPattern: null, learningPlanTitle: '', priority: 0, ...over,
});

describe('resolveWeek2PlanTitle', () => {
  const rules: RolePlanMappingRule[] = [
    rule({ id: 1, rolePattern: 'services consultant', learningPlanTitle: 'Jump Start - Services Consultants Core & GL' }),
    rule({ id: 2, rolePattern: 'payroll specialist', learningPlanTitle: 'Jump Start - Managed Payroll Specialist' }),
    rule({ id: 3, rolePattern: 'payroll specialist', countryPattern: 'australia', learningPlanTitle: 'Jump Start - Managed Payroll Specialist ANZ', priority: 10 }),
  ];

  it('matches a role by substring, case-insensitively', () => {
    expect(resolveWeek2PlanTitle({ role: 'Services Consultant Sr', department: 'Services', country: 'Mexico' }, rules))
      .toBe('Jump Start - Services Consultants Core & GL');
  });

  it('prefers a higher-priority, more specific rule', () => {
    expect(resolveWeek2PlanTitle({ role: 'Payroll Specialist III', department: 'Support', country: 'Australia' }, rules))
      .toBe('Jump Start - Managed Payroll Specialist ANZ');
  });

  it('falls back to a less specific rule when the more specific one does not match', () => {
    expect(resolveWeek2PlanTitle({ role: 'Payroll Specialist III', department: 'Support', country: 'India' }, rules))
      .toBe('Jump Start - Managed Payroll Specialist');
  });

  it('returns null when no rule matches', () => {
    expect(resolveWeek2PlanTitle({ role: 'Application Developer', department: 'Support', country: 'USA' }, rules)).toBeNull();
  });

  it('returns null when the hire has no role', () => {
    expect(resolveWeek2PlanTitle({ role: null, department: 'Support', country: 'USA' }, rules)).toBeNull();
  });
});
