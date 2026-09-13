import type { HireJourney } from '../../shared/onboarding-types';

const esc = (v: string | null) => {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function overdueCsv(journeys: HireJourney[]): string {
  const header = 'Hiring Manager,Name,Role,JS Date,Week 1 Status,Week 2 Status,Overall Status';
  const rows = journeys
    .filter((j) => j.overallStatus === 'behind')
    .sort((a, b) =>
      (a.hire.hiringManager ?? '').localeCompare(b.hire.hiringManager ?? '') ||
      a.hire.fullName.localeCompare(b.hire.fullName),
    )
    .map((j) =>
      [j.hire.hiringManager, j.hire.fullName, j.hire.role, j.hire.jsDate, j.week1.status, j.week2.status, j.overallStatus]
        .map(esc)
        .join(','),
    );
  return [header, ...rows].join('\n');
}
