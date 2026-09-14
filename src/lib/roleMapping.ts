import type { RolePlanMappingRule } from '../../shared/onboarding-types';

/**
 * Resolves which Week 2 Learning Plan applies to a hire, by checking mapping
 * rules in priority order (highest first) and returning the first rule whose
 * role/department/country patterns all match. Patterns are simple
 * case-insensitive substring checks against the hire's fields — good enough
 * for this admin-editable POC table.
 */
export function resolveWeek2PlanTitle(
  hire: { role: string | null; department: string | null; country: string | null },
  rules: RolePlanMappingRule[],
): string | null {
  const role = (hire.role ?? '').trim().toLowerCase();
  if (!role) return null;
  const department = (hire.department ?? '').trim().toLowerCase();
  const country = (hire.country ?? '').trim().toLowerCase();

  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    const rolePattern = rule.rolePattern.trim().toLowerCase();
    if (!rolePattern || !role.includes(rolePattern)) continue;
    if (rule.departmentPattern && !department.includes(rule.departmentPattern.trim().toLowerCase())) continue;
    if (rule.countryPattern && !country.includes(rule.countryPattern.trim().toLowerCase())) continue;
    return rule.learningPlanTitle;
  }
  return null;
}
